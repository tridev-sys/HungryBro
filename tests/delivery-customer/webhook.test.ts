import { createHmac, randomUUID } from 'node:crypto';
import { PaymentCreateError, type PaymentProvider, type UpiIntentRequest } from '@/lib/payments/types';
import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { ensureAppLogin, makeRestaurant, makeUser } from '../helpers/db';
import { placeDeliveryOrder } from '@/lib/delivery-customer/checkout';
import { checkoutProvidersFromEnv } from '@/lib/delivery-customer/providers';
import { CashfreeProvider } from '@/lib/payments/cashfree';
import { RazorpayProvider } from '@/lib/payments/razorpay';
import { POST as razorpayPost } from '@/app/api/webhooks/razorpay/route';
import { POST as cashfreePost } from '@/app/api/webhooks/cashfree/route';

const admin = getAdminPool();
const RZ = 'rz_webhook_test_secret';
const CF = 'cf_webhook_test_secret';
let restaurant: string;
let paneer: string;

beforeAll(async () => {
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  process.env.RAZORPAY_WEBHOOK_SECRET = RZ;
  process.env.CASHFREE_WEBHOOK_SECRET = CF;
  await runMigrations(admin);
  await ensureAppLogin(admin);
  restaurant = await makeRestaurant(admin);
  await admin.query('UPDATE restaurant_nodes SET is_accepting_delivery = TRUE WHERE id = $1', [restaurant]);
  paneer = (await admin.query<{ id: string }>(
    `INSERT INTO menu_items (restaurant_id, pos_item_code, name, base_price, dietary)
     VALUES ($1, $2, 'Paneer', '250.50', 'pure_veg') RETURNING id`,
    [restaurant, `w-${randomUUID()}`])).rows[0].id;
});
afterAll(async () => {
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  delete process.env.CASHFREE_WEBHOOK_SECRET;
  await admin.end();
});

// Stand-in provider: returns a known provider order id. Never calls a payment API.
function standIn(name: 'razorpay' | 'cashfree', providerOrderId: string): PaymentProvider {
  return {
    name,
    async createUpiIntent(req: UpiIntentRequest) {
      return { provider: name, providerOrderId, amountInr: req.amountInr, upiIntentUrl: 'upi://pay?pa=x%40y' };
    },
    verifyWebhook() { throw new Error('not used'); },
  };
}

// Stand-in that refuses definitively, so the router falls back to the other stand-in.
function refusing(name: 'razorpay' | 'cashfree'): PaymentProvider {
  return {
    name,
    async createUpiIntent() { throw new PaymentCreateError(`${name} refused (400)`, true); },
    verifyWebhook() { throw new Error('not used'); },
  };
}

async function pendingOrder(provider: 'razorpay' | 'cashfree' = 'razorpay') {
  const user = await makeUser(admin, 'diner');
  const providerOrderId = `order_${randomUUID().slice(0, 14)}`;
  const p = standIn(provider, providerOrderId);
  const r = await placeDeliveryOrder(await getPool(), user,
    { restaurantId: restaurant, lines: [{ menuItemId: paneer, quantity: 2 }], clientKey: randomUUID().replace(/-/g, ''), auctionId: null },
    { primary: provider === 'razorpay' ? p : refusing('razorpay'), fallback: provider === 'cashfree' ? p : standIn('cashfree', 'unused') });
  if (!r.ok) throw new Error(`setup failed: ${r.code}`);
  return { orderId: r.orderId, providerOrderId, totalInr: r.totalInr };
}

const rzSigned = (body: string, eventId: string, secret = RZ) => new Request('http://localhost:3000/api/webhooks/razorpay', {
  method: 'POST',
  headers: {
    'x-razorpay-signature': createHmac('sha256', secret).update(body).digest('hex'),
    'x-razorpay-event-id': eventId,
    'content-type': 'application/json',
  },
  body,
});
const rzCaptured = (providerOrderId: string, amountPaise: number) => JSON.stringify({
  event: 'payment.captured',
  payload: { payment: { entity: { id: `pay_${randomUUID()}`, order_id: providerOrderId, amount: amountPaise } } },
});

const cfSigned = (body: string, ts: string, secret = CF) => new Request('http://localhost:3000/api/webhooks/cashfree', {
  method: 'POST',
  headers: {
    'x-webhook-timestamp': ts,
    'x-webhook-signature': createHmac('sha256', secret).update(ts + body).digest('base64'),
    'content-type': 'application/json',
  },
  body,
});
const cfCaptured = (providerOrderId: string, amountRupees: number, paymentId: string) => JSON.stringify({
  type: 'PAYMENT_SUCCESS_WEBHOOK',
  data: { order: { order_id: providerOrderId, order_amount: amountRupees }, payment: { cf_payment_id: paymentId } },
});

async function statusOf(orderId: string) {
  const { rows } = await admin.query('SELECT status, paid_at FROM delivery_orders WHERE id = $1', [orderId]);
  return rows[0];
}

