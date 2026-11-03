import { createMeshBus, publishIntentToBlock } from '@/lib/mesh/bus';
import { encodeGeohash, meshChannel } from '@/lib/mesh/geohash';

const P = { lat: 12.9716, lng: 77.6412 };
const bus = createMeshBus(process.env.REDIS_URL);
afterAll(async () => { await bus.close(); });

const waitFor = <T>(fn: (push: (v: T) => void) => void) => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), 3000);
  fn((v) => { clearTimeout(t); resolve(v); });
});

test('a published message arrives on the subscribed channel as parsed JSON', async () => {
  const ch = meshChannel(encodeGeohash(P));
  const got = waitFor<{ channel: string; message: unknown }>((push) =>
    bus.subscribe([ch], (channel, message) => push({ channel, message })).then(() => bus.publish(ch, { auctionId: 'a1' })));
  expect(await got).toEqual({ channel: ch, message: { auctionId: 'a1' } });
});

test('publishIntentToBlock publishes to nine distinct channels around the point', async () => {
  const channels = await publishIntentToBlock(bus, P, { auctionId: 'a2' });
  expect(channels).toHaveLength(9);
  expect(new Set(channels).size).toBe(9);
  expect(channels).toContain(meshChannel(encodeGeohash(P)));
});

// Bounded failure: a publish against a dead Redis rejects in about a second, not after
// ioredis's default unbounded retries.
test('publish against a closed port rejects within 2 s instead of hanging', async () => {
  const dead = createMeshBus('redis://127.0.0.1:1');
  const started = Date.now();
  try {
    await expect(dead.publish('mesh:test', { ping: true })).rejects.toBeTruthy();
    expect(Date.now() - started).toBeLessThan(2000);
  } finally {
    await dead.close();
  }
}, 10_000);
