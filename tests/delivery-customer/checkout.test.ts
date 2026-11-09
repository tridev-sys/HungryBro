import { randomUUID } from 'node:crypto';
import type { PaymentProvider, UpiIntent, UpiIntentRequest } from '@/lib/payments/types';
import { PaymentCreateError, WebhookSignatureError } from '@/lib/payments/types';
import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { placeDeliveryOrder, type CheckoutProviders } from '@/lib/delivery-customer/checkout';
import { asRole } from '@/lib/db/client';
import { setCheckoutProvidersForTest } from '@/lib/delivery-customer/providers';
import { POST as postOrder } from '@/app/api/orders/route';
import { ensureAppLogin, makeRestaurant, makeUser } from '../helpers/db';

const admin = getAdminPool();

// Stand-in providers. They never reach a network; each records its calls.
function stub(name: 'razorpay' | 'cashfree', behaviour: 'ok' | 'throw' | 'no-id' = 'ok') {
  const calls: UpiIntentRequest[] = [];
  const provider: PaymentProvider = {
    name,
    async createUpiIntent(req) {
      calls.push(req);
      if (behaviour === 'throw') throw new PaymentCreateError(`${name} refused (400)`, true);
      const intent: UpiIntent = {
        provider: name,
        providerOrderId: behaviour === 'no-id' ? '' : `${name}_${randomUUID()}`,
        amountInr: req.amountInr,
        upiIntentUrl: `upi://pay?pa=test%40okaxis&am=${req.amountInr.toFixed(2)}`,
      };
      return intent;
    },
    verifyWebhook(): never { throw new WebhookSignatureError('not used here'); },
  };
  return { provider, calls };
}

let restaurant: string;
let paneer: string;
let gone: string;
let otherRestaurantItem: string;

beforeAll(async () => {
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  await runMigrations(admin);
  await ensureAppLogin(admin);
  restaurant = await makeRestaurant(admin);
  const other = await makeRestaurant(admin);
  await admin.query('UPDATE restaurant_nodes SET is_accepting_delivery = TRUE WHERE id = ANY($1)', [[restaurant, other]]);
  const ins = async (r: string, name: string, price: string, stock: boolean) => (await admin.query<{ id: string }>(
    `INSERT INTO menu_items (restaurant_id, pos_item_code, name, base_price, dietary, is_in_stock)
     VALUES ($1, $2, $3, $4, 'pure_veg', $5) RETURNING id`,
    [r, `k-${name}-${randomUUID()}`, name, price, stock])).rows[0].id;
  paneer = await ins(restaurant, 'Paneer', '250.50', true);
  gone = await ins(restaurant, 'Gone', '10.00', false);
  otherRestaurantItem = await ins(other, 'Elsewhere', '99.00', true);
});
afterAll(async () => { await admin.end(); });

async function diner() { return makeUser(admin, 'diner'); }

const cart = (items: { menuItemId: string; quantity: number }[]) => ({ restaurantId: restaurant, lines: items });
const key = () => randomUUID().replace(/-/g, '').slice(0, 24);

test('places a pending order priced from the database and pays through the primary provider', async () => {
  const user = await diner();
  const rz = stub('razorpay');
  const cf = stub('cashfree');
  const providers: CheckoutProviders = { primary: rz.provider, fallback: cf.provider };
  const r = await placeDeliveryOrder(await getPool(), user,
    { ...cart([{ menuItemId: paneer, quantity: 2 }]), clientKey: key(), auctionId: null }, providers);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.totalInr).toBe(526.05);
  expect(r.provider).toBe('razorpay');
  expect(rz.calls).toHaveLength(1);
  expect(rz.calls[0].amountInr).toBe(526.05);
  expect(cf.calls).toHaveLength(0);

  const { rows } = await admin.query(
    `SELECT status, payment_provider, total::float8 AS total FROM delivery_orders WHERE id = $1`, [r.orderId]);
  expect(rows[0]).toEqual({ status: 'pending_payment', payment_provider: 'razorpay', total: 526.05 });
  const lines = await admin.query(`SELECT unit_price::float8 AS unit, quantity, line_total::float8 AS total FROM delivery_order_lines WHERE order_id = $1`, [r.orderId]);
  expect(lines.rows).toEqual([{ unit: 250.5, quantity: 2, total: 501 }]);
});