// Item 1: production webhook path changes real state (no fake adapter in this path).
test('a verified captured Razorpay webhook marks the pending order paid and moves it to the kitchen', async () => {
  const o = await pendingOrder('razorpay');
  const res = await razorpayPost(rzSigned(rzCaptured(o.providerOrderId, 52605), `evt_${randomUUID()}`));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, result: 'PAID' });
  const s = await statusOf(o.orderId);
  expect(s.status).toBe('in_kitchen');
  expect(s.paid_at).not.toBeNull();
});

test('checkout providers built from keys are the real adapters, never the fake', () => {
  const env = {
    RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'x', RAZORPAY_WEBHOOK_SECRET: 'y',
    CASHFREE_CLIENT_ID: 'c', CASHFREE_CLIENT_SECRET: 'c', CASHFREE_WEBHOOK_SECRET: 'd',
    PAYMENT_MERCHANT_VPA: 'merchant@okaxis', PAYMENT_PAYEE_NAME: 'Food',
  } as unknown as NodeJS.ProcessEnv;
  const p = checkoutProvidersFromEnv(env);
  expect(p!.primary).toBeInstanceOf(RazorpayProvider);
  expect(p!.fallback).toBeInstanceOf(CashfreeProvider);
  expect(checkoutProvidersFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
});

// Item 2: a paid amount that differs from the stored total is refused before any state change.
test('an event whose amount differs from the stored total (by one paisa) is rejected and changes nothing', async () => {
  const o = await pendingOrder('razorpay');
  const res = await razorpayPost(rzSigned(rzCaptured(o.providerOrderId, 52606), `evt_${randomUUID()}`));
  expect(res.status).toBe(422);
  expect(await res.json()).toEqual({ error: 'AMOUNT_MISMATCH' });
  expect((await statusOf(o.orderId)).status).toBe('pending_payment');
});

// Item 3: the Cashfree event key is the payment id plus type, not the signature header.
test('the Cashfree event key ignores the timestamp and signature (retries of one payment are one event)', async () => {
  const body = cfCaptured('order_x', 526.05, 'cf_pay_123');
  const first = new CashfreeProvider({ clientId: '', clientSecret: '', webhookSecret: CF, merchantVpa: '', payeeName: '' })
    .verifyWebhook(body, { 'x-webhook-timestamp': String(Date.now()), 'x-webhook-signature': createHmac('sha256', CF).update(String(Date.now()) + body).digest('base64') });
  const ts2 = String(Date.now() + 1000);
  const second = new CashfreeProvider({ clientId: '', clientSecret: '', webhookSecret: CF, merchantVpa: '', payeeName: '' })
    .verifyWebhook(body, { 'x-webhook-timestamp': ts2, 'x-webhook-signature': createHmac('sha256', CF).update(ts2 + body).digest('base64') });
  expect(first.providerEventId).toBe('cf_pay_123:PAYMENT_SUCCESS_WEBHOOK');
  expect(second.providerEventId).toBe(first.providerEventId);
});

test('a Cashfree retry with a new timestamp and signature is a duplicate and changes nothing again', async () => {
  const o = await pendingOrder('cashfree');
  const body = cfCaptured(o.providerOrderId, o.totalInr, `cf_pay_${randomUUID()}`);
  const ts1 = String(Date.now());
  expect((await cashfreePost(cfSigned(body, ts1))).status).toBe(200);
  const ts2 = String(Date.now() + 2000);
  const retry = await cashfreePost(cfSigned(body, ts2));
  expect(retry.status).toBe(409);
  expect((await statusOf(o.orderId)).status).toBe('in_kitchen');
});

// Item 4: the event row and the state change are one transaction.
test('the event record and the state change commit or roll back together', async () => {
  const o = await pendingOrder('razorpay');
  const eventId = `evt_tx_${randomUUID()}`;
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT app_apply_payment_event($1, $2, $3, $4, $5::bigint) AS r',
      ['razorpay', eventId, 'payment.captured', o.providerOrderId, 52605]);
    expect(r.rows[0].r).toBe('PAID');
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  const ev = await admin.query('SELECT 1 FROM webhook_events WHERE provider = $1 AND event_id = $2', ['razorpay', eventId]);
  expect(ev.rowCount).toBe(0);
  expect((await statusOf(o.orderId)).status).toBe('pending_payment');
});

test('an unknown order is acknowledged once and changes nothing; a failed payment event is ignored', async () => {
  const unknown = await razorpayPost(rzSigned(rzCaptured(`order_nope_${randomUUID()}`, 100), `evt_${randomUUID()}`));
  expect(await unknown.json()).toEqual({ ok: true, result: 'UNKNOWN_ORDER' });
  const o = await pendingOrder('razorpay');
  const failed = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_f', order_id: o.providerOrderId, amount: 52605 } } } });
  expect(await (await razorpayPost(rzSigned(failed, `evt_${randomUUID()}`))).json()).toEqual({ ok: true, result: 'IGNORED' });
  expect((await statusOf(o.orderId)).status).toBe('pending_payment');
});

test('a body over the 64 KiB limit is refused with 413 before parsing', async () => {
  const big = 'x'.repeat(70_000);
  const res = await razorpayPost(new Request('http://localhost:3000/api/webhooks/razorpay', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': String(big.length), 'x-razorpay-signature': 'a', 'x-razorpay-event-id': 'e' },
    body: big,
  }));
  expect(res.status).toBe(413);
});
