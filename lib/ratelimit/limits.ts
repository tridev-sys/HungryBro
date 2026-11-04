import type { BucketConfig } from './bucket';

/** Per-request limits. A request must pass both the IP bucket and the session bucket. */
export const LIMITS = {
  ip: { capacity: 120, refillPerSecond: 2 },
  session: { capacity: 60, refillPerSecond: 1 },
} as const satisfies Record<string, BucketConfig>;
