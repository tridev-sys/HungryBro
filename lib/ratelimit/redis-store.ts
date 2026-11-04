import type { BucketConfig, Decision } from './bucket';

/** Subset of ioredis used by the store (ioredis satisfies this). */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

// KEYS[1] = bucket key; ARGV: capacity, refill_per_sec, now_ms, cost.
// Same math as consumeToken(). Returns { allowed, retry_seconds, tokens }. Tokens are
// returned as a string because Redis truncates Lua numbers to integers.
const LUA_CONSUME = `
local cap = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1]) or cap
local ts = tonumber(data[2]) or now
local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(cap, tokens + elapsed * rate)
local stamp = math.max(now, ts)
local allowed = 0
local retry = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry = math.ceil((cost - tokens) / rate)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', stamp)
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate * 2000))
return { allowed, retry, tostring(tokens) }
`;

export class RedisRateLimitStore {
  constructor(private readonly redis: RedisLike) {}

  async consume(key: string, cfg: BucketConfig, nowMs: number, cost = 1): Promise<Decision> {
    if (!(cfg.capacity > 0) || !(cfg.refillPerSecond > 0)) throw new RangeError('bucket config must be positive');
    if (!(cost > 0) || cost > cfg.capacity) throw new RangeError('cost must be in (0, capacity]');
    const reply = (await this.redis.eval(
      LUA_CONSUME,
      1,
      key,
      cfg.capacity,
      cfg.refillPerSecond,
      nowMs,
      cost,
    )) as [number, number, string];
    const [allowed, retry, tokens] = reply;
    return {
      allowed: allowed === 1,
      state: { tokens: Number(tokens), updatedAtMs: nowMs },
      retryAfterSeconds: retry,
    };
  }
}
