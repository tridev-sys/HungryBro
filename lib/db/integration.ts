import type pg from 'pg';

/**
 * Runs `fn` in one transaction as food_app (RLS enforced), with the integration
 * restaurant scope set for the transaction. Mirrors asRole in client.ts.
 */
export async function asIntegration<T>(
  p: pg.Pool,
  restaurantId: string,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE food_app');
    await client.query(`SELECT set_config('app.integration_restaurant_id', $1, true)`, [restaurantId]);
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
