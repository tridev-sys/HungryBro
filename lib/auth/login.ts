import type pg from 'pg';
import type { UserRole } from '@/types/food-os';
import { requestOtp, verifyOtp } from './otp';
import type { OtpProvider } from './otp-providers';
import { lookupUserByPhone, lookupUserByEmail, lookupUserById, createUserAfterOtp, createUserAfterEmailOtp } from './sign-in';
import { issueSession, readPendingSecondFactor, issuePendingSecondFactor } from './session';
import { isTotpEnabled, verifySecondFactor } from './totp';
import { clearSecondFactorAttempts, reserveSecondFactorAttempt } from './second-factor-lock';
import type { RedisLike } from '@/lib/ratelimit/redis-store';
import { getRedis } from '@/lib/redis';

// No next/* imports here, so the logic runs in Node tests.

export type LoginState = { step: 'phone' | 'otp' | 'totp'; phone?: string; email?: string; error?: string };

const INVALID_IDENTIFIER = 'Enter a valid 10-digit Indian mobile number or email address.';

const REQUEST_ERRORS: Record<'INVALID_PHONE' | 'INVALID_EMAIL' | 'RATE_LIMITED' | 'SEND_FAILED' | 'PHONE_UNAVAILABLE', string> = {
  INVALID_PHONE: INVALID_IDENTIFIER,
  INVALID_EMAIL: INVALID_IDENTIFIER,
  PHONE_UNAVAILABLE: 'Sign-in by mobile number is not available right now. Sign in with your email address.',
  RATE_LIMITED: 'Too many codes requested for this number. Try again in an hour.',
  SEND_FAILED: 'We could not send the code to this number. Please try again.',
};

const VERIFY_ERRORS: Record<'INVALID_PHONE' | 'INVALID_EMAIL' | 'WRONG_CODE' | 'EXPIRED_OR_LOCKED', string> = {
  INVALID_PHONE: INVALID_IDENTIFIER,
  INVALID_EMAIL: INVALID_IDENTIFIER,
  WRONG_CODE: 'That code is not right.',
  EXPIRED_OR_LOCKED: 'This code has expired or too many attempts were made. Request a new code.',
};

/** Step 1 of sign-in: a phone number or an email address. The result carries whichever was used. */
export async function sendOtpForIdentifier(pool: pg.Pool, provider: OtpProvider, rawIdentifier: string): Promise<LoginState> {
  const r = await requestOtp(pool, provider, rawIdentifier);
  if (!r.ok) {
    const isEmail = rawIdentifier.includes('@');
    const error = r.reason === 'SEND_FAILED' && isEmail
      ? 'We could not send the code to this email address. Please try again.'
      : r.reason === 'RATE_LIMITED' && isEmail
        ? 'Too many codes requested for this email address. Try again in an hour.'
        : REQUEST_ERRORS[r.reason];
    return { step: 'phone', error };
  }
  return 'email' in r ? { step: 'otp', email: r.email } : { step: 'otp', phone: r.e164 };
}

/** The OTP step's state for the identifier the person typed (used when a code check fails). */
export function otpStepFor(rawIdentifier: string, error?: string): LoginState {
  const state: LoginState = { step: 'otp' };
  if (rawIdentifier.includes('@')) state.email = rawIdentifier.trim().toLowerCase();
  else state.phone = rawIdentifier.trim();
  if (error) state.error = error;
  return state;
}

const TOTP_ERROR = 'That code is not right.';
const PENDING_ERROR = 'Your sign-in has expired. Start again.';
const LOCKED_ERROR = 'Too many incorrect codes. Try again later.';

export type CompleteLoginResult =
  | { ok: true; token: string; maxAgeSeconds: number; userId: string; role: UserRole }
  | { ok: true; totpRequired: true; pendingToken: string; userId: string }
  | { ok: false; error: string };

/**
 * Step 1: the phone or email code. Users with 2FA enabled get a pending token instead of a session;
 * they must then call completeTotpLogin with an authenticator or recovery code.
 */
export async function completeLogin(
  pool: pg.Pool,
  rawIdentifier: string,
  code: string,
): Promise<CompleteLoginResult> {
  const v = await verifyOtp(pool, rawIdentifier, code);
  if (!v.ok) return { ok: false, error: VERIFY_ERRORS[v.reason] };

  const user = 'email' in v
    ? (await lookupUserByEmail(pool, v.email)) ?? (await createUserAfterEmailOtp(pool, v.email))
    : (await lookupUserByPhone(pool, v.e164)) ?? (await createUserAfterOtp(pool, v.e164));
  if (await isTotpEnabled(pool, user.id)) {
    return { ok: true, totpRequired: true, pendingToken: await issuePendingSecondFactor(user.id), userId: user.id };
  }
  const { token, maxAgeSeconds } = await issueSession(user);
  return { ok: true, token, maxAgeSeconds, userId: user.id, role: user.role };
}

/**
 * Step 2 (only when 2FA is enabled): an authenticator code or a single-use recovery code.
 * At most SECOND_FACTOR_MAX_ATTEMPTS checks per user in each window. Once that is used up, even the
 * right code is refused until the window ends. The attempt is reserved before the code is checked.
 */
export async function completeTotpLogin(
  pool: pg.Pool,
  pendingToken: string,
  code: string,
  redis: RedisLike = getRedis(),
): Promise<
  | { ok: true; token: string; maxAgeSeconds: number; userId: string; role: UserRole }
  | { ok: false; error: string }
> {
  const userId = await readPendingSecondFactor(pendingToken);
  if (!userId) return { ok: false, error: PENDING_ERROR };

  if (!(await reserveSecondFactorAttempt(redis, userId))) return { ok: false, error: LOCKED_ERROR };
  const factor = await verifySecondFactor(pool, userId, code);
  if (!factor.ok) return { ok: false, error: TOTP_ERROR };
  await clearSecondFactorAttempts(redis, userId);

  const user = await lookupUserById(pool, userId);
  if (!user) return { ok: false, error: PENDING_ERROR };
  const { token, maxAgeSeconds } = await issueSession(user);
  return { ok: true, token, maxAgeSeconds, userId: user.id, role: user.role };
}
