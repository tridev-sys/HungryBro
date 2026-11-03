import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import { round2 } from '@/lib/pricing';

export const KDS_SLOT_CAPACITY = 25;
export const BACKPRESSURE_THRESHOLD = 0.85;

/** active_kds_load: open tickets over slot capacity, capped at 1.00, two decimals. */
export function kdsLoad(openTickets: number, capacity: number = KDS_SLOT_CAPACITY): number {
  return Math.min(1, round2(openTickets / capacity));
}

export function backpressureWarning(load: number): boolean {
  return load > BACKPRESSURE_THRESHOLD;
}

/**
 * Recomputes active_kds_load from open tickets and writes it as the acting staff member
 * (food_app; migration 003 allows the update only for that restaurant's staff). Never called
 * with a diner identity or a superuser pool. Client components must not import this module.
 */
export async function refreshKitchenLoad(pool: pg.Pool, actorUserId: string, restaurantId: string): Promise<number> {
  return asRole(pool, actorUserId, async (c) => {
    const { rows } = await c.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM kds_tickets
        WHERE restaurant_id = $1 AND status IN ('queued', 'in_prep', 'ready')`,
      [restaurantId]);
    const load = kdsLoad(rows[0].n);
    await c.query('UPDATE restaurant_nodes SET active_kds_load = $2 WHERE id = $1', [restaurantId, load]);
    return load;
  });
}
