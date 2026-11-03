import { getAdminPool, runMigrations } from '@/lib/db/client';
import { asIntegration } from '@/lib/db/integration';
import { upsertMenu, setStock, EmptyMenuError } from '@/lib/pos/upsert';
import { createRestaurant } from '../helpers/db';
import type { MenuItemUpsert } from '@/lib/pos/types';

const pool = getAdminPool();
beforeAll(async () => { await runMigrations(pool); });
afterAll(async () => { await pool.end(); });

const item = (code: string, price = 100, inStock = true): MenuItemUpsert => ({
  pos_item_code: code, name: `Item ${code}`, base_price: price, is_in_stock: inStock,
  category_name: 'Test', station: 'General',
});

const count = async (rid: string) =>
  (await pool.query('SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1', [rid])).rows[0].n;

test('upsert inserts then updates without duplicating rows', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('a'), item('b')], { full: true }));
  const second = await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('a', 120), item('b')], { full: true }));
  expect(second).toMatchObject({ inserted: 0, updated: 2 });
  expect(await count(rid)).toBe(2);
  const { rows } = await pool.query('SELECT base_price::float8 AS p FROM menu_items WHERE restaurant_id = $1 AND pos_item_code = $2', [rid, 'a']);
  expect(rows[0].p).toBe(120);
});

test('full sync marks missing items out of stock and never deletes them (Review Focus 4)', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('a'), item('gone')], { full: true }));
  const r = await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('a')], { full: true }));
  expect(r.markedOutOfStock).toBe(1);
  expect(await count(rid)).toBe(2);
  const { rows } = await pool.query('SELECT is_in_stock FROM menu_items WHERE restaurant_id = $1 AND pos_item_code = $2', [rid, 'gone']);
  expect(rows[0].is_in_stock).toBe(false);
});

test('an empty full sync throws and changes nothing (Review Focus 4)', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('a')], { full: true }));
  await expect(asIntegration(pool, rid, (c) => upsertMenu(c, rid, [], { full: true }))).rejects.toThrow(EmptyMenuError);
  expect(await count(rid)).toBe(1);
  const { rows } = await pool.query('SELECT is_in_stock FROM menu_items WHERE restaurant_id = $1', [rid]);
  expect(rows[0].is_in_stock).toBe(true);
});

test('integration context for restaurant A cannot write restaurant B menu', async () => {
  const a = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  const b = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  await asIntegration(pool, b, (c) => upsertMenu(c, b, [item('x')], { full: true }));
  const changed = await asIntegration(pool, a, (c) => setStock(c, b, 'x', false));
  expect(changed).toBe(0);
  const { rows } = await pool.query('SELECT is_in_stock FROM menu_items WHERE restaurant_id = $1', [b]);
  expect(rows[0].is_in_stock).toBe(true);
});

test('setStock flips one item for the owning restaurant', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('y')], { full: true }));
  expect(await asIntegration(pool, rid, (c) => setStock(c, rid, 'y', false))).toBe(1);
});

test('POS sync never overwrites dietary set by the owner (Decision 7)', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('j')], { full: true }));
  await pool.query(`UPDATE menu_items SET dietary = 'jain' WHERE restaurant_id = $1 AND pos_item_code = 'j'`, [rid]);
  await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('j', 120)], { full: true }));
  const { rows } = await pool.query(
    `SELECT dietary, base_price::float8 AS p FROM menu_items WHERE restaurant_id = $1 AND pos_item_code = 'j'`, [rid]);
  expect(rows[0]).toEqual({ dietary: 'jain', p: 120 });
});
