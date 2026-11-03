import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import { readSessionToken, verifySession } from '@/lib/auth/session';
import type { UserRole } from '@/types/food-os';

export interface Actor {
  userId: string;
  role: UserRole;
  restaurantId: string | null;
}

/**
 * The signed-in user for a request, from the fos_session cookie (Plan 05). Role and restaurant
 * come from the database row, not from the token claims. Returns null when signed out.
 */
export async function resolveActor(pool: pg.Pool, cookieHeader: string | null): Promise<Actor | null> {
  const claims = await verifySession(readSessionToken(cookieHeader));
  if (!claims) return null;
  const { rows } = await asRole(pool, claims.userId, (c) =>
    c.query<{ role: UserRole; restaurant_id: string | null }>(
      'SELECT role, restaurant_id FROM users WHERE id = $1', [claims.userId]));
  const row = rows[0];
  if (!row) return null;
  return { userId: claims.userId, role: row.role, restaurantId: row.restaurant_id };
}
