import pg from 'pg';

const CLUSTER_LOCK_KEY = 'food_os_test_cluster_ddl';

// Runs fn while holding a lock shared by every test run on this server. Roles and role memberships
// are cluster-wide catalogs, so two runs writing them at once fail with "tuple concurrently updated".
// pg_advisory_lock is scoped to the database it is taken in, and each run has its own database, so
// the lock is taken in the maintenance database 'postgres', which all runs share.
export async function withClusterLock<T>(fn: () => Promise<T>, adminRaw = process.env.ADMIN_DATABASE_URL): Promise<T> {
  const lock = await connectMaintenanceLock(adminRaw);
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

// Holds the food_sync login window across runs. nightly-sync needs food_sync to stay LOGIN from its
// beforeAll to its afterAll, but a session-level lock is held by one connection, so the window is a
// separate key held on a connection kept open until release(). Any test that turns food_sync LOGIN on
// or off must hold this window (withFoodSyncLogin), or it can drop the login under another run.
// If the process dies, Postgres releases the session lock when the connection closes.
const FOOD_SYNC_LOGIN_KEY = 'food_os_test_food_sync_login';

export async function acquireFoodSyncLogin(adminRaw = process.env.ADMIN_DATABASE_URL): Promise<() => Promise<void>> {
  const lock = await connectMaintenanceLock(adminRaw);
  try {
    await lock.query('SELECT pg_advisory_lock(hashtext($1))', [FOOD_SYNC_LOGIN_KEY]);
  } catch (err) {
    await lock.end();
    throw err;
  }
  return async () => {
    try {
      await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [FOOD_SYNC_LOGIN_KEY]);
    } finally {
      await lock.end();
    }
  };
}

export async function withFoodSyncLogin<T>(fn: () => Promise<T>, adminRaw = process.env.ADMIN_DATABASE_URL): Promise<T> {
  const release = await acquireFoodSyncLogin(adminRaw);
  try {
    return await fn();
  } finally {
    await release();
  }
}

// Both locks live in the maintenance database 'postgres', which all runs share.
// adminRaw defaults to ADMIN_DATABASE_URL; only the database name in it is replaced.
async function connectMaintenanceLock(adminRaw: string | undefined): Promise<pg.Client> {
  if (!adminRaw) throw new Error('ADMIN_DATABASE_URL is not set');
  const url = new URL(adminRaw);
  url.pathname = '/postgres';
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}
