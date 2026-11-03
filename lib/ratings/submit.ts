import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import type { SubmitRatingInput } from './schema';

/** Fast-path window in app code. The database insert policy (migration 004) is authoritative. */
export const RATING_WINDOW_MS = 2000;

export type RatingRejectCode = 'ORDER_NOT_FOUND' | 'ORDER_NOT_COMPLETED' | 'WINDOW_EXPIRED' | 'ALREADY_RATED';

export type SubmitRatingResult = { ok: true; ratingId: string } | { ok: false; code: RatingRejectCode };

class RatingRejected extends Error {
  constructor(readonly code: RatingRejectCode) {
    super(code);
  }
}

export async function submitVerifiedRating(
  pool: pg.Pool,
  userId: string,
  input: SubmitRatingInput,
): Promise<SubmitRatingResult> {
  try {
    // Throwing inside asRole rolls the whole transaction back, so nothing is written on rejection.
    const ratingId = await asRole(pool, userId, async (c) => {
      const order = await c.query<{ restaurant_id: string; status: string; elapsed_ms: number | null }>(
        `SELECT o.restaurant_id, o.status,
                (EXTRACT(EPOCH FROM (NOW() - o.settled_at)) * 1000)::float8 AS elapsed_ms
           FROM order_refs o
          WHERE o.id = $1 AND o.diner_user_id = $2`,
        [input.order_ref_id, userId]);
      const o = order.rows[0];
      if (!o) throw new RatingRejected('ORDER_NOT_FOUND');
      if (o.status !== 'completed') throw new RatingRejected('ORDER_NOT_COMPLETED');

      const already = await c.query('SELECT 1 FROM verified_customer_ratings WHERE order_ref_id = $1', [input.order_ref_id]);
      if ((already.rowCount ?? 0) > 0) throw new RatingRejected('ALREADY_RATED');

      if (o.elapsed_ms === null || o.elapsed_ms < 0 || o.elapsed_ms > RATING_WINDOW_MS) {
        throw new RatingRejected('WINDOW_EXPIRED');
      }

      const ins = await c.query<{ id: string }>(
        `INSERT INTO verified_customer_ratings
           (restaurant_id, diner_user_id, order_ref_id, rating_score, review_tags, feedback_text)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [o.restaurant_id, userId, input.order_ref_id, input.rating_score,
          input.review_tags, input.feedback_text ?? null]);
      return ins.rows[0].id;
    });
    return { ok: true, ratingId };
  } catch (err) {
    if (err instanceof RatingRejected) return { ok: false, code: err.code };
    const code = (err as { code?: string }).code;
    // 23505: unique (restaurant_id, order_ref_id) lost a race with another submission.
    if (code === '23505') return { ok: false, code: 'ALREADY_RATED' };
    // 42501: the database rule rejected the insert (the 2-second window). Do not retry.
    if (code === '42501') return { ok: false, code: 'WINDOW_EXPIRED' };
    throw err;
  }
}
