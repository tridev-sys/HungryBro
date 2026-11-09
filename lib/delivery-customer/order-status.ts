import type pg from 'pg';
import { asRole } from '@/lib/db/client';

export type DeliveryStatus = 'pending_payment' | 'in_kitchen' | 'delivered' | 'cancelled';

export interface OrderStatusView {
  id: string;
  status: DeliveryStatus;
  statusText: string;
  restaurantName: string;
  totalInr: number;
  lines: { name: string; quantity: number; lineTotalInr: number }[];
  /** The UPI pay link while the order is waiting for payment; null afterwards. */
  upiIntentUrl: string | null;
  /** The completed order_refs row that a rating attaches to, set once the order is delivered. */
  orderRefId: string | null;
  rated: boolean;
}

export function statusText(status: DeliveryStatus): string {
  switch (status) {
    case 'pending_payment': return 'Waiting for payment';
    case 'in_kitchen': return 'Preparing your order';
    case 'delivered': return 'Delivered';
    case 'cancelled': return 'Cancelled';
  }
}

/** One order as the signed-in diner sees it. Row-level security returns null for anyone else. */
export async function getOrderStatus(pool: pg.Pool, userId: string, orderId: string): Promise<OrderStatusView | null> {
  return asRole(pool, userId, async (c) => {
    const { rows } = await c.query<{
      id: string; status: DeliveryStatus; restaurant_name: string; total: number; upi_intent_url: string;
      order_ref_id: string | null; rated: boolean;
    }>(
      `SELECT o.id, o.status, r.name AS restaurant_name, o.total::float8 AS total, o.upi_intent_url,
              o.order_ref_id,
              EXISTS (SELECT 1 FROM verified_customer_ratings v WHERE v.order_ref_id = o.order_ref_id) AS rated
         FROM delivery_orders o
         JOIN restaurant_nodes r ON r.id = o.restaurant_id
        WHERE o.id = $1`,
      [orderId]);
    const o = rows[0];
    if (!o) return null;
    const lines = await c.query<{ name: string; quantity: number; line_total: number }>(
      `SELECT name_snapshot AS name, quantity, line_total::float8 AS line_total
         FROM delivery_order_lines WHERE order_id = $1 ORDER BY name_snapshot, id`,
      [orderId]);
    return {
      id: o.id,
      status: o.status,
      statusText: statusText(o.status),
      restaurantName: o.restaurant_name,
      totalInr: Number(o.total),
      lines: lines.rows.map((l) => ({ name: l.name, quantity: l.quantity, lineTotalInr: Number(l.line_total) })),
      upiIntentUrl: o.status === 'pending_payment' ? o.upi_intent_url : null,
      orderRefId: o.order_ref_id,
      rated: Boolean(o.rated),
    };
  });
}
