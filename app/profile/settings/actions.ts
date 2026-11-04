'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db/client';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { addVpa, removeVpa, setDefaultVpa, saveGstin, type ProfileFormState } from '@/lib/profile/service';
import { requestEmailClaim, confirmEmailClaim } from '@/lib/auth/email-claim';
import { selectOtpProvider } from '@/lib/auth/otp-providers';

const VPA_ERRORS = {
  INVALID_VPA: 'Enter a UPI ID like name@bank.',
  DUPLICATE: 'That UPI ID is already saved.',
  NOT_FOUND: 'That UPI ID is not saved.',
} as const;

async function requireUserId(): Promise<string> {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) redirect('/auth/login');
  return claims.userId;
}

export async function addVpaAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const userId = await requireUserId();
  const r = await addVpa(await getPool(), userId, String(formData.get('vpa') ?? ''));
  return r.ok ? { message: 'UPI ID saved.' } : { error: VPA_ERRORS[r.reason] };
}

export async function removeVpaAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const userId = await requireUserId();
  const r = await removeVpa(await getPool(), userId, String(formData.get('vpa') ?? ''));
  return r.ok ? { message: 'UPI ID removed.' } : { error: VPA_ERRORS[r.reason] };
}

export async function setDefaultVpaAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const userId = await requireUserId();
  const r = await setDefaultVpa(await getPool(), userId, String(formData.get('vpa') ?? ''));
  return r.ok ? { message: 'Default UPI ID updated.' } : { error: VPA_ERRORS[r.reason] };
}

export async function saveGstinAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const userId = await requireUserId();
  const r = await saveGstin(await getPool(), userId, String(formData.get('gstin') ?? ''));
  if (!r.ok) return { error: 'Enter a valid 15-character GSTIN.' };
  return { message: r.gstin ? 'GSTIN saved.' : 'GSTIN cleared.' };
}

export type EmailClaimFormState = { message?: string; error?: string; pendingEmail?: string };

const CLAIM_REQUEST_ERRORS = {
  INVALID_EMAIL: 'Enter a valid email address.',
  ALREADY_HAS_EMAIL: 'This account already has an email address.',
  RATE_LIMITED: 'Too many codes requested for this address. Try again in an hour.',
  SEND_FAILED: 'We could not send the code to this address. Please try again.',
} as const;

const CLAIM_CONFIRM_ERRORS = {
  INVALID_EMAIL: 'Enter a valid email address.',
  WRONG_CODE: 'That code is not right.',
  EXPIRED_OR_LOCKED: 'This code has expired or too many attempts were made. Request a new code.',
  NOT_VERIFIED: 'Verify the address again with a new code.',
  ALREADY_HAS_EMAIL: 'This account already has an email address.',
  EMAIL_TAKEN: 'That email address is already used by another account.',
} as const;

export async function requestEmailClaimAction(_prev: EmailClaimFormState, formData: FormData): Promise<EmailClaimFormState> {
  const userId = await requireUserId();
  const r = await requestEmailClaim(await getPool(), selectOtpProvider(process.env), userId, String(formData.get('email') ?? ''));
  return r.ok
    ? { pendingEmail: r.email, message: 'We sent a 6-digit code to that address.' }
    : { error: CLAIM_REQUEST_ERRORS[r.reason] };
}

export async function confirmEmailClaimAction(_prev: EmailClaimFormState, formData: FormData): Promise<EmailClaimFormState> {
  const userId = await requireUserId();
  const r = await confirmEmailClaim(
    await getPool(), userId, String(formData.get('email') ?? ''), String(formData.get('code') ?? ''));
  return r.ok ? { message: 'Email verified and saved.' } : { error: CLAIM_CONFIRM_ERRORS[r.reason] };
}
