import pg from 'pg';

// Server-only. The nightly menu sync is the only code that uses this pool.
let pool: pg.Pool | undefined;

export function getSyncPool(): pg.Pool {
  if (!pool) {
    const url = process.env.SYNC_DATABASE_URL;
    if (!url) throw new Error('SYNC_DATABASE_URL is not set');
    pool = new pg.Pool({ connectionString: url });
  }
  return pool;
}

/**
 * One transaction for a single restaurant's sync. Refuses any role other than food_sync,
 * which bypasses RLS by role attribute, so no role switch is needed. Each write still
 * filters on restaurant_id.
 */
export async function withSyncTx<T>(
  p: pg.Pool,
  restaurantId: string,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT current_user = $1 AS ok', ['food_sync']);
    if (!rows[0].ok) throw new Error('sync writes require the food_sync role');
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
