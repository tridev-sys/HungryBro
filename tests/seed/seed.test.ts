import { getAdminPool, runMigrations } from '@/lib/db/client';
import { runSeed, tableSignatures } from '@/lib/seed/run';
import { FIXTURE_RESTAURANTS, FIXTURE_ITEMS, DROP } from '@/lib/seed/fixtures';
import type pg from 'pg';

const pool = getAdminPool();
beforeAll(async () => { await runMigrations(pool); });
afterAll(async () => { await pool.end(); });

async function counts(p: pg.Pool) {
  const { rows } = await p.query(`
    SELECT
      (SELECT count(*)::int FROM restaurant_nodes WHERE slug LIKE 'seed-%') AS restaurants,
      (SELECT count(*)::int FROM menu_items mi JOIN restaurant_nodes r ON r.id = mi.restaurant_id WHERE r.slug LIKE 'seed-%') AS items,
      (SELECT count(*)::int FROM dining_tables dt JOIN restaurant_nodes r ON r.id = dt.restaurant_id WHERE r.slug LIKE 'seed-%') AS tables`);
  return rows[0];
}

test('running the seed twice leaves the same row counts (idempotent)', async () => {
  await runSeed(pool);
  const first = await counts(pool);
  await runSeed(pool);
  const second = await counts(pool);
  expect(second).toEqual(first);
  expect(first.restaurants).toBe(4);
  expect(first.tables).toBe(4 * 4);
});

test('re-running the seed keeps each table QR signature', async () => {
  await runSeed(pool);
  const before = await tableSignatures(pool, FIXTURE_RESTAURANTS[0].id);
  await runSeed(pool);
  const after = await tableSignatures(pool, FIXTURE_RESTAURANTS[0].id);
  expect(after).toEqual(before);
  expect(Object.keys(after).sort()).toEqual(['01', '02', '03', '04']);
});

test('two restaurants per pilot area, all within 1.0 km of their area centre', () => {
  const centre = { Indiranagar: { lat: 12.9716, lng: 77.6412 }, HSR: { lat: 12.9121, lng: 77.6446 } };
  const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const dLat = (a.lat - b.lat) * 111.2;
    const dLng = (a.lng - b.lng) * 111.2 * Math.cos((a.lat * Math.PI) / 180);
    return Math.hypot(dLat, dLng);
  };
  for (const area of ['Indiranagar', 'HSR'] as const) {
    const rs = FIXTURE_RESTAURANTS.filter((r) => r.area === area);
    expect(rs).toHaveLength(2);
    for (const r of rs) expect(km(r, centre[area])).toBeLessThan(1.0);
  }
});

test('every kitchen is within the 6 km transit radius of the E2E drop point', () => {
  const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const dLat = (a.lat - b.lat) * 111.2;
    const dLng = (a.lng - b.lng) * 111.2 * Math.cos((a.lat * Math.PI) / 180);
    return Math.hypot(dLat, dLng);
  };
  for (const r of FIXTURE_RESTAURANTS) expect(km(r, DROP)).toBeLessThan(6);
});

test('every restaurant has the items the E2E specs need, with valid stations and positive prices', () => {
  for (const r of FIXTURE_RESTAURANTS) {
    expect(r.tables.slice(0, 2)).toEqual(['01', '02']);
  }
  for (const item of Object.values(FIXTURE_ITEMS)) {
    expect(item.basePrice).toBeGreaterThan(0);
    expect(['Tandoor', 'Curry', 'Pantry', 'Bar', 'General']).toContain(item.station);
  }
  expect(FIXTURE_ITEMS.paneerTikka.code).toBe('IND1-PNR-TIKKA');
  expect(FIXTURE_ITEMS.freshLimeSoda.code).toBe('IND1-LIME-SODA');
});

test('refuses to seed when NODE_ENV is production', async () => {
  await expect(runSeed(pool, { nodeEnv: 'production' })).rejects.toThrow(/refusing to seed production/);
});

test('allows production seeding only with the explicit override', async () => {
  await expect(runSeed(pool, { nodeEnv: 'production', allowProd: true })).resolves.toMatchObject({ restaurants: 4 });
});
