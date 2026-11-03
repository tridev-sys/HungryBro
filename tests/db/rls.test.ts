import { getPool, runMigrations, asRole } from '@/lib/db/client';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';

const pool = getPool();
const tag = randomUUID().slice(0, 8);

beforeAll(async () => { await runMigrations(pool); });
afterAll(async () => { await pool.end(); });

async function restaurant(c: pg.PoolClient, slug: string): Promise<string> {
  const { rows } = await c.query(
    `INSERT INTO restaurant_nodes (slug, name, fssai_license_number, gstin, location)
     VALUES ($1, $1, $2, '29ABCDE1234F1Z5', ST_SetSRID(ST_MakePoint(77.64, 12.97), 4326)) RETURNING id`,
    [slug, String(Math.floor(1e13 + Math.random() * 9e13))]);
  return rows[0].id;
}

async function user(c: pg.PoolClient, role: string, restaurantId: string | null = null): Promise<string> {
  const { rows } = await c.query(
    `INSERT INTO users (phone_number, role, restaurant_id) VALUES ($1, $2, $3) RETURNING id`,
    ['+91' + Math.floor(6e9 + Math.random() * 3e9), role, restaurantId]);
  return rows[0].id;
}

test('migrations are idempotent', async () => {
  expect(await runMigrations(pool)).toEqual([]);
});

test('food_admin has BYPASSRLS and is not superuser', async () => {
  const { rows } = await pool.query(
    `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'food_admin'`);
  expect(rows[0]).toEqual({ rolbypassrls: true, rolsuper: false });
});

test('new restaurant defaults to rating 0.00 with no reviews (Review Focus 2)', async () => {
  const c = await pool.connect();
  try {
    const id = await restaurant(c, `default-${tag}`);
    const { rows } = await c.query(`SELECT rating_aggregate::float8 AS r, total_verified_reviews FROM restaurant_nodes WHERE id = $1`, [id]);
    expect(rows[0]).toEqual({ r: 0, total_verified_reviews: 0 });
  } finally { c.release(); }
});

test('asRole with null userId runs without error and sees zero rows', async () => {
  const seen = await asRole(pool, null, async (cl) =>
    (await cl.query('SELECT count(*)::int AS n FROM mesh_food_auctions')).rows[0].n);
  expect(seen).toBe(0);
});

test('diner A cannot read diner B auction', async () => {
  const c = await pool.connect();
  let a: string, b: string;
  try {
    a = await user(c, 'diner');
    b = await user(c, 'diner');
    await c.query(
      `INSERT INTO mesh_food_auctions (diner_user_id, voice_query_transcript, raw_intent_payload, budget_ceiling_inr, max_sla_minutes, delivery_location)
       VALUES ($1, 'x', '{}', 800, 30, ST_SetSRID(ST_MakePoint(77.6, 12.9), 4326))`, [b]);
  } finally { c.release(); }
  const seen = await asRole(pool, a!, async (cl) =>
    (await cl.query('SELECT count(*)::int AS n FROM mesh_food_auctions')).rows[0].n);
  expect(seen).toBe(0);
});

test('staff of restaurant X cannot read KDS tickets of restaurant Y (Review Focus 4)', async () => {
  const c = await pool.connect();
  let staffX: string, rY: string;
  try {
    const rX = await restaurant(c, `x-${tag}`);
    rY = await restaurant(c, `y-${tag}`);
    staffX = await user(c, 'restaurant_staff', rX);
    await c.query(
      `INSERT INTO kds_tickets (restaurant_id, order_modality, station, items)
       VALUES ($1, 'DELIVERY', 'Curry', '[]')`, [rY]);
  } finally { c.release(); }
  const n = await asRole(pool, staffX!, async (cl) =>
    (await cl.query('SELECT count(*)::int AS n FROM kds_tickets WHERE restaurant_id = $1', [rY])).rows[0].n);
  expect(n).toBe(0);
});

test('rating insert rejected without a completed order (Review Focus 3)', async () => {
  const c = await pool.connect();
  let diner: string, orderId: string, rid: string;
  try {
    rid = await restaurant(c, `r-open-${tag}`);
    diner = await user(c, 'diner');
    const { rows } = await c.query(
      `INSERT INTO order_refs (restaurant_id, diner_user_id, status) VALUES ($1, $2, 'open') RETURNING id`, [rid, diner]);
    orderId = rows[0].id;
  } finally { c.release(); }
  await expect(asRole(pool, diner!, (cl) =>
    cl.query(`INSERT INTO verified_customer_ratings (restaurant_id, diner_user_id, order_ref_id, rating_score) VALUES ($1, $2, $3, 5)`,
      [rid!, diner!, orderId!]))).rejects.toThrow(/row-level security/);
});

test('rating insert allowed for the diner on their completed order', async () => {
  const c = await pool.connect();
  let diner: string, orderId: string, rid: string;
  try {
    rid = await restaurant(c, `r-done-${tag}`);
    diner = await user(c, 'diner');
    const { rows } = await c.query(
      `INSERT INTO order_refs (restaurant_id, diner_user_id, status, settled_at) VALUES ($1, $2, 'completed', NOW()) RETURNING id`, [rid, diner]);
    orderId = rows[0].id;
  } finally { c.release(); }
  await asRole(pool, diner!, (cl) =>
    cl.query(`INSERT INTO verified_customer_ratings (restaurant_id, diner_user_id, order_ref_id, rating_score) VALUES ($1, $2, $3, 5)`,
      [rid!, diner!, orderId!]));
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM verified_customer_ratings WHERE order_ref_id = $1`, [orderId!]);
  expect(rows[0].n).toBe(1);
});
