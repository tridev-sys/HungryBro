import Redis from 'ioredis';
import { RedisRateLimitStore } from '@/lib/ratelimit/redis-store';
import { guardRateLimit } from '@/lib/http/guard';
import { randomUUID } from 'node:crypto';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const store = new RedisRateLimitStore(redis);
afterAll(async () => { await redis.quit(); });

function req(ip: string): Request {
  return new Request('http://localhost/api/x', { headers: { 'x-real-ip': ip } });
}

test('session bucket (60) denies the 61st request from one session with Retry-After', async () => {
  const ip = `198.51.100.${randomUUID()}`;
  const session = `sess-${randomUUID()}`;
  for (let i = 0; i < 60; i++) expect(await guardRateLimit(req(ip), store, session, 0)).toBeNull();
  const denied = await guardRateLimit(req(ip), store, session, 0);
  expect(denied?.status).toBe(429);
  expect(Number(denied?.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
});

test('same IP with a different session passes until the IP bucket (120) is empty', async () => {
  const ip = `198.51.100.${randomUUID()}`;
  const [a, b, c] = [`sess-${randomUUID()}`, `sess-${randomUUID()}`, `sess-${randomUUID()}`];
  for (let i = 0; i < 60; i++) expect(await guardRateLimit(req(ip), store, a, 0)).toBeNull();
  expect(await guardRateLimit(req(ip), store, a, 0)).not.toBeNull(); // session A exhausted
  // 61 attempts so far consumed 61 IP tokens (the denied one included); 59 remain.
  for (let i = 0; i < 59; i++) expect(await guardRateLimit(req(ip), store, b, 0)).toBeNull();
  // IP bucket now has 0 tokens: every session is denied.
  expect((await guardRateLimit(req(ip), store, c, 0))?.status).toBe(429);
});

test('a client-sent X-Forwarded-For cannot reset its own bucket (Review Focus 2)', async () => {
  const ip = `203.0.113.${randomUUID()}`;
  const session = `sess-${randomUUID()}`;
  for (let i = 0; i < 60; i++) {
    const r = new Request('http://localhost/api/x', {
      headers: { 'x-real-ip': ip, 'x-forwarded-for': `10.0.0.${i}` },
    });
    expect(await guardRateLimit(r, store, session, 0)).toBeNull();
  }
  const r = new Request('http://localhost/api/x', { headers: { 'x-real-ip': ip, 'x-forwarded-for': '10.9.9.9' } });
  expect((await guardRateLimit(r, store, session, 0))?.status).toBe(429);
});
