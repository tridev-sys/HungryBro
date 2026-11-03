import { getPool, runMigrations, asRole } from '@/lib/db/client';
import { makeRestaurant, makeUser, randomPhone } from '../helpers/db';

const pool = getPool();

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://food:change-me@localhost:5432/food_os';
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

test('order_refs has settled_at and rejects completed orders without it', async () => {
  const col = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'order_refs' AND column_name = 'settled_at'`);
  expect(col.rowCount).toBe(1);
  const rid = await makeRestaurant(pool);
  const did = await makeUser(pool);
  await expect(pool.query(
    `INSERT INTO order_refs (restaurant_id, diner_user_id, status) VALUES ($1, $2, 'completed')`, [rid, did]))
    .rejects.toThrow(/order_refs_completed_has_settlement/);
  await pool.query(
    `INSERT INTO order_refs (restaurant_id, diner_user_id, status, settled_at) VALUES ($1, $2, 'completed', NOW())`, [rid, did]);
});

test('menu_items.allergen_tags defaults to empty and rejects unknown tags', async () => {
  const rid = await makeRestaurant(pool);
  const ok = await pool.query(
    `INSERT INTO menu_items (restaurant_id, pos_item_code, name, base_price, dietary)
     VALUES ($1, 'P-1', 'Paneer', 300, 'pure_veg') RETURNING allergen_tags`, [rid]);
  expect(ok.rows[0].allergen_tags).toEqual([]);
  await expect(pool.query(
    `INSERT INTO menu_items (restaurant_id, pos_item_code, name, base_price, dietary, allergen_tags)
     VALUES ($1, 'P-2', 'Sesame', 100, 'vegan', ARRAY['sesame'])`, [rid])).rejects.toThrow(/menu_items_allergen_tags_valid/);
});

test('user_vpas enforces format and per-user RLS', async () => {
  const a = await makeUser(pool);
  const b = await makeUser(pool);
  await asRole(pool, a, (c) => c.query(`INSERT INTO user_vpas (user_id, vpa) VALUES ($1, 'ravi@okhdfcbank')`, [a]));
  await expect(asRole(pool, a, (c) => c.query(`INSERT INTO user_vpas (user_id, vpa) VALUES ($1, 'not-a-vpa')`, [a])))
    .rejects.toThrow(/user_vpas_format/);
  await expect(asRole(pool, b, (c) => c.query(`INSERT INTO user_vpas (user_id, vpa) VALUES ($1, 'x@okaxis')`, [a])))
    .rejects.toThrow(/row-level security/);
  const seenByB = await asRole(pool, b, async (c) => (await c.query('SELECT count(*)::int AS n FROM user_vpas')).rows[0].n);
  expect(seenByB).toBe(0);
});

test('app_lookup_user_by_phone and app_create_user_after_otp are SECURITY DEFINER, owned by food_admin, with a fixed search_path', async () => {
  const { rows } = await pool.query(`
    SELECT proname, prosecdef, pg_get_userbyid(proowner) AS owner, proconfig
    FROM pg_proc WHERE proname IN ('app_lookup_user_by_phone', 'app_create_user_after_otp')`);
  expect(rows).toHaveLength(2);
  for (const r of rows) {
    expect(r.prosecdef).toBe(true);
    expect(r.owner).toBe('food_admin');
    expect(r.proconfig.join(' ')).toMatch(/search_path=/);
  }
});

test('app_lookup_user_by_phone returns no row and creates no user for an unknown phone', async () => {
  const phone = randomPhone();
  const rows = await asRole(pool, null, async (c) =>
    (await c.query('SELECT id FROM app_lookup_user_by_phone($1)', [phone])).rows);
  expect(rows).toEqual([]);
  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE phone_number = $1', [phone]);
  expect(rowCount).toBe(0);
});

test('app_create_user_after_otp is rejected without a verified challenge and creates no user', async () => {
  const phone = randomPhone();
  // No challenge at all.
  await expect(asRole(pool, null, (c) => c.query('SELECT id FROM app_create_user_after_otp($1)', [phone])))
    .rejects.toThrow(/OTP_NOT_VERIFIED/);
  // Issued but not verified (consumed_at NULL).
  await pool.query(
    `INSERT INTO otp_challenges (phone_e164, code_hash, expires_at) VALUES ($1, 'test-hash', NOW() + INTERVAL '5 minutes')`,
    [phone]);
  await expect(asRole(pool, null, (c) => c.query('SELECT id FROM app_create_user_after_otp($1)', [phone])))
    .rejects.toThrow(/OTP_NOT_VERIFIED/);
  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE phone_number = $1', [phone]);
  expect(rowCount).toBe(0);
});

test('app_create_user_after_otp with a verified challenge creates exactly one user', async () => {
  const phone = randomPhone();
  await pool.query(
    `INSERT INTO otp_challenges (phone_e164, code_hash, expires_at, consumed_at)
     VALUES ($1, 'test-hash', NOW() + INTERVAL '5 minutes', NOW())`,
    [phone]);
  const [first, second] = await asRole(pool, null, async (c) => [
    (await c.query('SELECT id, role FROM app_create_user_after_otp($1)', [phone])).rows[0],
    (await c.query('SELECT id FROM app_create_user_after_otp($1)', [phone])).rows[0],
  ]);
  expect(first.role).toBe('diner');
  expect(second.id).toBe(first.id);
  const { rows } = await pool.query('SELECT id FROM users WHERE phone_number = $1', [phone]);
  expect(rows).toHaveLength(1);
});

test('webhook_events rejects a duplicate (provider, event_id) pair', async () => {
  await pool.query(`INSERT INTO webhook_events (provider, event_id) VALUES ('razorpay', 'evt_dup_test') ON CONFLICT DO NOTHING`);
  const again = await pool.query(
    `INSERT INTO webhook_events (provider, event_id) VALUES ('razorpay', 'evt_dup_test') ON CONFLICT DO NOTHING RETURNING 1`);
  expect(again.rowCount).toBe(0);
});

async function settledOrder(rid: string, diner: string, ago = '0 seconds'): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO order_refs (restaurant_id, diner_user_id, status, settled_at)
     VALUES ($1, $2, 'completed', NOW() - $3::interval) RETURNING id`, [rid, diner, ago]);
  return rows[0].id;
}

