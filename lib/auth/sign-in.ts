import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import type { UserRole } from '@/types/food-os';

export interface SignedInUser {
  id: string;
  role: UserRole;
}

/** Read-only sign-in lookup. Never creates a user. */
export async function lookupUserByPhone(pool: pg.Pool, e164: string): Promise<SignedInUser | null> {
  return asRole(pool, null, async (c) => {
    const { rows } = await c.query<SignedInUser>('SELECT id, role FROM app_lookup_user_by_phone($1)', [e164]);
    return rows[0] ?? null;
  });
}

/** Creates the user after a verified OTP. The database rejects it without a recent verified challenge. */
export async function createUserAfterOtp(pool: pg.Pool, e164: string): Promise<SignedInUser> {
  return asRole(pool, null, async (c) => {
    const { rows } = await c.query<SignedInUser>('SELECT id, role FROM app_create_user_after_otp($1)', [e164]);
    return rows[0];
  });
}
