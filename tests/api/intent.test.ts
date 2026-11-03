import { getPool, runMigrations } from '@/lib/db/client';
import { seedMeshDev } from '@/lib/dev/seed-mesh';
import { POST } from '@/app/api/delivery/intent/route';

const pool = getPool();
const body = (over: object = {}) => ({
  transcript: 'Dinner for 3: Biryani & Kebab strictly under ₹800, delivered in 30 mins to Indiranagar',
  intent: {
    modality: 'DELIVERY', budget_ceiling_inr: 800, sla_max_minutes: 30, headcount: 3,
    target_dietary_profiles: [], items_requested: [{ query: 'biryani', serving_target: 2 }, { query: 'kebab', serving_target: 1 }],
    client_coordinates: { lat: 12.9719, lng: 77.6408 }, ...over,
  },
});
const req = (b: unknown) => new Request('http://localhost:3000/api/delivery/intent', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
});

beforeAll(async () => {
  process.env.ALLOW_DEV_DINER = '1';
  process.env.SANDBOX_BID_DELAY_MS = '0';
  await runMigrations(pool);
  await seedMeshDev(pool);
});
afterAll(async () => { await pool.end(); });

test('rejects out-of-range coordinates with 400 before any query (Review Focus 1, Plan 01)', async () => {
  const res = await POST(req(body({ client_coordinates: { lat: 250, lng: 77.6 } })));
  expect(res.status).toBe(400);
});

test('a seeded search returns ranked bundles, cheapest first, excluding the busy kitchen', async () => {
  const res = await POST(req(body()));
  expect(res.status).toBe(201);
  const json = await res.json();
  expect(new Date(json.windowClosesAt).getTime() - Date.now()).toBeGreaterThan(15_000);
  const names: string[] = json.bundles.map((b: { name: string }) => b.name);
  expect(names).toEqual(expect.arrayContaining(['Meghna Foods', 'Empire Restaurant']));
  expect(names).not.toContain('HSR Busy Kitchen');
  const prices: number[] = json.bundles.map((b: { offeredPriceInr: number }) => b.offeredPriceInr);
  expect(prices).toEqual([...prices].sort((a, b) => a - b));
  expect(prices.every((p) => p <= 800)).toBe(true);
});
