// CREATE DATABASE for the per-run test database (used by tests/setup/test-database.ts).
//
// Two runs on the same server can collide while CREATE DATABASE copies template1:
//   55006 "source database template1 is being accessed by other users"
// Creation is serialized with the cluster lock shared with tests/helpers/db.ts, and a busy
// template is retried with a short bounded backoff. Every retry is logged.
import pg from 'pg';
import { withClusterLock } from './cluster-lock';

export const TEMPLATE_BUSY_CODE = '55006';
const TEMPLATE_BUSY_MESSAGE = /is being accessed by other users/;

export function withDatabase(raw: string, dbName: string): string {
  const url = new URL(raw);
  url.pathname = `/${dbName}`;
  return url.toString();
}

export function isTemplateBusy(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (!e) return false;
  if (e.code === TEMPLATE_BUSY_CODE) return true;
  return typeof e.message === 'string' && TEMPLATE_BUSY_MESSAGE.test(e.message);
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

// Runs op, retrying only while the template database is busy. Other errors are rethrown at once.
export async function withBusyRetry<T>(op: () => Promise<T>, label: string, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 8;
  const baseDelayMs = opts.baseDelayMs ?? 250;
  const maxDelayMs = opts.maxDelayMs ?? 2000;
  const log = opts.log ?? ((message: string) => console.log(message));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      if (!isTemplateBusy(err) || attempt >= attempts) throw err;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      log(`[test-database] ${label}: template1 is busy (attempt ${attempt} of ${attempts}), retrying in ${delay} ms`);
      await sleep(delay);
    }
  }
}

// Creates dbName on the server of adminRaw, serialized with every other test run, retrying busy.
export async function createDatabase(adminRaw: string, dbName: string, opts: RetryOptions = {}): Promise<void> {
  await withClusterLock(
    () =>
      withBusyRetry(
        async () => {
          const client = new pg.Client({ connectionString: withDatabase(adminRaw, 'postgres') });
          await client.connect();
          try {
            await client.query(`CREATE DATABASE "${dbName}"`);
          } finally {
            await client.end();
          }
        },
        `CREATE DATABASE ${dbName}`,
        opts,
      ),
    adminRaw,
  );
}
