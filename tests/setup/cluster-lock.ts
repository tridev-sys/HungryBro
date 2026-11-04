import pg from 'pg';

const CLUSTER_LOCK_KEY = 'food_os_test_cluster_ddl';

// Runs fn while holding a lock shared by every test run on this server. Roles and role memberships
// are cluster-wide catalogs, so two runs writing them at once fail with "tuple concurrently updated".
// pg_advisory_lock is scoped to the database it is taken in, and each run has its own database, so
// the lock is taken in the maintenance database 'postgres', which all runs share.
// adminRaw defaults to ADMIN_DATABASE_URL; only the database name in it is replaced.
export async function withClusterLock<T>(fn: () => Promise<T>, adminRaw = process.env.ADMIN_DATABASE_URL): Promise<T> {
  if (!adminRaw) throw new Error('ADMIN_DATABASE_URL is not set');
  const url = new URL(adminRaw);
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
