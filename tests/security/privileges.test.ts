// Check 2: food_app_login is not a superuser, cannot bypass RLS, cannot create roles, and cannot
// read the POS credential table. Statements run as the login role itself, without SET ROLE.
import { getPool } from '@/lib/db/client';
import { prepareDatabase, closeAll, asApp, attempt, denied } from './helpers';

beforeAll(prepareDatabase);
afterAll(closeAll);

async function loginConn<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const pool = await getPool();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}

test('runtime login is food_app_login, not superuser, no BYPASSRLS, no CREATEROLE, no CREATEDB', async () => {
  const { rows } = await loginConn((c) => c.query(
    `SELECT current_user AS u, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb
       FROM pg_roles r WHERE r.rolname = current_user`));
  expect(rows[0]).toEqual({ u: 'food_app_login', rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
});

test('is_superuser is off for the session', async () => {
  const { rows } = await loginConn((c) => c.query(`SELECT current_setting('is_superuser') AS s`));
  expect(rows[0].s).toBe('off');
});

test('cannot create a role', async () => {
  await loginConn(async (c) => {
    const r = await attempt(c, 'CREATE ROLE sec_probe_role LOGIN');
    expect(r.error).toMatch(/permission denied/);
  });
  const { rows } = await (await getPool()).query(`SELECT 1 FROM pg_roles WHERE rolname = 'sec_probe_role'`);
  expect(rows).toHaveLength(0);
});

test('cannot grant itself food_admin or switch to it', async () => {
  await loginConn(async (c) => {
    const r = await attempt(c, 'SET ROLE food_admin');
    expect(r.error).toMatch(/permission denied/);
  });
});

test('cannot read restaurant_pos_credentials directly, by column or by count', async () => {
  await loginConn(async (c) => {
    expect((await attempt(c, 'SELECT count(*) FROM restaurant_pos_credentials')).error).toMatch(/permission denied/);
    expect((await attempt(c, 'SELECT ciphertext FROM restaurant_pos_credentials')).error).toMatch(/permission denied/);
  });
});

test('cannot write restaurant_pos_credentials', async () => {
  await loginConn(async (c) => {
    expect(denied(await attempt(c, `UPDATE restaurant_pos_credentials SET ciphertext = '{}'`))).toBe(true);
    expect(denied(await attempt(c, `DELETE FROM restaurant_pos_credentials`))).toBe(true);
  });
});

test('cannot disable row-level security or alter table ownership', async () => {
  await loginConn(async (c) => {
    expect((await attempt(c, 'ALTER TABLE mesh_food_auctions DISABLE ROW LEVEL SECURITY')).error).toMatch(/must be owner/);
    expect((await attempt(c, 'ALTER TABLE users NO FORCE ROW LEVEL SECURITY')).error).toMatch(/must be owner/);
  });
});

test('cannot turn row_security off (non-superuser without BYPASSRLS)', async () => {
  await loginConn(async (c) => {
    await c.query('SAVEPOINT rs');
    let err: string | null = null;
    try {
      await c.query('SET row_security = off');
      await c.query('SELECT count(*) FROM mesh_food_auctions');
    } catch (e) {
      err = (e as Error).message;
    }
    expect(err).toMatch(/row-level security/);
  });
});

test('cannot truncate or drop core tables', async () => {
  await loginConn(async (c) => {
    expect((await attempt(c, 'TRUNCATE users')).error).toMatch(/permission denied/);
    expect((await attempt(c, 'DROP TABLE restaurant_pos_credentials')).error).toMatch(/must be owner/);
  });
});

test('cannot delete restaurants (no policy allows it, RLS hides every row)', async () => {
  await loginConn(async (c) => {
    const r = await attempt(c, 'DELETE FROM restaurant_nodes');
    expect(denied(r)).toBe(true);
  });
});

test('control: the POS lookup function is callable by food_app and returns nothing for an unknown restaurant', async () => {
  // Proves the earlier denials are about table privileges, not a missing grant.
  await asApp({}, async (c) => {
    const { rows } = await c.query('SELECT app_pos_credentials_for_restaurant($1) AS ct',
      ['00000000-0000-0000-0000-000000000000']);
    expect(rows[0].ct).toBeNull();
  });
});