test('falls back to Cashfree only when Razorpay throws, and stores the provider that answered', async () => {
  const user = await diner();
  const rz = stub('razorpay', 'throw');
  const cf = stub('cashfree');
  const r = await placeDeliveryOrder(await getPool(), user,
    { ...cart([{ menuItemId: paneer, quantity: 1 }]), clientKey: key(), auctionId: null },
    { primary: rz.provider, fallback: cf.provider });
  expect(r.ok && r.provider).toBe('cashfree');
  expect(rz.calls).toHaveLength(1);
  expect(cf.calls).toHaveLength(1);
});

// Updated (owner review item 5): a 2xx answer without an order id is ambiguous. The order may exist at
// Razorpay, so checkout must not fall back and must not store a row.
test('a Razorpay answer without an order id is ambiguous: no fallback, no order row', async () => {
  const user = await diner();
  const k = key();
  const rz = stub('razorpay', 'no-id');
  const cf = stub('cashfree');
  const r = await placeDeliveryOrder(await getPool(), user,
    { ...cart([{ menuItemId: paneer, quantity: 1 }]), clientKey: k, auctionId: null },
    { primary: rz.provider, fallback: cf.provider });
  expect(r).toEqual({ ok: false, code: 'PAYMENT_UNAVAILABLE' });
  expect(cf.calls).toHaveLength(0);
  const { rowCount } = await admin.query('SELECT 1 FROM delivery_orders WHERE client_key = $1', [k]);
  expect(rowCount).toBe(0);
});

test('no provider configured: 503-style PAYMENT_UNAVAILABLE and no order row', async () => {
  const user = await diner();
  const k = key();
  const r = await placeDeliveryOrder(await getPool(), user,
    { ...cart([{ menuItemId: paneer, quantity: 1 }]), clientKey: k, auctionId: null }, null);
  expect(r).toEqual({ ok: false, code: 'PAYMENT_UNAVAILABLE' });
  const { rowCount } = await admin.query('SELECT 1 FROM delivery_orders WHERE client_key = $1', [k]);
  expect(rowCount).toBe(0);
});

test('both providers fail: PAYMENT_UNAVAILABLE and no order row', async () => {
  const user = await diner();
  const k = key();
  const r = await placeDeliveryOrder(await getPool(), user,
    { ...cart([{ menuItemId: paneer, quantity: 1 }]), clientKey: k, auctionId: null },
    { primary: stub('razorpay', 'throw').provider, fallback: stub('cashfree', 'throw').provider });
  expect(r).toEqual({ ok: false, code: 'PAYMENT_UNAVAILABLE' });
  const { rowCount } = await admin.query('SELECT 1 FROM delivery_orders WHERE client_key = $1', [k]);
  expect(rowCount).toBe(0);
});

test('the same client key returns the same order and calls no provider again (idempotent)', async () => {
  const user = await diner();
  const rz = stub('razorpay');
  const providers = { primary: rz.provider, fallback: stub('cashfree').provider };
  const k = key();
  const first = await placeDeliveryOrder(await getPool(), user, { ...cart([{ menuItemId: paneer, quantity: 1 }]), clientKey: k, auctionId: null }, providers);
  const second = await placeDeliveryOrder(await getPool(), user, { ...cart([{ menuItemId: paneer, quantity: 3 }]), clientKey: k, auctionId: null }, providers);
  expect(first.ok && second.ok).toBe(true);
  if (!first.ok || !second.ok) return;
  expect(second.orderId).toBe(first.orderId);
  expect(second.reused).toBe(true);
  expect(rz.calls).toHaveLength(1);
});

test('rejects an out-of-stock item and does not call a provider', async () => {
  const user = await diner();
  const rz = stub('razorpay');
  const r = await placeDeliveryOrder(await getPool(), user,
    { ...cart([{ menuItemId: gone, quantity: 1 }]), clientKey: key(), auctionId: null },
    { primary: rz.provider, fallback: stub('cashfree').provider });
  expect(r).toEqual({ ok: false, code: 'OUT_OF_STOCK' });
  expect(rz.calls).toHaveLength(0);
});

test('rejects an item from another restaurant (UNKNOWN_ITEM)', async () => {
  const user = await diner();
  const r = await placeDeliveryOrder(await getPool(), user,
    { ...cart([{ menuItemId: otherRestaurantItem, quantity: 1 }]), clientKey: key(), auctionId: null },
    { primary: stub('razorpay').provider, fallback: stub('cashfree').provider });
  expect(r).toEqual({ ok: false, code: 'UNKNOWN_ITEM' });
});

