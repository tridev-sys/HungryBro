import type pg from 'pg';
import { asRole } from '@/lib/db/client';

/**
 * The completed order of this table session that the signed-in diner can still rate, or null.
 * Runs as the diner (RLS), so an order owned by anyone else is never returned. The 2-second window
 * and the one-rating-per-order rule are enforced again by POST /api/ratings and the database.
 */
export async function findRatableOrderRef(pool: pg.Pool, userId: string, sessionId: string): Promise<string | null> {
  const { rows } = await asRole(pool, userId, (c) =>
    c.query<{ id: string }>(
      `SELECT o.id
         FROM order_refs o
        WHERE o.session_id = $1
          AND o.diner_user_id = $2
          AND o.status = 'completed'
          AND NOT EXISTS (SELECT 1 FROM verified_customer_ratings v WHERE v.order_ref_id = o.id)
        ORDER BY o.settled_at DESC NULLS LAST
        LIMIT 1`,
      [sessionId, userId]));
  return rows[0]?.id ?? null;
}
