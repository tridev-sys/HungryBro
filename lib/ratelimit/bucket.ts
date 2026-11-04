export interface BucketConfig {
  capacity: number;
  refillPerSecond: number;
}

export interface BucketState {
  tokens: number;
  updatedAtMs: number;
}

export interface Decision {
  allowed: boolean;
  state: BucketState;
  retryAfterSeconds: number;
}

/**
 * Pure token-bucket step. `state` null means a full bucket at `nowMs`.
 * A denied request returns the refilled (unspent) state, so it consumes no tokens.
 */
export function consumeToken(state: BucketState | null, cfg: BucketConfig, nowMs: number, cost = 1): Decision {
  if (!(cfg.capacity > 0) || !(cfg.refillPerSecond > 0)) throw new RangeError('bucket config must be positive');
  if (!(cost > 0) || cost > cfg.capacity) throw new RangeError('cost must be in (0, capacity]');
  const start = state ?? { tokens: cfg.capacity, updatedAtMs: nowMs };
  const elapsedSec = Math.max(0, nowMs - start.updatedAtMs) / 1000;
  const tokens = Math.min(cfg.capacity, start.tokens + elapsedSec * cfg.refillPerSecond);
  // Never move the stored timestamp backwards, so a clock step back cannot mint tokens later.
  const updatedAtMs = Math.max(nowMs, start.updatedAtMs);
  if (tokens >= cost) {
    return { allowed: true, state: { tokens: tokens - cost, updatedAtMs }, retryAfterSeconds: 0 };
  }
  return {
    allowed: false,
    state: { tokens, updatedAtMs },
    retryAfterSeconds: Math.ceil((cost - tokens) / cfg.refillPerSecond),
  };
}
