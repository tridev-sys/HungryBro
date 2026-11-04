import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getAdminPool, runMigrations } from '@/lib/db/client';
import { runNightlyMenuSync, httpMenuFetcher } from '@/lib/pos/nightly-sync';
import { getSyncPool, withSyncTx } from '@/lib/db/sync';
import { createRestaurant } from '../helpers/db';
import { setSyncLogin } from '../helpers/roles';

const owner = getAdminPool();    // owner role for migrations, seed rows, and fixtures only
const pool = getSyncPool(); // food_sync: the only pool the nightly sync uses
beforeAll(async () => {
  await runMigrations(owner);
  await setSyncLogin(owner, true); // test database only; cluster-wide DDL under the cluster lock
});
afterAll(async () => {
  await pool.end();
  await setSyncLogin(owner, false); // leave the shared test database as found
  await owner.end();
});

const menu = readFileSync(path.join(__dirname, '../fixtures/pos/petpooja-menu.json'), 'utf8');

test('syncs every pos-connected restaurant and skips direct ones', async () => {
  const a = await createRestaurant(owner, { provider: 'petpooja', credentials: { api_base_url: 'https://pp.test', api_key: 'k' } });
  const direct = await createRestaurant(owner, { provider: 'direct', credentials: {} });
  const fetched: string[] = [];
  const fetcher = httpMenuFetcher({ fetchImpl: (async (url: string) => { fetched.push(String(url)); return new Response(menu); }) as unknown as typeof fetch });
  const summary = await runNightlyMenuSync(pool, fetcher);
  expect(summary.failed.filter((f) => f.restaurantId === direct)).toEqual([]);
  expect(fetched.some((u) => u.startsWith('https://pp.test/menu'))).toBe(true);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1', [a]);
  expect(rows[0].n).toBe(4);
  const direct_rows = await pool.query('SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1', [direct]);
  expect(direct_rows.rows[0].n).toBe(0);
});

test('one failing restaurant is reported and does not stop the others', async () => {
  const bad = await createRestaurant(owner, { provider: 'petpooja', credentials: { api_base_url: 'https://bad.test', api_key: 'k' } });
  const good = await createRestaurant(owner, { provider: 'petpooja', credentials: { api_base_url: 'https://good.test', api_key: 'k' } });
  const fetcher = httpMenuFetcher({ fetchImpl: (async (url: string) => {
    if (String(url).includes('bad.test')) return new Response('boom', { status: 500 });
    return new Response(menu);
  }) as unknown as typeof fetch });
  const summary = await runNightlyMenuSync(pool, fetcher);
  expect(summary.failed.map((f) => f.restaurantId)).toContain(bad);
  expect(summary.failed.map((f) => f.restaurantId)).not.toContain(good);
});

test('an empty provider menu fails that restaurant and writes nothing (Review Focus 4)', async () => {
  const empty = await createRestaurant(owner, { provider: 'petpooja', credentials: { api_base_url: 'https://empty.test', api_key: 'k' } });
  await runNightlyMenuSync(pool, httpMenuFetcher({ fetchImpl: (async () => new Response(menu)) as unknown as typeof fetch }));
  const before = await pool.query('SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1', [empty]);
  const summary = await runNightlyMenuSync(pool, httpMenuFetcher({ fetchImpl: (async () => new Response(JSON.stringify({ restID: 'x', categories: [] }))) as unknown as typeof fetch }));
  expect(summary.failed.map((f) => f.restaurantId)).toContain(empty);
  const after = await pool.query('SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1', [empty]);
  expect(after.rows[0].n).toBe(before.rows[0].n);
});

test('providers not in the allow-list are skipped with a reason and never fetched or written', async () => {
  const allowed = await createRestaurant(owner, { provider: 'petpooja', credentials: { api_base_url: 'https://al-allowed.test', api_key: 'k' } });
  const blocked = await createRestaurant(owner, { provider: 'urbanpiper', credentials: { api_base_url: 'https://al-blocked.test', api_key: 'k' } });
  const fetched: string[] = [];
  const fetcher = httpMenuFetcher({ fetchImpl: (async (url: string) => { fetched.push(String(url)); return new Response(menu); }) as unknown as typeof fetch });
  const summary = await runNightlyMenuSync(pool, fetcher, new Set(['petpooja']));
  expect(fetched.some((u) => u.includes('al-blocked.test'))).toBe(false);
  expect(fetched.some((u) => u.startsWith('https://al-allowed.test/menu'))).toBe(true);
  expect(summary.skipped).toContainEqual({ restaurantId: blocked, provider: 'urbanpiper', reason: 'provider_not_enabled' });
  expect(summary.skipped.map((s) => s.restaurantId)).not.toContain(allowed);
  expect(summary.failed.map((f) => f.restaurantId)).not.toContain(blocked);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1', [blocked]);
  expect(rows[0].n).toBe(0);
});

test('with POS_PROVIDERS_ENABLED unset, the default sync skips every POS provider', async () => {
  const saved = process.env.POS_PROVIDERS_ENABLED;
  delete process.env.POS_PROVIDERS_ENABLED;
  try {
    const r = await createRestaurant(owner, { provider: 'petpooja', credentials: { api_base_url: 'https://al-default.test', api_key: 'k' } });
    const fetched: string[] = [];
    const summary = await runNightlyMenuSync(pool, httpMenuFetcher({ fetchImpl: (async (url: string) => { fetched.push(String(url)); return new Response(menu); }) as unknown as typeof fetch }));
    expect(fetched.some((u) => u.includes('al-default.test'))).toBe(false);
    expect(summary.skipped.map((s) => s.restaurantId)).toContain(r);
  } finally {
    if (saved !== undefined) process.env.POS_PROVIDERS_ENABLED = saved;
  }
});

test('the sync runs as food_sync (BYPASSRLS) and refuses any other role (Decision 2)', async () => {
  const { rows } = await pool.query(
    `SELECT current_user AS u, (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'food_sync') AS bypass`);
  expect(rows[0]).toEqual({ u: 'food_sync', bypass: true });
  await expect(withSyncTx(owner, '00000000-0000-0000-0000-000000000000', async () => 1))
    .rejects.toThrow(/food_sync/);
});
