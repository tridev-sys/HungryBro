import Redis from 'ioredis';
import { consumeToken, type BucketConfig, type BucketState } from '@/lib/ratelimit/bucket';
import { RedisRateLimitStore } from '@/lib/ratelimit/redis-store';
import { randomUUID } from 'node:crypto';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const store = new RedisRateLimitStore(redis);
const cfg: BucketConfig = { capacity: 3, refillPerSecond: 1 };
afterAll(async () => { await redis.quit(); });

test('Redis store matches the pure function over the same clock sequence', async () => {
  const key = `rl:test:${randomUUID()}`;
  const times = [0, 0, 0, 0, 999, 1000, 1000, 5000];
  let s: BucketState | null = null;
  const expected: boolean[] = [];
  for (const t of times) {
    const d = consumeToken(s, cfg, t);
    expected.push(d.allowed);
    s = d.state;
  }
  const actual: boolean[] = [];
  for (const t of times) actual.push((await store.consume(key, cfg, t)).allowed);
  expect(actual).toEqual(expected);
});

test('denied Redis response carries retryAfterSeconds', async () => {
  const key = `rl:test:${randomUUID()}`;
  for (let i = 0; i < 3; i++) await store.consume(key, cfg, 0);
  const d = await store.consume(key, cfg, 0);
  expect(d.allowed).toBe(false);
  expect(d.retryAfterSeconds).toBe(1);
});

test('keys expire so idle buckets do not accumulate in Redis', async () => {
  const key = `rl:test:${randomUUID()}`;
  await store.consume(key, cfg, 0);
  const ttl = await redis.pttl(key);
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(6000); // capacity / refill * 2 seconds
});