const rate = (diner: string, rid: string, orderId: string, score: number) =>
  asRole(pool, diner, (c) => c.query(
    `INSERT INTO verified_customer_ratings (restaurant_id, diner_user_id, order_ref_id, rating_score) VALUES ($1, $2, $3, $4)`,
    [rid, diner, orderId, score]));

const agg = async (rid: string) => (await pool.query(
  `SELECT rating_aggregate::float8 AS r, total_verified_reviews AS n FROM restaurant_nodes WHERE id = $1`, [rid])).rows[0];

test('a rating inserted 3 seconds after settled_at is rejected by RLS (decision 5)', async () => {
  const rid = await makeRestaurant(pool);
  const diner = await makeUser(pool);
  const late = await settledOrder(rid, diner, '3 seconds');
  await expect(rate(diner, rid, late, 5)).rejects.toThrow(/row-level security/);
});

test('a rating inserted 1 second after settled_at is accepted (decision 5)', async () => {
  const rid = await makeRestaurant(pool);
  const diner = await makeUser(pool);
  await expect(rate(diner, rid, await settledOrder(rid, diner, '1 second'), 5)).resolves.toBeDefined();
});

test('rating_aggregate and total_verified_reviews are recomputed in the insert transaction', async () => {
  const rid = await makeRestaurant(pool);
  const d1 = await makeUser(pool);
  const d2 = await makeUser(pool);
  await rate(d1, rid, await settledOrder(rid, d1), 5);
  expect(await agg(rid)).toEqual({ r: 5, n: 1 });
  await rate(d2, rid, await settledOrder(rid, d2), 4);
  expect(await agg(rid)).toEqual({ r: 4.5, n: 2 });
});

test('a rejected rating leaves the aggregate unchanged (same transaction)', async () => {
  const rid = await makeRestaurant(pool);
  const diner = await makeUser(pool);
  await rate(diner, rid, await settledOrder(rid, diner), 5);
  const late = await settledOrder(rid, diner, '3 seconds');
  await expect(rate(diner, rid, late, 1)).rejects.toThrow(/row-level security/);
  expect(await agg(rid)).toEqual({ r: 5, n: 1 });
});
