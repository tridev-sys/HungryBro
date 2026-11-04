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
  | { ok: false; reason: 'INVALID_PHONE' | 'INVALID_EMAIL' | 'RATE_LIMITED' | 'SEND_FAILED' };

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

  // Count the attempt first, atomically. Commits even when the code turns out to be wrong.
  const claimSql = id.kind === 'phone'
    ? `UPDATE otp_challenges SET attempts = attempts + 1
        WHERE id = (
          SELECT id FROM otp_challenges
          WHERE phone_e164 = $1 AND consumed_at IS NULL AND expires_at > NOW() AND attempts < $2
          ORDER BY created_at DESC LIMIT 1
        )
        RETURNING id, code_hash`
    : `UPDATE otp_challenges SET attempts = attempts + 1
        WHERE id = (
          SELECT id FROM otp_challenges
          WHERE email = $1 AND consumed_at IS NULL AND expires_at > NOW() AND attempts < $2
          ORDER BY created_at DESC LIMIT 1
        )
        RETURNING id, code_hash`;
  const claimed = await asRole(pool, null, async (c) => {
    const { rows } = await c.query<{ id: string; code_hash: string }>(claimSql, [id.value, OTP_MAX_ATTEMPTS]);
    return rows[0] ?? null;
  });
  if (!claimed) return { ok: false, reason: 'EXPIRED_OR_LOCKED' };

  if (!constantTimeEqual(hashOtp(id.value, code), claimed.code_hash)) {
    return { ok: false, reason: 'WRONG_CODE' };
  }

  const consumed = await asRole(pool, null, async (c) => {
    const { rows } = await c.query(
      'UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1 AND consumed_at IS NULL RETURNING id',
      [claimed.id]);
    return rows.length > 0;
  });
  if (!consumed) return { ok: false, reason: 'EXPIRED_OR_LOCKED' };
  return id.kind === 'phone' ? { ok: true, e164: id.value } : { ok: true, email: id.value };
}
