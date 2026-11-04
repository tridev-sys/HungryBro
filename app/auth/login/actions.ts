'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db/client';
import { selectOtpProvider } from '@/lib/auth/otp-providers';
import { sendOtpForPhone, completeLogin, completeTotpLogin, type LoginState } from '@/lib/auth/login';
import {
  SESSION_COOKIE, sessionCookieOptions, TOTP_PENDING_COOKIE, TOTP_PENDING_SECONDS,
} from '@/lib/auth/session';

export async function sendOtpAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const phone = String(formData.get('phone') ?? '');
  return sendOtpForPhone(await getPool(), selectOtpProvider(process.env), phone);
}

export async function verifyOtpAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const phone = String(formData.get('phone') ?? '');
  const code = String(formData.get('code') ?? '');
  const result = await completeLogin(await getPool(), phone, code);
  if (!result.ok) return { step: 'otp', phone, error: result.error };

  const jar = await cookies();
  if ('totpRequired' in result) {
    jar.set(TOTP_PENDING_COOKIE, result.pendingToken, {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: TOTP_PENDING_SECONDS,
    });
    return { step: 'totp' };
  }
  jar.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.maxAgeSeconds));
  redirect('/');
}

export async function verifyTotpAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const code = String(formData.get('code') ?? '');
  const jar = await cookies();
  const pending = jar.get(TOTP_PENDING_COOKIE)?.value ?? '';
  const result = await completeTotpLogin(await getPool(), pending, code);
  if (!result.ok) return { step: 'totp', error: result.error };

  jar.delete(TOTP_PENDING_COOKIE);
  jar.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.maxAgeSeconds));
  redirect('/');
}
