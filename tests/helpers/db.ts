import { encryptCredentials, loadPosKey } from '../../lib/pos/credentials';
import type pg from 'pg';
import { randomUUID, randomInt } from 'node:crypto';

// Sets food_app_login's password to the one in APP_DATABASE_URL, so the runtime pool can connect
// in tests. Test database only. Takes an advisory lock because several test files call it in parallel.
export async function ensureAppLogin(admin: pg.Pool): Promise<void> {
  const raw = process.env.APP_DATABASE_URL;
  if (!raw) throw new Error('APP_DATABASE_URL is not set');
  const password = decodeURIComponent(new URL(raw).password);
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('food_app_login_test'))`);
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
