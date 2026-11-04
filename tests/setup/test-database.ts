// Vitest globalSetup / globalTeardown: every run gets its own database.
//
// setup() creates food_os_test_<runid> on the same server as ADMIN_DATABASE_URL, runs the
// migrations into it, and points ADMIN_, APP_, SYNC_ and DATABASE_URL at it. Workers spawn
// after setup() returns, so they inherit the rewritten URLs. teardown() drops that database.
// The shared food_os database is never connected to, migrated, or written by a test run.
//
// Run id: TEST_DB_RUN_ID (set by scripts/tests/run-isolated.sh so the script can clean up
// after a crash), otherwise random. The name is validated before any SQL uses it.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../lib/db/migrate';
import { createDatabase, withDatabase } from './create-database';
import { withClusterLock } from './cluster-lock';

const PREFIX = 'food_os_test_';
const NAME_RE = /^food_os_test_[a-z0-9]{6,40}$/;

function assertTestName(name: string): void {
  if (!NAME_RE.test(name) || name === 'food_os') {
    throw new Error(`refusing to use database name "${name}": not a per-run test database`);
  }
}

async function dropDatabase(adminRaw: string, name: string): Promise<void> {
  assertTestName(name);
  // DROP DATABASE changes the shared pg_database catalog, so it runs under the cluster lock too.
  await withClusterLock(async () => {
    const client = new pg.Client({ connectionString: withDatabase(adminRaw, 'postgres') });
    await client.connect();
    try {
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await client.end();
    }
  }, adminRaw);
}

export async function setup(): Promise<void> {
  const adminRaw = process.env.ADMIN_DATABASE_URL;
  if (!adminRaw) throw new Error('ADMIN_DATABASE_URL is not set');

  const runId = (process.env.TEST_DB_RUN_ID || randomBytes(6).toString('hex')).toLowerCase();
  const name = `${PREFIX}${runId}`;
  assertTestName(name);

  // Serialized with other runs on this server, and retried while template1 is busy (logged).
  await createDatabase(adminRaw, name);

  // Record the name before migrating, so teardown can drop it even if migrations fail.
  process.env.TEST_DB_NAME = name;
  const adminUrl = withDatabase(adminRaw, name);
  try {
    const pool = new pg.Pool({ connectionString: adminUrl, max: 2 });
    try {
      await runMigrations(pool);
    } finally {
      await pool.end();
    }
  } catch (err) {
    await dropDatabase(adminRaw, name);
    throw err;
  }

  process.env.ADMIN_DATABASE_URL = adminUrl;
  for (const key of ['APP_DATABASE_URL', 'SYNC_DATABASE_URL', 'DATABASE_URL'] as const) {
    const raw = process.env[key];
    if (raw) process.env[key] = withDatabase(raw, name);
  }
}

export async function teardown(): Promise<void> {
  const name = process.env.TEST_DB_NAME;
  const adminRaw = process.env.ADMIN_DATABASE_URL;
  if (!name || !adminRaw) return;
  // dropDatabase connects to the maintenance database ('postgres'), so the per-run URL is fine.
  await dropDatabase(adminRaw, name);
  delete process.env.TEST_DB_NAME;
}
