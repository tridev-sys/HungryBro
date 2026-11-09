import { randomUUID } from 'node:crypto';
import { asRole, getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { PaymentCreateError, type PaymentProvider } from '@/lib/payments/types';
import { placeDeliveryOrder } from '@/lib/delivery-customer/checkout';
import { getOrderStatus } from '@/lib/delivery-customer/order-status';
import { submitVerifiedRating } from '@/lib/ratings/submit';
import { POST as postRating } from '@/app/api/ratings/route';
import { ensureAppLogin, makeRestaurant, makeUser } from '../helpers/db';

const admin = getAdminPool();
let restaurant: string;
let otherRestaurant: string;
let paneer: string;

beforeAll(async () => {
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  await runMigrations(admin);
  await ensureAppLogin(admin);
  restaurant = await makeRestaurant(admin);
  otherRestaurant = await makeRestaurant(admin);
  await admin.query('UPDATE restaurant_nodes SET is_accepting_delivery = TRUE WHERE id = ANY($1)', [[restaurant, otherRestaurant]]);
  paneer = (await admin.query<{ id: string }>(
    `INSERT INTO menu_items (restaurant_id, pos_item_code, name, base_price, dietary)
     VALUES ($1, $2, 'Paneer', '250.50', 'pure_veg') RETURNING id`, [restaurant, `r-${randomUUID()}`])).rows[0].id;
});
afterAll(async () => { await admin.end(); });

const refusing: PaymentProvider = {
  name: 'razorpay',
  async createUpiIntent() { return { provider: 'razorpay', providerOrderId: `order_${randomUUID().slice(0, 12)}`, amountInr: 0, upiIntentUrl: 'upi://x' }; },
  verifyWebhook() { throw new PaymentCreateError('unused'); },
};

async function paidOrder(diner: string) {
  const r = await placeDeliveryOrder(await getPool(), diner,
    { restaurantId: restaurant, lines: [{ menuItemId: paneer, quantity: 1 }], clientKey: randomUUID().replace(/-/g, ''), auctionId: null },
    { primary: refusing, fallback: refusing });
  if (!r.ok) throw new Error(r.code);
  const { rows } = await admin.query<{ provider_order_id: string; total: string }>(
    'SELECT provider_order_id, total::text FROM delivery_orders WHERE id = $1', [r.orderId]);
  await admin.query('SELECT app_apply_payment_event($1, $2, $3, $4, $5::bigint)',
    ['razorpay', `evt_${randomUUID()}`, 'payment.captured', rows[0].provider_order_id, Math.round(Number(rows[0].total) * 100)]);
  return r.orderId;
}

async function markDelivered(actor: string, orderId: string) {
  return asRole(await getPool(), actor, async (c) => {
    const { rows } = await c.query<{ id: string }>('SELECT app_mark_delivery_delivered($1) AS id', [orderId]);
    return rows[0].id;
  });
}

test('restaurant staff marks a kitchen order delivered and it gets a completed order reference', async () => {
  const diner = await makeUser(admin, 'diner');
  const staff = await makeUser(admin, 'restaurant_staff', restaurant);
  const id = await paidOrder(diner);
  const ref = await markDelivered(staff, id);
  expect(ref).toMatch(/^[0-9a-f-]{36}$/);
  const { rows } = await admin.query("SELECT status, order_ref_id, delivered_at FROM delivery_orders WHERE id = $1", [id]);
  expect(rows[0].status).toBe('delivered');
  expect(rows[0].order_ref_id).toBe(ref);
  expect(rows[0].delivered_at).not.toBeNull();
  const ordRef = await admin.query("SELECT status, settled_at FROM order_refs WHERE id = $1", [ref]);
  expect(ordRef.rows[0].status).toBe('completed');
  expect(ordRef.rows[0].settled_at).not.toBeNull();
});

test('a diner cannot mark their own order delivered', async () => {
  const diner = await makeUser(admin, 'diner');
  const id = await paidOrder(diner);
  await expect(markDelivered(diner, id)).rejects.toThrow(/NOT_AUTHORISED/);
});

test('staff of another restaurant cannot mark the order delivered', async () => {
  const diner = await makeUser(admin, 'diner');
  const outsider = await makeUser(admin, 'restaurant_staff', otherRestaurant);
  const id = await paidOrder(diner);
  await expect(markDelivered(outsider, id)).rejects.toThrow(/NOT_AUTHORISED/);
});

test('an order that is still waiting for payment cannot be marked delivered', async () => {
  const diner = await makeUser(admin, 'diner');
  const staff = await makeUser(admin, 'restaurant_staff', restaurant);
  const r = await placeDeliveryOrder(await getPool(), diner,
    { restaurantId: restaurant, lines: [{ menuItemId: paneer, quantity: 1 }], clientKey: randomUUID().replace(/-/g, ''), auctionId: null },
    { primary: refusing, fallback: refusing });
  if (!r.ok) throw new Error(r.code);
  await expect(markDelivered(staff, r.orderId)).rejects.toThrow(/ORDER_NOT_IN_KITCHEN/);
});

test('the diner rates a delivered order inside the 2-second window; the second rating is refused', async () => {
  const diner = await makeUser(admin, 'diner');
  const staff = await makeUser(admin, 'restaurant_staff', restaurant);
  const id = await paidOrder(diner);
  const ref = await markDelivered(staff, id);
  const first = await submitVerifiedRating(await getPool(), diner, { order_ref_id: ref, rating_score: 4, review_tags: [] });
  expect(first.ok).toBe(true);
  const again = await submitVerifiedRating(await getPool(), diner, { order_ref_id: ref, rating_score: 5, review_tags: [] });
  expect(again).toEqual({ ok: false, code: 'ALREADY_RATED' });
  expect((await getOrderStatus(await getPool(), diner, id))!.rated).toBe(true);
});

test('a rating after the 2-second window is refused by the database rule (not weakened)', async () => {
  const diner = await makeUser(admin, 'diner');
  const staff = await makeUser(admin, 'restaurant_staff', restaurant);
  const id = await paidOrder(diner);
  const ref = await markDelivered(staff, id);
  await new Promise((r) => setTimeout(r, 2200));
  const late = await submitVerifiedRating(await getPool(), diner, { order_ref_id: ref, rating_score: 3, review_tags: [] });
  expect(late).toEqual({ ok: false, code: 'WINDOW_EXPIRED' });
});

test('another diner cannot rate the order (404 on the route)', async () => {
  const diner = await makeUser(admin, 'diner');
  const stranger = await makeUser(admin, 'diner');
  const staff = await makeUser(admin, 'restaurant_staff', restaurant);
  const id = await paidOrder(diner);
  const ref = await markDelivered(staff, id);
  const res = await postRating(new Request('http://t/api/ratings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.60', cookie: '' },
    body: JSON.stringify({ order_ref_id: ref, rating_score: 5 }),
  }));
  expect(res.status).toBe(401);
  const res2 = await submitVerifiedRating(await getPool(), stranger, { order_ref_id: ref, rating_score: 5, review_tags: [] });
  expect(res2).toEqual({ ok: false, code: 'ORDER_NOT_FOUND' });
});
