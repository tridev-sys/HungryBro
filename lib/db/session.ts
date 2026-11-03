import type pg from 'pg';

export interface SessionContext {
  userId?: string | null;
  sessionToken?: string | null;
  tableSignature?: string | null;
}

/**
 * Runs `fn` in one transaction as the food_app role (RLS enforced). Sets app.user_id,
 * app.session_token and app.table_signature for the transaction; null becomes ''.
 * Lives outside lib/db/client.ts so the runtime login change does not touch this module.
 */
export async function asSession<T>(
  p: pg.Pool,
  ctx: SessionContext,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE food_app');
    await client.query(
      `SELECT set_config('app.user_id', $1, true),
              set_config('app.session_token', $2, true),
              set_config('app.table_signature', $3, true)`,
      [ctx.userId ?? '', ctx.sessionToken ?? '', ctx.tableSignature ?? ''],
    );
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
