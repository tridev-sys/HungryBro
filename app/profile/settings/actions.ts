'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db/client';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { addVpa, removeVpa, setDefaultVpa, saveGstin, type ProfileFormState } from '@/lib/profile/service';

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
