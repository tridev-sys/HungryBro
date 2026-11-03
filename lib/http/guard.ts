import { LIMITS } from '@/lib/ratelimit/limits';
import { bucketKeyForIp, bucketKeyForSession, clientIpFromHeaders } from '@/lib/ratelimit/keys';
import type { RedisRateLimitStore } from '@/lib/ratelimit/redis-store';

/**
 * Checks the per-IP bucket, then the per-session bucket (when a session exists). Both must allow.
 * The IP bucket is consumed even when the session bucket denies, so it counts the attempt too.
 * Returns null when allowed, or a 429 Response with Retry-After in whole seconds.
 */
export async function guardRateLimit(
  req: Request,
  store: RedisRateLimitStore,
  sessionToken: string | null,
  nowMs: number = Date.now(),
): Promise<Response | null> {
  const ip = clientIpFromHeaders(req.headers);
  const byIp = await store.consume(bucketKeyForIp(ip), LIMITS.ip, nowMs);
  let decision = byIp;
  if (sessionToken) {
    const bySession = await store.consume(bucketKeyForSession(sessionToken), LIMITS.session, nowMs);
    if (!bySession.allowed) decision = bySession;
    else if (!byIp.allowed) decision = byIp;
  }
  if (decision.allowed) return null;
  return Response.json(
    { error: 'rate_limited' },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, decision.retryAfterSeconds)) } },
  );
}
