import type pg from 'pg';
import type { UserRole } from '@/types/food-os';
import { requestOtp, verifyOtp } from './otp';
import type { OtpProvider } from './otp-providers';
import { lookupUserByPhone, createUserAfterOtp } from './sign-in';
import { issueSession } from './session';

// No next/* imports here, so the logic runs in Node tests.

export type LoginState = { step: 'phone' | 'otp'; phone?: string; error?: string };

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

export async function completeLogin(
  pool: pg.Pool,
  rawPhone: string,
  code: string,
): Promise<
  | { ok: true; token: string; maxAgeSeconds: number; userId: string; role: UserRole }
  | { ok: false; error: string }
> {
  const v = await verifyOtp(pool, rawPhone, code);
  if (!v.ok) return { ok: false, error: VERIFY_ERRORS[v.reason] };

  const user = (await lookupUserByPhone(pool, v.e164)) ?? (await createUserAfterOtp(pool, v.e164));
  const { token, maxAgeSeconds } = await issueSession(user);
  return { ok: true, token, maxAgeSeconds, userId: user.id, role: user.role };
}
