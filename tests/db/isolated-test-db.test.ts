import { describe, expect, it } from 'vitest';
import pg from 'pg';

// The suite must never write into the shared food_os database. tests/setup/test-database.ts
// (vitest globalSetup) creates a per-run database, points every DB URL at it, and drops it at
// the end of the run. These checks prove the URLs the tests use point at that database.

const dbName = (url: string | undefined) => (url ? new URL(url).pathname.replace(/^\//, '') : '');

describe('per-run test database', () => {
  it('points every database URL at the same database, not food_os', () => {
    const admin = dbName(process.env.ADMIN_DATABASE_URL);
    expect(admin).toMatch(/^food_os_test_[a-z0-9]{6,40}$/);
    expect(dbName(process.env.APP_DATABASE_URL)).toBe(admin);
    expect(dbName(process.env.SYNC_DATABASE_URL)).toBe(admin);
    expect(dbName(process.env.DATABASE_URL)).toBe(admin);
    expect(admin).not.toBe('food_os');
  });

  it('the connected database is the per-run database', async () => {
    const pool = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL, max: 1 });
    try {
      const { rows } = await pool.query('SELECT current_database() AS db');
      expect(rows[0].db).toBe(dbName(process.env.ADMIN_DATABASE_URL));
      expect(rows[0].db).not.toBe('food_os');
    } finally {
      await pool.end();
    }
  });
});
