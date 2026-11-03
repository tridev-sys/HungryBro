import { consumeToken, type BucketConfig, type BucketState } from '@/lib/ratelimit/bucket';

const cfg: BucketConfig = { capacity: 3, refillPerSecond: 1 };

function drain(nowMs: number, times = 3): BucketState {
  let s: BucketState | null = null;
  for (let i = 0; i < times; i++) s = consumeToken(s, cfg, nowMs).state;
  return s!;
}

test('allows up to capacity at one instant, then denies', () => {
  let s: BucketState | null = null;
  const results: boolean[] = [];
  for (let i = 0; i < 4; i++) {
    const d = consumeToken(s, cfg, 0);
    results.push(d.allowed);
    s = d.state;
  }
  expect(results).toEqual([true, true, true, false]);
});

test('denial reports whole seconds until one token is available', () => {
  const d = consumeToken(drain(0), cfg, 0);
  expect(d.allowed).toBe(false);
  expect(d.retryAfterSeconds).toBe(1);
});

test('refills one token per second under a fake clock', () => {
  const s = drain(0);
  expect(consumeToken(s, cfg, 999).allowed).toBe(false);
  expect(consumeToken(s, cfg, 1000).allowed).toBe(true);
});

test('long idle time never grows the bucket past capacity (Review Focus 1)', () => {
  let s = consumeToken(null, cfg, 0).state;
  let allowed = 0;
  for (let i = 0; i < 4; i++) {
    const d = consumeToken(s, cfg, 10_000_000 + i);
    if (d.allowed) allowed++;
    s = d.state;
  }
  expect(allowed).toBe(3);
});

test('a denied request consumes no tokens (Review Focus 1)', () => {
  const s = drain(0);
  for (let i = 0; i < 5; i++) expect(consumeToken(s, cfg, 0).allowed).toBe(false);
  // One second later exactly one token exists, so one request passes and the next fails.
  const once = consumeToken(s, cfg, 1000);
  expect(once.allowed).toBe(true);
  expect(consumeToken(once.state, cfg, 1000).allowed).toBe(false);
});

test('a clock moving backwards does not mint tokens', () => {
  const s = drain(5000);
  expect(consumeToken(s, cfg, 0).allowed).toBe(false);
});

test('rejects non-positive configuration and cost', () => {
  expect(() => consumeToken(null, { capacity: 0, refillPerSecond: 1 }, 0)).toThrow(RangeError);
  expect(() => consumeToken(null, { capacity: 3, refillPerSecond: 0 }, 0)).toThrow(RangeError);
  expect(() => consumeToken(null, cfg, 0, 4)).toThrow(RangeError);
});
