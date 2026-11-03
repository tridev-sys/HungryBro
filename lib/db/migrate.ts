import fs from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

const LOCK_KEY = 'food_os_migrations';

// Runs as the connecting (superuser) role before any migration: creates the
// roles, the extensions (PostGIS needs superuser), and the schema grants that
// food_admin cannot issue for itself. Idempotent.
const BOOTSTRAP_SQL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_app') THEN CREATE ROLE food_app NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_sync') THEN CREATE ROLE food_sync NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_admin') THEN CREATE ROLE food_admin NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
GRANT USAGE ON SCHEMA public TO food_app, food_sync, food_admin;
GRANT CREATE ON SCHEMA public TO food_admin;
`;

/**
 * Applies every *.sql file in `dir` (lexical order) that is not yet recorded in
 * schema_migrations. Each migration runs in its own transaction, as food_admin,
 * under a transaction-scoped advisory lock. Returns the names applied this run.
 */
export async function runMigrations(
  pool: pg.Pool,
  dir: string = path.join(process.cwd(), 'db', 'migrations'),
): Promise<string[]> {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [LOCK_KEY]);
    await client.query(BOOTSTRAP_SQL);
    await client.query('COMMIT');

    for (const file of files) {
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [LOCK_KEY]);
        await client.query('SET LOCAL ROLE food_admin');
        await client.query(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            name text PRIMARY KEY,
            applied_at timestamptz DEFAULT now()
          )`);
        const { rows } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
        if (rows.length === 0) {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
          applied.push(file);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }
  return applied;
}
