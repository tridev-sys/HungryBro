import type { BucketConfig } from '@/lib/ratelimit/bucket';
import { clientIpFromHeaders } from '@/lib/ratelimit/keys';
import { RedisRateLimitStore } from '@/lib/ratelimit/redis-store';
import { getRedis } from '@/lib/redis';

// Sign-in is a server action, so it does not pass through withApiGuards. Each step has a per-IP bucket
// instead. The client IP is X-Real-IP (Caddy overwrites it with the TCP peer), as in clientIpFromHeaders.
export const SIGN_IN_LIMITS = {
  /** Code requests (phone or email). The per-identifier limit of 3 an hour still applies in lib/auth/otp.ts. */
  sendCode: { capacity: 20, refillPerSecond: 20 / 3600 },
  /** Code checks, email and authenticator. Both steps share one bucket, so guesses cannot be split across them. */
  verifyCode: { capacity: 30, refillPerSecond: 30 / 900 },
} as const satisfies Record<string, BucketConfig>;

export type SignInStep = keyof typeof SIGN_IN_LIMITS;

/** Same text for every refused step. It does not say which limit was hit or for which identifier. */
export const SIGN_IN_LIMITED_MESSAGE = 'Too many attempts from this network. Try again later.';

export interface SignInLimitStore {
  consume(key: string, cfg: BucketConfig, nowMs: number): Promise<{ allowed: boolean }>;
}

let shared: RedisRateLimitStore | undefined;
function defaultStore(): RedisRateLimitStore {
  shared ??= new RedisRateLimitStore(getRedis());
  return shared;
}

/**
 * True when this client IP may take another sign-in step. Consumes one token from that step's bucket,
 * so a refused attempt also counts.
 */
export async function allowSignInStep(
  step: SignInStep,
  h: Headers,
  store: SignInLimitStore = defaultStore(),
  nowMs: number = Date.now(),
): Promise<boolean> {
  const ip = clientIpFromHeaders(h);
  const decision = await store.consume(`rl:signin:${step}:${ip}`, SIGN_IN_LIMITS[step], nowMs);
  return decision.allowed;
}
