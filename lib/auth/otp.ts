import { createHmac } from 'node:crypto';
import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import { normalizeIndianMobile } from './phone';
import { constantTimeEqual } from '@/lib/security/timing';
import { OTP_MAX_ATTEMPTS, type OtpProvider } from './otp-providers';

export function hashOtp(e164: string, code: string): string {
  const key = process.env.OTP_HMAC_KEY;
  if (!key || key.length < 16) throw new Error('OTP_HMAC_KEY must be set and at least 16 characters');
  return createHmac('sha256', key).update(`${e164}:${code}`).digest('hex');
}

export type RequestOtpResult =
  | { ok: true; e164: string }
  | { ok: false; reason: 'INVALID_PHONE' | 'RATE_LIMITED' | 'SEND_FAILED' };

export type VerifyOtpResult =
  | { ok: true; e164: string }
  | { ok: false; reason: 'INVALID_PHONE' | 'EXPIRED_OR_LOCKED' | 'WRONG_CODE' };

export async function requestOtp(pool: pg.Pool, provider: OtpProvider, rawPhone: string): Promise<RequestOtpResult> {
  const e164 = normalizeIndianMobile(rawPhone);
  if (!e164) return { ok: false, reason: 'INVALID_PHONE' };

  const code = provider.codeFor();
  const id = await asRole(pool, null, async (c) => {
    const { rows } = await c.query<{ id: string | null }>(
      'SELECT app_issue_otp_challenge($1, $2) AS id', [e164, hashOtp(e164, code)]);
    return rows[0].id;
  });
  if (id === null) return { ok: false, reason: 'RATE_LIMITED' };

  // Send only after the challenge row has committed, using the same code that was hashed.
  // The challenge row stays committed on a failed send, so the failed attempt still counts toward the hourly limit.
  const sent = await provider.send(e164, code);
  if (!sent.ok) return { ok: false, reason: 'SEND_FAILED' };
  return { ok: true, e164 };
}

export async function verifyOtp(pool: pg.Pool, rawPhone: string, code: string): Promise<VerifyOtpResult> {
  const e164 = normalizeIndianMobile(rawPhone);
  if (!e164) return { ok: false, reason: 'INVALID_PHONE' };

  // Count the attempt first, atomically. Commits even when the code turns out to be wrong.
  const claimed = await asRole(pool, null, async (c) => {
    const { rows } = await c.query<{ id: string; code_hash: string }>(
      `UPDATE otp_challenges SET attempts = attempts + 1
        WHERE id = (
          SELECT id FROM otp_challenges
          WHERE phone_e164 = $1 AND consumed_at IS NULL AND expires_at > NOW() AND attempts < $2
          ORDER BY created_at DESC LIMIT 1
        )
        RETURNING id, code_hash`,
      [e164, OTP_MAX_ATTEMPTS]);
    return rows[0] ?? null;
  });
  if (!claimed) return { ok: false, reason: 'EXPIRED_OR_LOCKED' };

  if (!constantTimeEqual(hashOtp(e164, code), claimed.code_hash)) {
    return { ok: false, reason: 'WRONG_CODE' };
  }

  const consumed = await asRole(pool, null, async (c) => {
    const { rows } = await c.query(
      'UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1 AND consumed_at IS NULL RETURNING id',
      [claimed.id]);
    return rows.length > 0;
  });
  if (!consumed) return { ok: false, reason: 'EXPIRED_OR_LOCKED' };
  return { ok: true, e164 };
}
