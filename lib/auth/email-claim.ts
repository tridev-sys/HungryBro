import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import { normalizeEmail } from './identifier';
import { hashOtp, verifyOtp } from './otp';
import type { OtpProvider } from './otp-providers';

// Adds a verified email to a signed-in account, on the same row (decision: tech-decisions.md,
// "Verified email for phone-only accounts"). The caller must already have a session. A phone number
// alone never reaches this path, because a phone session exists only after a delivered phone code.

export type RequestEmailClaimResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'INVALID_EMAIL' | 'ALREADY_HAS_EMAIL' | 'RATE_LIMITED' | 'SEND_FAILED' };

export type ConfirmEmailClaimResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'INVALID_EMAIL' | 'WRONG_CODE' | 'EXPIRED_OR_LOCKED' | 'NOT_VERIFIED' | 'ALREADY_HAS_EMAIL' | 'EMAIL_TAKEN' };

/** Sends a code to the address and records it as this user's claim. Throws NOT_SIGNED_IN without a caller. */
export async function requestEmailClaim(
  pool: pg.Pool,
  provider: OtpProvider,
  userId: string,
  rawEmail: string,
): Promise<RequestEmailClaimResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, reason: 'INVALID_EMAIL' };
  if (provider.name === 'msg91') return { ok: false, reason: 'SEND_FAILED' };

  const code = provider.codeFor();
  let challengeId: string | null;
  try {
    challengeId = await asRole(pool, userId, async (c) => {
      const { rows } = await c.query<{ id: string | null }>(
        'SELECT app_issue_email_claim_otp($1, $2) AS id', [email, hashOtp(email, code)]);
      return rows[0].id;
    });
  } catch (err) {
    if (messageHas(err, 'ALREADY_HAS_EMAIL')) return { ok: false, reason: 'ALREADY_HAS_EMAIL' };
    throw err;
  }
  if (challengeId === null) return { ok: false, reason: 'RATE_LIMITED' };

  // Sent after the challenge row has committed, with the same code that was hashed.
  const sent = await provider.send(email, code);
  if (!sent.ok) return { ok: false, reason: 'SEND_FAILED' };
  return { ok: true, email };
}

/** Checks the code, then attaches the email to the caller's row. The database enforces the claim rules. */
export async function confirmEmailClaim(
  pool: pg.Pool,
  userId: string,
  rawEmail: string,
  code: string,
): Promise<ConfirmEmailClaimResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, reason: 'INVALID_EMAIL' };

  const v = await verifyOtp(pool, email, code);
  if (!v.ok) {
    return { ok: false, reason: v.reason === 'WRONG_CODE' ? 'WRONG_CODE' : 'EXPIRED_OR_LOCKED' };
  }

  try {
    await asRole(pool, userId, (c) => c.query('SELECT app_attach_verified_email($1)', [email]));
    return { ok: true, email };
  } catch (err) {
    if (messageHas(err, 'NOT_VERIFIED')) return { ok: false, reason: 'NOT_VERIFIED' };
    if (messageHas(err, 'ALREADY_HAS_EMAIL')) return { ok: false, reason: 'ALREADY_HAS_EMAIL' };
    if ((err as { code?: string }).code === '23505') return { ok: false, reason: 'EMAIL_TAKEN' };
    throw err;
  }
}

function messageHas(err: unknown, text: string): boolean {
  return err instanceof Error && err.message.includes(text);
}