test('a diner cannot attach an auction that is not theirs', async () => {
  const user = await diner();
  const owner = await diner();
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO mesh_food_auctions (diner_user_id, voice_query_transcript, raw_intent_payload, budget_ceiling_inr,
            max_sla_minutes, delivery_location)
     VALUES ($1, 'x', '{}'::jsonb, 500, 45, ST_SetSRID(ST_MakePoint(77.6, 12.9), 4326)::geography) RETURNING id`, [owner]);
  const r = await placeDeliveryOrder(await getPool(), user,
    { ...cart([{ menuItemId: paneer, quantity: 1 }]), clientKey: key(), auctionId: rows[0].id },
    { primary: stub('razorpay').provider, fallback: stub('cashfree').provider });
  expect(r).toEqual({ ok: false, code: 'AUCTION_NOT_FOUND' });
});

test('a runtime insert with a forged line price stores the menu price (trigger overwrites it)', async () => {
  const user = await diner();
  const orderId = randomUUID();
  await asRole(await getPool(), user, async (c) => {
    await c.query(
      `INSERT INTO delivery_orders (id, restaurant_id, diner_user_id, client_key, subtotal, gst, total,
              payment_provider, provider_order_id, upi_intent_url)
       VALUES ($1, $2, $3, $4, 250.50, 12.53, 263.03, 'razorpay', $5, 'upi://pay')`,
      [orderId, restaurant, user, key(), `forge_${randomUUID()}`]);
    await c.query(
      `INSERT INTO delivery_order_lines (order_id, menu_item_id, name_snapshot, unit_price, quantity, line_total)
       VALUES ($1, $2, 'Forged', 1.00, 1, 1.00)`,
      [orderId, paneer]);
  });
  const { rows } = await admin.query(
    `SELECT name_snapshot, unit_price::float8 AS unit, line_total::float8 AS total FROM delivery_order_lines WHERE order_id = $1`,
    [orderId]);
  expect(rows).toEqual([{ name_snapshot: 'Paneer', unit: 250.5, total: 250.5 }]);
});

test('the database refuses an order whose subtotal does not match its lines', async () => {
  const user = await diner();
  await expect(asRole(await getPool(), user, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO delivery_orders (restaurant_id, diner_user_id, client_key, subtotal, gst, total,
              payment_provider, provider_order_id, upi_intent_url)
       VALUES ($1, $2, $3, 999.00, 49.95, 1048.95, 'razorpay', $4, 'upi://pay') RETURNING id`,
      [restaurant, user, key(), `bad_${randomUUID()}`]);
    await c.query(
      `INSERT INTO delivery_order_lines (order_id, menu_item_id, name_snapshot, unit_price, quantity, line_total)
       VALUES ($1, $2, 'x', 0, 1, 0)`, [rows[0].id, paneer]);
  })).rejects.toThrow(/subtotal does not match/);
});

describe('POST /api/orders', () => {
  test('signed-out request is refused with 401', async () => {
    const res = await postOrder(new Request('http://t/api/orders', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.20' },
      body: JSON.stringify({ restaurantId: restaurant, lines: [{ menuItemId: paneer, quantity: 1 }], clientKey: key() }),
    }));
    expect(res.status).toBe(401);
  });

  test('a diner with a valid cart gets 201 and a pending order (stand-in providers)', async () => {
    const user = await diner();
    const rz = stub('razorpay');
    setCheckoutProvidersForTest({ primary: rz.provider, fallback: stub('cashfree').provider });
    try {
      const res = await postOrder(new Request('http://t/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-diner': user, 'x-forwarded-for': '203.0.113.21' },
        body: JSON.stringify({ restaurantId: restaurant, lines: [{ menuItemId: paneer, quantity: 1, unitPriceInr: 1 }], clientKey: key() }),
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.totalInr).toBe(263.03);
      expect(body.status).toBe('pending_payment');
      expect(rz.calls).toHaveLength(1);
    } finally {
      setCheckoutProvidersForTest(undefined);
    }
  });

  test('no providers configured answers 503 PAYMENT_UNAVAILABLE', async () => {
    const user = await diner();
    setCheckoutProvidersForTest(null);
    try {
      const res = await postOrder(new Request('http://t/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-diner': user, 'x-forwarded-for': '203.0.113.22' },
        body: JSON.stringify({ restaurantId: restaurant, lines: [{ menuItemId: paneer, quantity: 1 }], clientKey: key() }),
      }));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'PAYMENT_UNAVAILABLE' });
    } finally {
      setCheckoutProvidersForTest(undefined);
    }
  });
});
