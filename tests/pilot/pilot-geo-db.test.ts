import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { ensureAppLogin } from '../helpers/db';
import { createPostgisKitchenRepository } from '@/lib/auction/kitchen-repository';
import { generatePilotNodes, runPilotSeed } from '@/lib/seed/pilot-geo';
import { haversineKm } from '@/lib/geo/distance';

const admin = getAdminPool();
let repo: ReturnType<typeof createPostgisKitchenRepository>;
const CENTRE = { lat: 12.9352, lng: 77.6245 };
const OPEN_ENV = { PILOT_SEED_ENABLED: '1', NODE_ENV: 'test' };

beforeAll(async () => {
  await runMigrations(admin);
  await ensureAppLogin(admin);
  repo = createPostgisKitchenRepository(await getPool());
});
afterAll(async () => {
  await (await getPool()).end();
  await admin.end();
});

describe('runPilotSeed against the per-run test database', () => {
  it('refuses to write without PILOT_SEED_ENABLED=1 and inserts nothing', async () => {
    await expect(runPilotSeed(admin, CENTRE, { NODE_ENV: 'test' })).rejects.toThrow(/PILOT_SEED_ENABLED=1/);
    const { rows } = await admin.query("SELECT count(*)::int AS n FROM restaurant_nodes WHERE slug LIKE 'pilot-geo-%' AND location = ST_SetSRID(ST_MakePoint($1,$2),4326)::geography", [CENTRE.lng, CENTRE.lat]);
    expect(rows[0].n).toBe(0);
  });

  it('seeds the generated nodes; the stored locations match the generator and the centre band', async () => {
    const expected = generatePilotNodes(CENTRE);
    const result = await runPilotSeed(admin, CENTRE, OPEN_ENV);
    expect(result.restaurants).toBe(expected.length);
    const { rows } = await admin.query<{ id: string; lat: number; lng: number; name: string }>(
      `SELECT id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, name
         FROM restaurant_nodes WHERE id = ANY($1::uuid[])`,
      [expected.map((n) => n.id)],
    );
    expect(rows).toHaveLength(expected.length);
    for (const row of rows) {
      const d = haversineKm(CENTRE, { lat: row.lat, lng: row.lng });
      expect(d).toBeGreaterThanOrEqual(1.5);
      expect(d).toBeLessThanOrEqual(3.5);
      expect(row.name).toContain('(Pilot Data)');
    }
  });

  it('is idempotent for the same centre', async () => {
    await runPilotSeed(admin, CENTRE, OPEN_ENV);
    const ids = generatePilotNodes(CENTRE).map((n) => n.id);
    const { rows } = await admin.query('SELECT count(*)::int AS n FROM restaurant_nodes WHERE id = ANY($1::uuid[])', [ids]);
    expect(rows[0].n).toBe(ids.length);
  });

  it('the existing 6 km nearby query returns the seeded pilot nodes for the centre', async () => {
    await runPilotSeed(admin, CENTRE, OPEN_ENV);
    const expectedIds = generatePilotNodes(CENTRE).map((n) => n.id);
    const found = await repo.findCandidates({
      point: CENTRE,
      radiusM: 6000,
      maxLoad: 0.85,
      maxPrepMinutes: 15,
      items: [{ query: 'Dal Tadka', servingTarget: 1 }],
      dietaryProfiles: [],
    });
    const foundIds = found.map((c) => c.restaurantId);
    for (const id of expectedIds) expect(foundIds).toContain(id);
    for (const c of found.filter((x) => expectedIds.includes(x.restaurantId))) {
      expect(c.distanceM).toBeGreaterThanOrEqual(1500);
      expect(c.distanceM).toBeLessThanOrEqual(3500);
    }
  });
});
