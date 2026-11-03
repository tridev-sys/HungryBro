// Shared helpers for the perf suite. Runs inside node:22-alpine on perf-net (see env.sh).
// Plain Node 22 fetch is the load driver; no paid APIs are called.
import pg from 'pg';
import { issueSession, SESSION_COOKIE } from '@/lib/auth/session';

export const BASE = process.env.PERF_BASE ?? 'http://perf-app:3000';
export const DINER_PHONE = '+919000000001';
export const STAFF_PHONE_MEGHNA = '+919000000011';

export function adminPool(): pg.Pool {
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) throw new Error('ADMIN_DATABASE_URL is not set (source tests/perf/env.sh)');
  return new pg.Pool({ connectionString: url, max: 4 });
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function summarize(latencies: number[]) {
  const s = [...latencies].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: Math.round(percentile(s, 50)),
    p95: Math.round(percentile(s, 95)),
    max: Math.round(s[s.length - 1] ?? NaN),
  };
}

export async function userIdByPhone(admin: pg.Pool, phone: string): Promise<string> {
  const { rows } = await admin.query('SELECT id, role, restaurant_id FROM users WHERE phone_number = $1', [phone]);
  if (rows.length !== 1) throw new Error(`seed user ${phone} not found; run scripts/seed-mesh-dev.ts`);
  return rows[0].id as string;
}

/** A cookie header for a signed session, produced by the app's own issueSession. */
export async function sessionCookie(userId: string, role: 'diner' | 'restaurant_staff'): Promise<string> {
  const { token } = await issueSession({ id: userId, role });
  return `${SESSION_COOKIE}=${token}`;
}

/** Counts connections to food_os by login role (pg_stat_activity). */
export async function connCount(admin: pg.Pool, usename: string): Promise<number> {
  const { rows } = await admin.query(
    `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = 'food_os' AND usename = $1`,
    [usename],
  );
  return rows[0].n as number;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function report(label: string, data: unknown): void {
  console.log(`RESULT ${label} ${JSON.stringify(data)}`);
}
