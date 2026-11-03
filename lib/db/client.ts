import pg from 'pg';

export { runMigrations } from './migrate';

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({ connectionString: url });
  }
  return pool;
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
