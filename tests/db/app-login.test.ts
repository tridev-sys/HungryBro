import { vi } from 'vitest';
import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { ensureAppLogin, makeUser } from '../helpers/db';

const admin = getAdminPool();
beforeAll(async () => {
  await runMigrations(admin);
  await ensureAppLogin(admin);
});
afterAll(async () => { await admin.end(); });

test('the runtime pool logs in as food_app_login, which is not a superuser and does not bypass RLS', async () => {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT current_user AS u, r.rolsuper, r.rolbypassrls
       FROM pg_roles r WHERE r.rolname = current_user`);
  expect(rows[0]).toEqual({ u: 'food_app_login', rolsuper: false, rolbypassrls: false });
});

test('a food_app_login connection cannot read a mesh auction owned by another diner (RLS enforced)', async () => {
  const dinerA = await makeUser(admin, 'diner');
  const dinerB = await makeUser(admin, 'diner');
  const { rows } = await admin.query(
    `INSERT INTO mesh_food_auctions
       (diner_user_id, voice_query_transcript, raw_intent_payload, budget_ceiling_inr, max_sla_minutes, delivery_location)
     VALUES ($1, 'biryani', '{}'::jsonb, 300, 30, ST_SetSRID(ST_MakePoint(77.64, 12.97), 4326)::geography)
     RETURNING id`,
    [dinerA]);
  const auctionId = rows[0].id;

  const pool = await getPool();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.user_id', $1, true)`, [dinerB]);
    const seenByB = await c.query('SELECT id FROM mesh_food_auctions WHERE id = $1', [auctionId]);
    expect(seenByB.rows).toHaveLength(0);
    await c.query('ROLLBACK');

    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.user_id', $1, true)`, [dinerA]);
    const seenByA = await c.query('SELECT id FROM mesh_food_auctions WHERE id = $1', [auctionId]);
    expect(seenByA.rows).toHaveLength(1);
    await c.query('ROLLBACK');
  } finally {
    c.release();
  }
});

test('a food_app_login connection cannot read restaurant_pos_credentials directly', async () => {
  const pool = await getPool();
  await expect(pool.query('SELECT count(*) FROM restaurant_pos_credentials'))
    .rejects.toThrow(/permission denied/);
});

test('getPool refuses a superuser URL', async () => {
  const saved = process.env.APP_DATABASE_URL;
  process.env.APP_DATABASE_URL = process.env.ADMIN_DATABASE_URL; // the owner (superuser) login in the test database
  vi.resetModules();
  try {
    const fresh = await import('@/lib/db/client');
    await expect(fresh.getPool()).rejects.toThrow(/non-superuser/);
  } finally {
    process.env.APP_DATABASE_URL = saved;
    vi.resetModules();
  }
});
