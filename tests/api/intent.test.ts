import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { ensureAppLogin, makeUser } from '../helpers/db';
import { issueSession, SESSION_COOKIE } from '@/lib/auth/session';
import { seedMeshDev } from '@/lib/dev/seed-mesh';
import { POST } from '@/app/api/delivery/intent/route';

const admin = getAdminPool();
const body = (over: object = {}) => ({
  transcript: 'Dinner for 3: Biryani & Kebab strictly under ₹800, delivered in 30 mins to Indiranagar',
  intent: {
    modality: 'DELIVERY', budget_ceiling_inr: 800, sla_max_minutes: 30, headcount: 3,
    target_dietary_profiles: [], items_requested: [{ query: 'biryani', serving_target: 2 }, { query: 'kebab', serving_target: 1 }],
    client_coordinates: { lat: 12.9719, lng: 77.6408 }, ...over,
  },
});
let dinerCookie = '';
const req = (b: unknown) => new Request('http://localhost:3000/api/delivery/intent', {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: dinerCookie }, body: JSON.stringify(b),
});

beforeAll(async () => {
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  const dinerId = await makeUser(admin, 'diner');
  const { token } = await issueSession({ id: dinerId, role: 'diner' });
  dinerCookie = `${SESSION_COOKIE}=${token}`;
  process.env.SANDBOX_BID_DELAY_MS = '0';
  await runMigrations(admin);
  await ensureAppLogin(admin);
  await seedMeshDev(admin);
});
afterAll(async () => { await (await getPool()).end(); await admin.end(); });

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

// Redis is unreachable: point the bus at a closed loopback port. The intent must answer with a
// stable 503 quickly instead of hanging until the client gives up.
test('with the mesh bus unavailable, the intent returns 503 MESH_BUS_UNAVAILABLE within 2 s', async () => {
  const saved = process.env.REDIS_URL;
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  try {
    const started = Date.now();
    const res = await POST(req(body()));
    const elapsed = Date.now() - started;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'mesh bus unavailable', code: 'MESH_BUS_UNAVAILABLE' });
    expect(elapsed).toBeLessThan(2500);
  } finally {
    process.env.REDIS_URL = saved;
  }
}, 10_000);
