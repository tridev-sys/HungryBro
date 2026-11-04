import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { ensureAppLogin } from '../helpers/db';
import { makeRestaurant, makeUser } from '../helpers/mesh-fixtures';

const admin = getAdminPool();
beforeAll(async () => { await runMigrations(admin); await ensureAppLogin(admin); });
afterAll(async () => { await admin.end(); });

test('010 creates the outlet subscription and pass-through ledger tables with RLS on', async () => {
  const { rows } = await admin.query(
    `SELECT c.relname, c.relrowsecurity FROM pg_class c
      WHERE c.relname IN ('outlet_subscriptions', 'delivery_pass_through_costs') ORDER BY c.relname`);
  expect(rows).toEqual([
    { relname: 'delivery_pass_through_costs', relrowsecurity: true },
    { relname: 'outlet_subscriptions', relrowsecurity: true },
  ]);
});

test('the outlet monthly fee defaults to 499.00 and is NUMERIC(10,2)', async () => {
  const rid = await makeRestaurant(admin, { lat: 12.97, lng: 77.64 });
  const { rows } = await admin.query(
    `INSERT INTO outlet_subscriptions (restaurant_id, outlet_label, period_start, period_end)
     VALUES ($1, 'Indiranagar', CURRENT_DATE, CURRENT_DATE + 30) RETURNING monthly_fee_inr::text AS fee`, [rid]);
  expect(rows[0].fee).toBe('499.00');
  const { rows: cols } = await admin.query(
    `SELECT numeric_precision, numeric_scale FROM information_schema.columns
      WHERE table_name = 'outlet_subscriptions' AND column_name = 'monthly_fee_inr'`);
  expect(cols[0]).toEqual({ numeric_precision: 10, numeric_scale: 2 });
});

test('the pass-through ledger has no DB default cost (the 50 INR baseline is config only)', async () => {
  const { rows } = await admin.query(
    `SELECT column_default FROM information_schema.columns
      WHERE table_name = 'delivery_pass_through_costs' AND column_name = 'cost_inr'`);
  expect(rows[0].column_default).toBeNull();
});

test('prep_time_minutes is on restaurant_nodes with the 12 minute estimate as default', async () => {
  const rid = await makeRestaurant(admin, { lat: 12.97, lng: 77.64 });
  const { rows } = await admin.query('SELECT prep_time_minutes FROM restaurant_nodes WHERE id = $1', [rid]);
  expect(rows[0].prep_time_minutes).toBe(12);
});

test('food_app cannot write outlet subscriptions or the pass-through ledger', async () => {
  const rid = await makeRestaurant(admin, { lat: 12.97, lng: 77.64 });
  const app = await getPool();
  await expect(app.query(
    `INSERT INTO outlet_subscriptions (restaurant_id, outlet_label, period_start, period_end)
     VALUES ($1, 'X', CURRENT_DATE, CURRENT_DATE + 30)`, [rid])).rejects.toThrow(/permission denied|row-level security/);
  await expect(app.query(
    `INSERT INTO delivery_pass_through_costs (restaurant_id, delivery_id, provider, cost_inr)
     VALUES ($1, $2, 'shadowfax', 50)`, [rid, `d-${Date.now()}`])).rejects.toThrow(/permission denied|row-level security/);
});

test('food_app staff see only their own restaurant outlet subscriptions (RLS)', async () => {
  const mine = await makeRestaurant(admin, { lat: 12.97, lng: 77.64 });
  const other = await makeRestaurant(admin, { lat: 12.98, lng: 77.65 });
  await admin.query(
    `INSERT INTO outlet_subscriptions (restaurant_id, outlet_label, period_start, period_end)
     VALUES ($1, 'Mine', CURRENT_DATE, CURRENT_DATE + 30), ($2, 'Theirs', CURRENT_DATE, CURRENT_DATE + 30)`, [mine, other]);
  const staff = await makeUser(admin, 'restaurant_staff', mine);
  const app = await getPool();
  const rows = await (await import('@/lib/db/client')).asRole(app, staff, async (c) =>
    (await c.query<{ outlet_label: string }>('SELECT outlet_label FROM outlet_subscriptions')).rows);
  expect(rows.map((r) => r.outlet_label)).toEqual(['Mine']);
});
