import { randomUUID } from 'node:crypto';
import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { PaymentCreateError, type PaymentProvider } from '@/lib/payments/types';
import { getOrderStatus, statusText } from '@/lib/delivery-customer/order-status';
import { placeDeliveryOrder } from '@/lib/delivery-customer/checkout';
import { GET as getOrder } from '@/app/api/orders/[orderId]/route';
import { ensureAppLogin, makeRestaurant, makeUser } from '../helpers/db';

const admin = getAdminPool();
let restaurant: string;
let paneer: string;

beforeAll(async () => {
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  await runMigrations(admin);
  await ensureAppLogin(admin);
  restaurant = await makeRestaurant(admin);
  await admin.query(`UPDATE restaurant_nodes SET is_accepting_delivery = TRUE, name = 'Status House' WHERE id = $1`, [restaurant]);
  paneer = (await admin.query<{ id: string }>(
    `INSERT INTO menu_items (restaurant_id, pos_item_code, name, base_price, dietary)
     VALUES ($1, $2, 'Paneer', '250.50', 'pure_veg') RETURNING id`, [restaurant, `s-${randomUUID()}`])).rows[0].id;
});
afterAll(async () => { await admin.end(); });

const refusing: PaymentProvider = {
  name: 'razorpay',
  async createUpiIntent() { return { provider: 'razorpay', providerOrderId: `order_${randomUUID().slice(0, 12)}`, amountInr: 0, upiIntentUrl: 'upi://pay?pa=x%40y&am=526.05' }; },
  verifyWebhook() { throw new PaymentCreateError('unused'); },
};

async function order(userId: string) {
  const r = await placeDeliveryOrder(await getPool(), userId,
    { restaurantId: restaurant, lines: [{ menuItemId: paneer, quantity: 2 }], clientKey: randomUUID().replace(/-/g, ''), auctionId: null },
    { primary: refusing, fallback: refusing });
  if (!r.ok) throw new Error(r.code);
  return r.orderId;
}

test('the diner who placed the order sees its state, lines and pay link while pending', async () => {
  const diner = await makeUser(admin, 'diner');
  const id = await order(diner);
  const view = await getOrderStatus(await getPool(), diner, id);
  expect(view).not.toBeNull();
  expect(view!.status).toBe('pending_payment');
  expect(view!.statusText).toBe('Waiting for payment');
  expect(view!.restaurantName).toBe('Status House');
  expect(view!.totalInr).toBe(526.05);
  expect(view!.lines).toEqual([{ name: 'Paneer', quantity: 2, lineTotalInr: 501 }]);
  expect(view!.upiIntentUrl).toContain('upi://pay');
  expect(view!.rated).toBe(false);
});

test('another diner cannot see the order (row-level security): null, and 404 on the route', async () => {
  const owner = await makeUser(admin, 'diner');
  const stranger = await makeUser(admin, 'diner');
  const id = await order(owner);
  expect(await getOrderStatus(await getPool(), stranger, id)).toBeNull();
  const res = await getOrder(new Request(`http://t/api/orders/${id}`, { headers: { 'x-dev-diner': stranger, 'x-forwarded-for': '203.0.113.40' } }),
    { params: Promise.resolve({ orderId: id }) });
  expect(res.status).toBe(404);
});

test('after capture the order is in the kitchen and the pay link is gone', async () => {
  const diner = await makeUser(admin, 'diner');
  const id = await order(diner);
  const { rows } = await admin.query<{ provider_order_id: string; total: string }>(
    'SELECT provider_order_id, total::text FROM delivery_orders WHERE id = $1', [id]);
  await admin.query('SELECT app_apply_payment_event($1, $2, $3, $4, $5::bigint)',
    ['razorpay', `evt_${randomUUID()}`, 'payment.captured', rows[0].provider_order_id, Math.round(Number(rows[0].total) * 100)]);
  const view = await getOrderStatus(await getPool(), diner, id);
  expect(view!.status).toBe('in_kitchen');
  expect(view!.statusText).toBe('Preparing your order');
  expect(view!.upiIntentUrl).toBeNull();
});

test('status texts cover every state', () => {
  expect(statusText('pending_payment')).toBe('Waiting for payment');
  expect(statusText('in_kitchen')).toBe('Preparing your order');
  expect(statusText('delivered')).toBe('Delivered');
  expect(statusText('cancelled')).toBe('Cancelled');
});

test('the route answers 401 when signed out and 200 with the view for the owner', async () => {
  const diner = await makeUser(admin, 'diner');
  const id = await order(diner);
  const signedOut = await getOrder(new Request(`http://t/api/orders/${id}`, { headers: { 'x-forwarded-for': '203.0.113.41' } }),
    { params: Promise.resolve({ orderId: id }) });
  expect(signedOut.status).toBe(401);
  const owner = await getOrder(new Request(`http://t/api/orders/${id}`, { headers: { 'x-dev-diner': diner, 'x-forwarded-for': '203.0.113.42' } }),
    { params: Promise.resolve({ orderId: id }) });
  expect(owner.status).toBe(200);
  expect((await owner.json()).id).toBe(id);
});
