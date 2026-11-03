import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { ensureAppLogin } from '../helpers/db';
import { createPostgisKitchenRepository } from '@/lib/auction/kitchen-repository';
import { makeRestaurant, makeMenuItem } from '../helpers/mesh-fixtures';
import { randomUUID } from 'node:crypto';

const admin = getAdminPool();
let repo: ReturnType<typeof createPostgisKitchenRepository>; // runtime pool, set in beforeAll
const Q = { lat: 12.9716, lng: 77.6412 };
// Unique item names per test so cross-test rows never match.
const tag = () => `item${randomUUID().slice(0, 8)}`;
const search = (items: string[], o: Partial<{ point: typeof Q }> = {}) => ({
  point: o.point ?? Q, radiusM: 6000, maxLoad: 0.85,
  items: items.map((q) => ({ query: q, servingTarget: 1 })), dietaryProfiles: [],
});

beforeAll(async () => {
  await runMigrations(admin);
  await ensureAppLogin(admin);
  repo = createPostgisKitchenRepository(await getPool());
});
afterAll(async () => { await (await getPool()).end(); await admin.end(); });

test('includes a kitchen 5.5 km away and excludes one 6.8 km away (6 km radius)', async () => {
  const t = tag();
  const near = await makeRestaurant(admin, { lat: Q.lat + 0.0495, lng: Q.lng });
  const far = await makeRestaurant(admin, { lat: Q.lat + 0.0612, lng: Q.lng });
  for (const r of [near, far]) await makeMenuItem(admin, r, t, 200);
  const ids = (await repo.findCandidates(search([t]))).map((c) => c.restaurantId);
  expect(ids).toContain(near);
  expect(ids).not.toContain(far);
});

test('load 0.85 is excluded and 0.84 is included (Review Focus 2)', async () => {
  const t = tag();
  const at85 = await makeRestaurant(admin, { lat: Q.lat + 0.001, lng: Q.lng, load: 0.85 });
  const at84 = await makeRestaurant(admin, { lat: Q.lat + 0.001, lng: Q.lng, load: 0.84 });
  for (const r of [at85, at84]) await makeMenuItem(admin, r, t, 200);
  const ids = (await repo.findCandidates(search([t]))).map((c) => c.restaurantId);
  expect(ids).toContain(at84);
  expect(ids).not.toContain(at85);
});

test('distance reflects ST_MakePoint(lng, lat) order (Review Focus 3)', async () => {
  const t = tag();
  const r = await makeRestaurant(admin, { lat: Q.lat + 0.01, lng: Q.lng }); // about 1.11 km north
  await makeMenuItem(admin, r, t, 200);
  const [c] = await repo.findCandidates(search([t]));
  expect(Math.abs(c.distanceM - 1112)).toBeLessThan(30);
});

test('a kitchen missing any requested item is dropped', async () => {
  const have = tag(); const need = tag();
  const r = await makeRestaurant(admin, { lat: Q.lat, lng: Q.lng });
  await makeMenuItem(admin, r, have, 200);
  expect(await repo.findCandidates(search([have, need]))).toEqual([]);
});

test('the cheapest matching item is chosen for each query', async () => {
  const t = tag();
  const r = await makeRestaurant(admin, { lat: Q.lat, lng: Q.lng });
  await makeMenuItem(admin, r, t, 350);
  await makeMenuItem(admin, r, `${t}-half`, 300);
  const [c] = await repo.findCandidates(search([t]));
  expect(c.lines[0].basePrice).toBe(300);
});
