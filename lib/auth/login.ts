import type pg from 'pg';
import type { UserRole } from '@/types/food-os';
import { requestOtp, verifyOtp } from './otp';
import type { OtpProvider } from './otp-providers';
import { lookupUserByPhone, lookupUserById, createUserAfterOtp } from './sign-in';
import { issueSession, readPendingSecondFactor, issuePendingSecondFactor } from './session';
import { isTotpEnabled, verifySecondFactor } from './totp';

// No next/* imports here, so the logic runs in Node tests.

export type LoginState = { step: 'phone' | 'otp' | 'totp'; phone?: string; error?: string };

const REQUEST_ERRORS: Record<'INVALID_PHONE' | 'RATE_LIMITED' | 'SEND_FAILED', string> = {
  INVALID_PHONE: 'Enter a valid 10-digit Indian mobile number.',
  RATE_LIMITED: 'Too many codes requested for this number. Try again in an hour.',
  SEND_FAILED: 'We could not send the code to this number. Please try again.',
};

const VERIFY_ERRORS: Record<'INVALID_PHONE' | 'WRONG_CODE' | 'EXPIRED_OR_LOCKED', string> = {
  INVALID_PHONE: 'Enter a valid 10-digit Indian mobile number.',
  WRONG_CODE: 'That code is not right.',
  EXPIRED_OR_LOCKED: 'This code has expired or too many attempts were made. Request a new code.',
};

export async function sendOtpForPhone(pool: pg.Pool, provider: OtpProvider, rawPhone: string): Promise<LoginState> {
  const r = await requestOtp(pool, provider, rawPhone);
  if (!r.ok) return { step: 'phone', error: REQUEST_ERRORS[r.reason] };
  return { step: 'otp', phone: r.e164 };
}

const TOTP_ERROR = 'That code is not right.';
const PENDING_ERROR = 'Your sign-in has expired. Start again.';

export type CompleteLoginResult =
  | { ok: true; token: string; maxAgeSeconds: number; userId: string; role: UserRole }
  | { ok: true; totpRequired: true; pendingToken: string; userId: string }
  | { ok: false; error: string };

/**
 * Step 1: the email/phone code. Users with 2FA enabled get a pending token instead of a session;
 * they must then call completeTotpLogin with an authenticator or recovery code.
 */
export async function completeLogin(
  pool: pg.Pool,
  rawPhone: string,
  code: string,
): Promise<CompleteLoginResult> {
  const v = await verifyOtp(pool, rawPhone, code);
  if (!v.ok) return { ok: false, error: VERIFY_ERRORS[v.reason] };

  const user = (await lookupUserByPhone(pool, v.e164)) ?? (await createUserAfterOtp(pool, v.e164));
  if (await isTotpEnabled(pool, user.id)) {
    return { ok: true, totpRequired: true, pendingToken: await issuePendingSecondFactor(user.id), userId: user.id };
  }
  const { token, maxAgeSeconds } = await issueSession(user);
  return { ok: true, token, maxAgeSeconds, userId: user.id, role: user.role };
}

/** Step 2 (only when 2FA is enabled): an authenticator code or a single-use recovery code. */
export async function completeTotpLogin(
  pool: pg.Pool,
  pendingToken: string,
  code: string,
): Promise<
  | { ok: true; token: string; maxAgeSeconds: number; userId: string; role: UserRole }
  | { ok: false; error: string }
> {
  const userId = await readPendingSecondFactor(pendingToken);
  if (!userId) return { ok: false, error: PENDING_ERROR };

  const factor = await verifySecondFactor(pool, userId, code);
  if (!factor.ok) return { ok: false, error: TOTP_ERROR };

  const user = await lookupUserById(pool, userId);
  if (!user) return { ok: false, error: PENDING_ERROR };
  const { token, maxAgeSeconds } = await issueSession(user);
  return { ok: true, token, maxAgeSeconds, userId: user.id, role: user.role };
}
