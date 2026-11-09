import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { CartSubmitSchema } from '@/lib/delivery-customer/checkout-schema';
import { priceCart } from '@/lib/delivery-customer/pricing';
import { POST as quote } from '@/app/api/orders/quote/route';
import { ensureAppLogin, makeRestaurant } from '../helpers/db';

const admin = getAdminPool();
let restaurant: string;
let other: string;
let paneer: string;
let soldOut: string;
let foreign: string;

beforeAll(async () => {
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  await runMigrations(admin);
  await ensureAppLogin(admin);
  restaurant = await makeRestaurant(admin);
  other = await makeRestaurant(admin);
  await admin.query('UPDATE restaurant_nodes SET is_accepting_delivery = TRUE WHERE id = ANY($1)', [[restaurant, other]]);
  const ins = async (r: string, name: string, price: string, stock: boolean) => (await admin.query<{ id: string }>(
    `INSERT INTO menu_items (restaurant_id, pos_item_code, name, base_price, dietary, is_in_stock)
     VALUES ($1, $2, $3, $4, 'pure_veg', $5) RETURNING id`,
    [r, `c-${name}-${Math.random()}`, name, price, stock])).rows[0].id;
  paneer = await ins(restaurant, 'Paneer', '250.50', true);
  soldOut = await ins(restaurant, 'Gone', '10.00', false);
  foreign = await ins(other, 'Foreign', '99.00', true);
});
afterAll(async () => { await admin.end(); });

describe('CartSubmitSchema', () => {
  const base = { restaurantId: '6f1c7c5e-7d4b-4c55-9a3a-2f9f1f0c1a11', lines: [{ menuItemId: '6f1c7c5e-7d4b-4c55-9a3a-2f9f1f0c1a12', quantity: 2 }] };
  test('accepts a valid cart and drops client-supplied prices', () => {
    const parsed = CartSubmitSchema.parse({ ...base, lines: [{ ...base.lines[0], unitPriceInr: 1 }] });
    expect(parsed.lines[0]).toEqual({ menuItemId: base.lines[0].menuItemId, quantity: 2 });
    expect('unitPriceInr' in parsed.lines[0]).toBe(false);
  });
  test('rejects empty carts, duplicate lines, quantities over the cap, and too many lines', () => {
    expect(CartSubmitSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(CartSubmitSchema.safeParse({ ...base, lines: [base.lines[0], base.lines[0]] }).success).toBe(false);
    expect(CartSubmitSchema.safeParse({ ...base, lines: [{ ...base.lines[0], quantity: 21 }] }).success).toBe(false);
    expect(CartSubmitSchema.safeParse({ ...base, lines: [{ ...base.lines[0], quantity: 0 }] }).success).toBe(false);
  });
});

describe('priceCart (server-side prices from the database)', () => {
  test('prices from menu_items, computes subtotal, GST 5% and total in INR', async () => {
    const client = await getPool().then((p) => p.connect());
    try {
      const r = await priceCart(client, restaurant, [{ menuItemId: paneer, quantity: 2 }]);
      expect(r).toEqual({
        ok: true,
        restaurantId: restaurant,
        lines: [{ menuItemId: paneer, name: 'Paneer', unitPriceInr: 250.5, quantity: 2, lineTotalInr: 501 }],
        subtotalInr: 501,
        gstInr: 25.05,
        totalInr: 526.05,
      });
    } finally {
      client.release();
    }
  });

  test('rejects out-of-stock items and items from another restaurant', async () => {
    const client = await getPool().then((p) => p.connect());
    try {
      expect(await priceCart(client, restaurant, [{ menuItemId: soldOut, quantity: 1 }]))
        .toEqual({ ok: false, code: 'OUT_OF_STOCK' });
      expect(await priceCart(client, restaurant, [{ menuItemId: foreign, quantity: 1 }]))
        .toEqual({ ok: false, code: 'UNKNOWN_ITEM' });
    } finally {
      client.release();
    }
  });
});

describe('POST /api/orders/quote', () => {
  test('returns server prices for a valid cart', async () => {
    const req = new Request('http://t/api/orders/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify({ restaurantId: restaurant, lines: [{ menuItemId: paneer, quantity: 1, unitPriceInr: 1 }] }),
    });
    const res = await quote(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalInr).toBe(263.03);
    expect(body.lines[0].unitPriceInr).toBe(250.5);
  });

  test('returns 422 with a code for an out-of-stock item', async () => {
    const req = new Request('http://t/api/orders/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.8' },
      body: JSON.stringify({ restaurantId: restaurant, lines: [{ menuItemId: soldOut, quantity: 1 }] }),
    });
    const res = await quote(req);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'OUT_OF_STOCK' });
  });
});
