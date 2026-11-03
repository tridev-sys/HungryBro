'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db/client';
import { selectOtpProvider } from '@/lib/auth/otp-providers';
import { sendOtpForPhone, completeLogin, type LoginState } from '@/lib/auth/login';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';

export async function sendOtpAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const phone = String(formData.get('phone') ?? '');
  return sendOtpForPhone(getPool(), selectOtpProvider(process.env), phone);
}

export async function verifyOtpAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const phone = String(formData.get('phone') ?? '');
  const code = String(formData.get('code') ?? '');
  const result = await completeLogin(getPool(), phone, code);
  if (!result.ok) return { step: 'otp', phone, error: result.error };

  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.maxAgeSeconds));
  redirect('/');
}
