import { createHmac } from 'node:crypto';
import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import { normalizeIdentifier } from './identifier';
import { constantTimeEqual } from '@/lib/security/timing';
import { OTP_MAX_ATTEMPTS, type OtpProvider } from './otp-providers';

// The HMAC input is the normalised identifier (E.164 for a phone, lowercase for an email).
// A phone's hash is unchanged from before email support, so codes issued earlier still verify.
export function hashOtp(identifier: string, code: string): string {
  const key = process.env.OTP_HMAC_KEY;
  if (!key || key.length < 16) throw new Error('OTP_HMAC_KEY must be set and at least 16 characters');
  return createHmac('sha256', key).update(`${identifier}:${code}`).digest('hex');
}

export type RequestOtpResult =
  | { ok: true; e164: string }
  | { ok: true; email: string }
  | { ok: false; reason: 'INVALID_PHONE' | 'INVALID_EMAIL' | 'RATE_LIMITED' | 'SEND_FAILED' | 'PHONE_UNAVAILABLE' };

export type VerifyOtpResult =
  | { ok: true; e164: string }
  | { ok: true; email: string }
  | { ok: false; reason: 'INVALID_PHONE' | 'INVALID_EMAIL' | 'EXPIRED_OR_LOCKED' | 'WRONG_CODE' };

/**
 * Issues a code to a phone or an email and sends it through the provider. An email is never handed
 * to an SMS provider. Send failures never carry the SMTP or gateway error text.
 */
export async function requestOtp(pool: pg.Pool, provider: OtpProvider, rawIdentifier: string): Promise<RequestOtpResult> {
  const id = normalizeIdentifier(rawIdentifier);
  if (!id) return { ok: false, reason: rawIdentifier.includes('@') ? 'INVALID_EMAIL' : 'INVALID_PHONE' };
  if (id.kind === 'email' && provider.name === 'msg91') return { ok: false, reason: 'SEND_FAILED' };
  // SMS off (email provider): a phone sign-in is refused before a challenge row is written.
  if (id.kind === 'phone' && provider.name === 'email') return { ok: false, reason: 'PHONE_UNAVAILABLE' };

  const code = provider.codeFor();
  const issueSql = id.kind === 'phone'
    ? 'SELECT app_issue_otp_challenge($1, $2) AS id'
    : 'SELECT app_issue_otp_challenge_email($1, $2) AS id';
  const challengeId = await asRole(pool, null, async (c) => {
    const { rows } = await c.query<{ id: string | null }>(issueSql, [id.value, hashOtp(id.value, code)]);
    return rows[0].id;
  });
  if (challengeId === null) return { ok: false, reason: 'RATE_LIMITED' };

  // Send only after the challenge row has committed, using the same code that was hashed.
  // The challenge row stays committed on a failed send, so the failed attempt still counts toward the hourly limit.
  const sent = await provider.send(id.value, code);
  if (!sent.ok) return { ok: false, reason: 'SEND_FAILED' };
  return id.kind === 'phone' ? { ok: true, e164: id.value } : { ok: true, email: id.value };
}

export async function verifyOtp(pool: pg.Pool, rawIdentifier: string, code: string): Promise<VerifyOtpResult> {
  const id = normalizeIdentifier(rawIdentifier);
  if (!id) return { ok: false, reason: rawIdentifier.includes('@') ? 'INVALID_EMAIL' : 'INVALID_PHONE' };

  // Count the attempt first, atomically, in app_claim_otp_challenge (migration 014). The attempt commits
  // even when the code turns out to be wrong. The runtime role has no direct DML on otp_challenges.
  const claimed = await asRole(pool, null, async (c) => {
    const { rows } = await c.query<{ out_id: string; out_code_hash: string }>(
      'SELECT out_id, out_code_hash FROM app_claim_otp_challenge($1, $2, $3)',
      [id.kind, id.value, OTP_MAX_ATTEMPTS]);
    const row = rows[0];
    return row ? { id: row.out_id, code_hash: row.out_code_hash } : null;
  });
  if (!claimed) return { ok: false, reason: 'EXPIRED_OR_LOCKED' };

  if (!constantTimeEqual(hashOtp(id.value, code), claimed.code_hash)) {
    return { ok: false, reason: 'WRONG_CODE' };
  }

  const consumed = await asRole(pool, null, async (c) => {
    const { rows } = await c.query<{ ok: boolean }>('SELECT app_consume_otp_challenge($1) AS ok', [claimed.id]);
    return rows[0]?.ok === true;
  });
  if (!consumed) return { ok: false, reason: 'EXPIRED_OR_LOCKED' };
  return id.kind === 'phone' ? { ok: true, e164: id.value } : { ok: true, email: id.value };
}
