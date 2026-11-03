import { getAdminPool, getPool, runMigrations, asRole } from '@/lib/db/client';
import { asSession } from '@/lib/db/session';
import { seedDineRestaurant, seedMenu, seedStaff } from '@/tests/helpers/seed';

const pool = await getPool();
beforeAll(async () => { await runMigrations(getAdminPool()); });
afterAll(async () => { await pool.end(); });

test('a session token sees only its own session (Review Focus 2)', async () => {
  const a = await seedDineRestaurant(getAdminPool());
  const b = await seedDineRestaurant(getAdminPool());
  const seen = await asSession(pool, { sessionToken: a.sessionToken }, async (c) =>
    (await c.query('SELECT id FROM tabletop_sessions')).rows.map((r) => r.id));
  expect(seen).toEqual([a.sessionId]);
  expect(b.sessionId).not.toBe(a.sessionId);
  const none = await asSession(pool, { sessionToken: 'f'.repeat(64) }, async (c) =>
    (await c.query('SELECT id FROM tabletop_sessions')).rows);
  expect(none).toEqual([]);
});

test('a table signature reveals the open session; a wrong signature reveals nothing (Review Focus 2)', async () => {
  const a = await seedDineRestaurant(getAdminPool());
  const good = await asSession(pool, { tableSignature: a.signature }, async (c) =>
    (await c.query('SELECT id FROM tabletop_sessions WHERE table_id = $1', [a.tableId])).rows.map((r) => r.id));
  expect(good).toEqual([a.sessionId]);
  const bad = await asSession(pool, { tableSignature: '0'.repeat(32) }, async (c) =>
    (await c.query('SELECT id FROM tabletop_sessions WHERE table_id = $1', [a.tableId])).rows);
  expect(bad).toEqual([]);
});

test('a table holds only one open session', async () => {
  const a = await seedDineRestaurant(getAdminPool());
  await expect(getAdminPool().query(
    `INSERT INTO tabletop_sessions (table_id, session_token) VALUES ($1, $2)`,
    [a.tableId, 'e'.repeat(64)])).rejects.toMatchObject({ code: '23505' });
});

test('a diner session fires tickets only for its own restaurant (Review Focus 2)', async () => {
  const a = await seedDineRestaurant(getAdminPool());
  const other = await seedDineRestaurant(getAdminPool());
  const fire = (restaurantId: string) => asSession(
    pool, { sessionToken: a.sessionToken, tableSignature: a.signature }, (c) =>
      c.query(`INSERT INTO kds_tickets (restaurant_id, session_id, order_modality, station, items)
               VALUES ($1, $2, 'DINE_IN', 'Curry', '[]')`, [restaurantId, a.sessionId]));
  await expect(fire(a.restaurantId)).resolves.toBeDefined();
  await expect(fire(other.restaurantId)).rejects.toThrow(/row-level security/);
});

test('only same-restaurant staff can update active_kds_load (decision 2)', async () => {
  const a = await seedDineRestaurant(getAdminPool());
  const b = await seedDineRestaurant(getAdminPool());
  const staffA = await seedStaff(getAdminPool(), a.restaurantId);
  const upd = (userId: string | null, rid: string) => asRole(pool, userId, (c) =>
    c.query(`UPDATE restaurant_nodes SET active_kds_load = 0.5 WHERE id = $1`, [rid]));
  expect((await upd(staffA, a.restaurantId)).rowCount).toBe(1);
  expect((await upd(staffA, b.restaurantId)).rowCount).toBe(0);
  expect((await upd(null, a.restaurantId)).rowCount).toBe(0);
});

test('menu_items rejects an unknown allergen tag', async () => {
  const a = await seedDineRestaurant(getAdminPool());
  await expect(getAdminPool().query(
    `INSERT INTO menu_items (restaurant_id, pos_item_code, name, base_price, dietary, allergen_tags)
     VALUES ($1, 'BAD-1', 'Test', 100, 'pure_veg', ARRAY['sesame']::text[])`, [a.restaurantId]))
    .rejects.toMatchObject({ code: '23514' });
});

test('seedMenu gives the four fixture items with their stations', async () => {
  const a = await seedDineRestaurant(getAdminPool());
  const m = await seedMenu(getAdminPool(), a.restaurantId);
  const { rows } = await pool.query(
    `SELECT mi.id, mi.base_price::float8 AS price, mc.station
       FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id
      WHERE mi.restaurant_id = $1 ORDER BY mi.base_price`, [a.restaurantId]);
  expect(rows.map((r) => [r.price, r.station])).toEqual([[60, 'Tandoor'], [80, 'Pantry'], [300, 'Curry'], [400, 'Tandoor']]);
  expect(m.paneerTikka).toBeDefined();
});
