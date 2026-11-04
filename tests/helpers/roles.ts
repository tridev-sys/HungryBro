import type pg from 'pg';
import { withClusterLock } from '../setup/cluster-lock';

// Cluster-wide role DDL for test fixtures. Roles are shared by every run on the server, so each
// statement runs under withClusterLock (see tests/setup/cluster-lock.ts). Test database only.
const SYNC_TEST_PASSWORD = 'test-sync-only';

// Gives food_sync a login (with the test password) or removes it (NOLOGIN, password cleared).
export async function setSyncLogin(admin: pg.Pool, enabled: boolean): Promise<void> {
  const change = enabled ? `LOGIN PASSWORD '${SYNC_TEST_PASSWORD}'` : 'NOLOGIN PASSWORD NULL';
  await withClusterLock(() => admin.query(`ALTER ROLE food_sync ${change}`));
}
