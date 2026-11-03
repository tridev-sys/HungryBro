'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { getPool } from '@/lib/db/client';
import { resolveActor } from '@/lib/auth/actor';
import { getPaymentAdapter } from '@/lib/payments';
import { openTableSession, refreshSettlement, requestSplit } from '@/lib/dine/repository';
import { applyCartUpdate } from '@/lib/dine/cart';

// Not exported: a 'use server' file may export only async functions.
const TABLE_COOKIE = 'fos_table_session';
const TABLE_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

const OpenSchema = z.object({
  restaurantId: z.string().uuid(),
  tableNumber: z.string().min(1).max(16),
  signature: z.string().regex(/^[0-9a-f]{32}$/),
});

const SplitSchema = z.object({
  strategy: z.enum(['EQUAL', 'BY_CONSUMPTION']),
  contributorCount: z.number().int().min(1).max(20),
});

async function currentSessionToken(): Promise<string | null> {
  return (await cookies()).get(TABLE_COOKIE)?.value ?? null;
}

export async function openTableSessionAction(input: unknown): Promise<{ ok: true; status: string }> {
  const parsed = OpenSchema.parse(input);
  const actor = await resolveActor(getPool(), (await cookies()).toString());
  const session = await openTableSession(getPool(), {
    ...parsed,
    userId: actor?.role === 'diner' ? actor.userId : null,
  });
  (await cookies()).set(TABLE_COOKIE, session.sessionToken, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: TABLE_COOKIE_MAX_AGE_SECONDS,
  });
  return { ok: true, status: session.status };
}

export async function requestSplitAction(input: unknown) {
  const parsed = SplitSchema.parse(input);
  const token = await currentSessionToken();
  if (!token) throw new Error('SESSION_NOT_OPEN');
  return requestSplit(getPool(), getPaymentAdapter(), { sessionToken: token, ...parsed });
}

export async function refreshSettlementAction() {
  const token = await currentSessionToken();
  if (!token) throw new Error('SESSION_NOT_OPEN');
  return refreshSettlement(getPool(), getPaymentAdapter(), { sessionToken: token });
}

export async function cartUpdateAction(body: unknown) {
  const token = await currentSessionToken();
  if (!token) throw new Error('SESSION_NOT_OPEN');
  return applyCartUpdate(getPool(), { sessionToken: token, body });
}
