import { describe, expect, test, vi } from 'vitest';
import Redis from 'ioredis';
import { withApiGuards } from '@/lib/http/guard';
import { RedisRateLimitStore } from '@/lib/ratelimit/redis-store';
import { REDIS_BOUNDED_OPTIONS } from '@/lib/redis';

// Redis is down. The guard must answer a stable 503 with a JSON error code, quickly, and must
// not let the failure escape as an unhandled error (which Next turns into an empty 500).

const req = () =>
  new Request('http://localhost:3000/api/delivery/intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.9' },
    body: '{}',
  });

const EXPECTED_BODY = { error: 'rate limit store unavailable', code: 'RATE_LIMIT_UNAVAILABLE' };

describe('withApiGuards with Redis unavailable', () => {
  test('a store that never answers gets a 503 within the deadline, and the handler does not run', async () => {
    const hangs = new RedisRateLimitStore({ eval: () => new Promise<never>(() => undefined) });
    const handler = vi.fn(async (_req: Request) => Response.json({ ok: true }));
    const guarded = withApiGuards(handler, { store: hangs });

    const started = Date.now();
    const res = await guarded(req());
    const elapsed = Date.now() - started;

    expect(res.status).toBe(503);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(await res.json()).toEqual(EXPECTED_BODY);
    expect(elapsed).toBeLessThan(3000);
    expect(handler).not.toHaveBeenCalled();
  }, 10_000);

  test('a store whose command rejects gets the same 503, not a thrown error', async () => {
    const down = new RedisRateLimitStore({ eval: () => Promise.reject(new Error('connect ECONNREFUSED')) });
    const handler = vi.fn(async (_req: Request) => Response.json({ ok: true }));
    const guarded = withApiGuards(handler, { store: down });

    const res = await guarded(req());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(EXPECTED_BODY);
    expect(handler).not.toHaveBeenCalled();
  });

  test('a real ioredis client pointed at a dead port answers 503 well under 5 s', async () => {
    // Same bounded client options the app uses. Port 1 on loopback refuses connections.
    const redis = new Redis('redis://127.0.0.1:1', REDIS_BOUNDED_OPTIONS);
    redis.on('error', () => undefined);
    try {
      const guarded = withApiGuards(async (_req: Request) => Response.json({ ok: true }), {
        store: new RedisRateLimitStore(redis),
      });
      const started = Date.now();
      const res = await guarded(req());
      const elapsed = Date.now() - started;

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual(EXPECTED_BODY);
      expect(elapsed).toBeLessThan(5000);
    } finally {
      redis.disconnect();
    }
  }, 15_000);
});
