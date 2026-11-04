import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { setSyncLogin } from '../helpers/roles';
import { withFoodSyncLogin } from './cluster-lock';

// Concurrent cluster-wide role DDL. Without the cluster lock, parallel role-level updates to food_sync fail
// with "tuple concurrently updated" (reproduced: 6 of 12 calls failed). Through setSyncLogin, every
// call takes the same lock and all must succeed. The toggles also wait for the food_sync login window,
// so they cannot switch off a login that another run's nightly-sync is still using.
describe('cluster-wide role DDL under the cluster lock', () => {
  it('12 concurrent food_sync login toggles all succeed and leave the role NOLOGIN', async () => {
    const pool = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL, max: 8 });
    try {
      await withFoodSyncLogin(async () => {
        const results = await Promise.allSettled(
          Array.from({ length: 12 }, (_, i) => setSyncLogin(pool, i % 2 === 1)),
        );
        const failures = results
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map((r) => String(r.reason?.message));
        expect(failures).toEqual([]);
        await setSyncLogin(pool, false);
      });
      const { rows } = await pool.query(`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'food_sync'`);
      expect(rows[0].rolcanlogin).toBe(false);
    } finally {
      await pool.end();
    }
  });
});
