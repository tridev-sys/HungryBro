import type pg from 'pg';
import { asRole } from '@/lib/db/client';
import { createUpiIntentWithFallback } from '@/lib/payments/router';
import { PaymentCreateError } from '@/lib/payments/types';
import { priceCart } from './pricing';
import type { CheckoutInput } from './checkout-schema';
import type { CheckoutProviders } from './providers';

export type CheckoutResult =
  | {
      ok: true;
      orderId: string;
      status: 'pending_payment';
      totalInr: number;
      provider: 'razorpay' | 'cashfree';
      upiIntentUrl: string;
      reused: boolean;
    }
  | {
      ok: false;
      code:
        | 'UNKNOWN_ITEM' | 'OUT_OF_STOCK' | 'RESTAURANT_CLOSED'
        | 'AUCTION_NOT_FOUND' | 'PAYMENT_UNAVAILABLE' | 'DUPLICATE_CHECKOUT';
    };

/**
 * Creates a pending delivery order for the signed-in diner. Prices come from menu_items inside this
 * transaction. The payment order is created through the router (Razorpay first, Cashfree on failure).
 * The row is written only after the provider returns an order id, so no row exists without a payment
 * order. A repeated client key returns the existing order and calls no provider.
 */
export async function placeDeliveryOrder(
  pool: pg.Pool,
  userId: string,
  input: CheckoutInput,
  providers: CheckoutProviders | null,
): Promise<CheckoutResult> {
  try {
    return await asRole(pool, userId, async (c): Promise<CheckoutResult> => {
      const existing = await c.query<{
        id: string; status: 'pending_payment'; total: number; provider: 'razorpay' | 'cashfree'; upi_intent_url: string;
      }>(
        `SELECT id, status, total::float8 AS total, payment_provider AS provider, upi_intent_url
           FROM delivery_orders WHERE client_key = $1`,
        [input.clientKey]);
      const prior = existing.rows[0];
      if (prior) {
        return {
          ok: true, orderId: prior.id, status: prior.status, totalInr: Number(prior.total),
          provider: prior.provider, upiIntentUrl: prior.upi_intent_url, reused: true,
        };
      }

      if (input.auctionId) {
        const auction = await c.query('SELECT 1 FROM mesh_food_auctions WHERE id = $1', [input.auctionId]);
        if ((auction.rowCount ?? 0) === 0) return { ok: false, code: 'AUCTION_NOT_FOUND' };
      }

      const priced = await priceCart(c, input.restaurantId, input.lines);
      if (!priced.ok) return { ok: false, code: priced.code };
      if (!providers) return { ok: false, code: 'PAYMENT_UNAVAILABLE' };

      const intent = await createUpiIntentWithFallback(providers.primary, providers.fallback, {
        orderRef: input.clientKey,
        amountInr: priced.totalInr,
        description: 'Food delivery order',
      });

      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO delivery_orders (restaurant_id, diner_user_id, auction_id, client_key, subtotal, gst, total,
                payment_provider, provider_order_id, upi_intent_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [input.restaurantId, userId, input.auctionId, input.clientKey, priced.subtotalInr, priced.gstInr,
          priced.totalInr, intent.provider, intent.providerOrderId, intent.upiIntentUrl]);
      const orderId = rows[0].id;
      for (const line of priced.lines) {
        await c.query(
          `INSERT INTO delivery_order_lines (order_id, menu_item_id, name_snapshot, unit_price, quantity, line_total)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [orderId, line.menuItemId, line.name, line.unitPriceInr, line.quantity, line.lineTotalInr]);
      }
      return {
        ok: true, orderId, status: 'pending_payment', totalInr: priced.totalInr,
        provider: intent.provider, upiIntentUrl: intent.upiIntentUrl, reused: false,
      };
    });
  } catch (err) {
    if (err instanceof PaymentCreateError) return { ok: false, code: 'PAYMENT_UNAVAILABLE' };
    if ((err as { code?: string }).code === '23505') return { ok: false, code: 'DUPLICATE_CHECKOUT' };
    throw err;
  }
}
