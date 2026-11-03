import { getAdminPool, getPool, runMigrations, asRole } from '@/lib/db/client';
import { ensureAppLogin } from '../helpers/db';
import { makeUser, makeRestaurant } from '../helpers/mesh-fixtures';
import type pg from 'pg';

const admin = getAdminPool();
let pool: pg.Pool; // runtime pool (food_app_login), RLS applies
const P = { lat: 12.9716, lng: 77.6412 };

beforeAll(async () => {
  await runMigrations(admin);
  await ensureAppLogin(admin);
  pool = await getPool();
});
afterAll(async () => { await pool.end(); await admin.end(); });

test('app_restaurant_staff_ids returns only that restaurant\'s staff and kitchen leads', async () => {
  const rX = await makeRestaurant(admin, { lat: P.lat, lng: P.lng });
  const rY = await makeRestaurant(admin, { lat: P.lat, lng: P.lng });
  const staffX = await makeUser(admin, 'restaurant_staff', rX);
  const leadX = await makeUser(admin, 'kitchen_lead', rX);
  const staffY = await makeUser(admin, 'restaurant_staff', rY);
  await makeUser(admin, 'diner', rX); // not staff, even though attached to rX
  const caller = await makeUser(admin, 'diner');

  const ids = await asRole(pool, caller, (c) =>
    c.query('SELECT id FROM app_restaurant_staff_ids($1) AS t(id)', [rX]).then((r) => r.rows.map((x) => x.id as string)));
  expect(ids.sort()).toEqual([staffX, leadX].sort());
  expect(ids).not.toContain(staffY);
});

test('a food_app session cannot read users of another restaurant directly', async () => {
  const rX = await makeRestaurant(admin, { lat: P.lat, lng: P.lng });
  const rY = await makeRestaurant(admin, { lat: P.lat, lng: P.lng });
  const staffX = await makeUser(admin, 'restaurant_staff', rX);
  const staffY = await makeUser(admin, 'restaurant_staff', rY);

  const { rows } = await asRole(pool, staffX, (c) =>
    c.query('SELECT id FROM users WHERE restaurant_id = $1', [rY]));
  expect(rows).toEqual([]);
  const self = await asRole(pool, staffX, (c) => c.query('SELECT id FROM users WHERE id = $1', [staffY]));
  expect(self.rows).toEqual([]);
});
