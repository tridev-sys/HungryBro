import { getAdminPool, getPool, runMigrations } from '@/lib/db/client';
import { ensureAppLogin } from '../helpers/db';
import { createMeshBus, type MeshBus } from '@/lib/mesh/bus';
import { auctionEventsChannel } from '@/lib/mesh/geohash';
import { GET } from '@/app/api/delivery/auctions/[id]/events/route';
import { makeUser, makeAuction } from '../helpers/mesh-fixtures';

const admin = getAdminPool();
let bus: MeshBus;
beforeAll(async () => {
  process.env.ALLOW_DEV_DINER = '1';
  await runMigrations(admin);
  await ensureAppLogin(admin);
  bus = createMeshBus(process.env.REDIS_URL);
});
afterAll(async () => { await bus.close(); await (await getPool()).end(); await admin.end(); });

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> {
  const dec = new TextDecoder(); let buf = '';
  const deadline = Date.now() + 5000;
  while (!buf.includes(needle)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${needle}`);
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
  }
  return buf;
}

test('stream opens with a snapshot and then forwards a bid published on the auction channel', async () => {
  const diner = await makeUser(admin, 'diner');
  const auction = await makeAuction(admin, diner, { createdAgoSeconds: 1 });
  const ac = new AbortController();
  const res = await GET(new Request('http://localhost/x', { signal: ac.signal, headers: { 'x-dev-diner': diner } }),
    { params: Promise.resolve({ id: auction }) });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const first = await readUntil(reader, 'event: snapshot');
  expect(first).toContain('"status":"open"');
  await bus.publish(auctionEventsChannel(auction), { type: 'bid', restaurantId: 'r1', offeredPriceInr: 710 });
  const next = await readUntil(reader, 'event: bid');
  expect(next).toContain('"offeredPriceInr":710');
  ac.abort();
});

// Redis is unreachable: the events route must answer with the stable 503 quickly rather than
// opening a stream that never delivers. Same bound as the intent route.
test('with the mesh bus unavailable, the events route returns 503 MESH_BUS_UNAVAILABLE within 2 s', async () => {
  const saved = process.env.REDIS_URL;
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  try {
    const diner = await makeUser(admin, 'diner');
    const auction = await makeAuction(admin, diner, { createdAgoSeconds: 1 });
    const started = Date.now();
    const res = await GET(new Request('http://localhost/x', { headers: { 'x-dev-diner': diner } }),
      { params: Promise.resolve({ id: auction }) });
    const elapsed = Date.now() - started;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'mesh bus unavailable', code: 'MESH_BUS_UNAVAILABLE' });
    expect(elapsed).toBeLessThan(2500);
  } finally {
    process.env.REDIS_URL = saved;
  }
}, 10_000);
