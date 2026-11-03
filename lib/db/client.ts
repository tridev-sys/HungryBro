import pg from 'pg';

export { runMigrations } from './migrate';

let appPool: Promise<pg.Pool> | undefined;

/**
 * Runtime pool for request traffic. Connects with APP_DATABASE_URL, a login role that is a
 * member of food_app (created once by db/bootstrap/002_app_login.sql). Row-level security
 * applies to that role. The first call opens a connection and refuses a superuser, so a
 * superuser URL fails at startup instead of silently bypassing RLS.
 */
export function getPool(): Promise<pg.Pool> {
  if (!appPool) {
    appPool = openAppPool().catch((err: unknown) => {
      appPool = undefined;
      throw err;
    });
  }
  return appPool;
}

async function openAppPool(): Promise<pg.Pool> {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error('APP_DATABASE_URL is not set');
  // Fail fast when the pool is exhausted instead of queueing forever.
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
      if (rows.length !== 1 || rows[0].rolsuper) {
        throw new Error('APP_DATABASE_URL must log in as a non-superuser role; refusing to start');
      }
    } finally {
      client.release();
    }
  } catch (err) {
    await pool.end().catch(() => undefined);
    throw err;
  }
  return pool;
}

let adminPool: pg.Pool | undefined;

/**
 * Owner pool for migrations, seed scripts, and test fixtures only. Connects with
 * ADMIN_DATABASE_URL. Migrations need the instance owner login because CREATE EXTENSION
 * (PostGIS) and CREATE ROLE need superuser; runMigrations then runs as food_admin.
 * The running app never imports this helper.
 */
export function getAdminPool(): pg.Pool {
  if (!adminPool) {
    const url = process.env.ADMIN_DATABASE_URL;
    if (!url) throw new Error('ADMIN_DATABASE_URL is not set');
    adminPool = new pg.Pool({ connectionString: url });
  }
  return adminPool;
}

/**
 * Runs `fn` in a transaction as the food_app role (RLS enforced), with
 * app.user_id set for the transaction. A null userId is passed as '' so
 * app_current_user_id() maps it to NULL and policies see no rows.
 */
export async function asRole<T>(
  p: pg.Pool,
  userId: string | null,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE food_app');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId ?? '']);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
