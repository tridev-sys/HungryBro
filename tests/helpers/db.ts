import { encryptCredentials, loadPosKey } from '../../lib/pos/credentials';
import pg from 'pg';
import { randomUUID, randomInt } from 'node:crypto';

const CLUSTER_LOCK_KEY = 'food_os_test_cluster_ddl';

// Runs fn while holding a lock shared by every test run on this server. Roles and role memberships
// are cluster-wide catalogs, so two runs writing them at once fail with "tuple concurrently updated".
// pg_advisory_lock is scoped to the database it is taken in, and each run has its own database, so
// the lock is taken in the maintenance database 'postgres', which all runs share.
export async function withClusterLock<T>(fn: () => Promise<T>): Promise<T> {
  const raw = process.env.ADMIN_DATABASE_URL;
  if (!raw) throw new Error('ADMIN_DATABASE_URL is not set');
  const url = new URL(raw);
  url.pathname = '/postgres';
  const lock = new pg.Client({ connectionString: url.toString() });
  await lock.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(hashtext($1))', [CLUSTER_LOCK_KEY]);
    try {
      return await fn();
    } finally {
      await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [CLUSTER_LOCK_KEY]);
    }
  } finally {
    await lock.end();
  }
}

// Sets food_app_login's password to the one in APP_DATABASE_URL, so the runtime pool can connect
// in tests. Test database only. The role DDL runs under withClusterLock, so concurrent runs
// (each with its own database) cannot interleave their writes to the cluster catalogs.
export async function ensureAppLogin(admin: pg.Pool): Promise<void> {
  const raw = process.env.APP_DATABASE_URL;
  if (!raw) throw new Error('APP_DATABASE_URL is not set');
  const password = decodeURIComponent(new URL(raw).password);
  await withClusterLock(() => applyAppLogin(admin, password));
}

async function applyAppLogin(admin: pg.Pool, password: string): Promise<void> {
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_app_login') THEN
        CREATE ROLE food_app_login LOGIN;
      END IF;
    END $$`);
    await c.query(`ALTER ROLE food_app_login WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${c.escapeLiteral(password)}`);
    await c.query('GRANT food_app TO food_app_login');
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

export const randomPhone = () => '+919' + String(randomInt(100_000_000, 999_999_999));

export async function makeRestaurant(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO restaurant_nodes (slug, name, fssai_license_number, gstin, location)
     VALUES ($1, $1, $2, '29ABCDE1234F1Z5', ST_SetSRID(ST_MakePoint(77.64, 12.97), 4326)) RETURNING id`,
    [`r-${randomUUID()}`, String(randomInt(1e13, 1e14))]);
  return rows[0].id;
}

export async function makeUser(pool: pg.Pool, role = 'diner', restaurantId: string | null = null): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (phone_number, role, restaurant_id) VALUES ($1, $2, $3) RETURNING id`,
    [randomPhone(), role, restaurantId]);
  return rows[0].id;
}

// Creates a restaurant_nodes row and its restaurant_pos_credentials row through the admin test pool
// (not used by app code). Credentials are stored encrypted, as in production.
export async function createRestaurant(pool: pg.Pool, opts: { provider: string; credentials: object }): Promise<string> {
  const stored = encryptCredentials(opts.credentials as Record<string, unknown>, loadPosKey());
  const { rows } = await pool.query(
    `WITH r AS (
       INSERT INTO restaurant_nodes (slug, name, fssai_license_number, gstin, pos_provider, location)
       VALUES ($1, $1, $2, '29ABCDE1234F1Z5', $3, ST_SetSRID(ST_MakePoint(77.64, 12.97), 4326))
       RETURNING id, pos_provider
     )
     INSERT INTO restaurant_pos_credentials (restaurant_id, pos_provider, ciphertext)
     SELECT r.id, r.pos_provider, $4::jsonb FROM r RETURNING restaurant_id AS id`,
    [`t-${randomUUID().slice(0, 8)}`, String(Math.floor(1e13 + Math.random() * 9e13)), opts.provider, JSON.stringify(stored)]);
  return rows[0].id;
}
