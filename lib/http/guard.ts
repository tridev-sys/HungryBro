import { LIMITS } from '@/lib/ratelimit/limits';
import { bucketKeyForIp, bucketKeyForSession, clientIpFromHeaders } from '@/lib/ratelimit/keys';
import { RedisRateLimitStore } from '@/lib/ratelimit/redis-store';
import { getRedis } from '@/lib/redis';
import { readSessionToken } from '@/lib/auth/session';
import { readTableSessionToken } from '@/lib/dine/cookie';
import { enforceDeclaredLength, PayloadTooLargeError } from './body';
import { withSecurityHeaders } from './security';

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

/**
 * The session-bucket key for every public route: the diner or staff session cookie, or the
 * table session cookie. Returns null for anonymous requests, which then use only the IP bucket.
 */
export function publicSessionToken(req: Request): string | null {
  const cookie = req.headers.get('cookie');
  return readSessionToken(cookie) ?? readTableSessionToken(cookie);
}

let sharedStore: RedisRateLimitStore | undefined;

function defaultStore(): RedisRateLimitStore {
  if (!sharedStore) sharedStore = new RedisRateLimitStore(getRedis());
  return sharedStore;
}

export interface ApiGuardOptions {
  /** Returns the raw session token for the session bucket, or null when there is no session. */
  sessionToken?: (req: Request) => string | null;
  /** Injected in tests; defaults to the shared Redis store. */
  store?: RedisRateLimitStore;
}

/**
 * Upper bound on the rate-limit store call. ioredis already fails a dead Redis in about 1 s per
 * attempt; this makes the answer arrive within this bound whatever the store is doing.
 */
export const RATE_LIMIT_DEADLINE_MS = 1500;

/**
 * Policy: fail closed. When the store cannot answer in time, the request is refused with 503 and
 * the handler does not run. This matches the pre-existing effect (a store error stopped the
 * request) but makes it a bounded, stable response. Plan 07 does not specify store failure, so
 * this follows the rate limiter's purpose: an unmetered request must not reach the handler.
 */
const storeUnavailable = () =>
  Response.json({ error: 'rate limit store unavailable', code: 'RATE_LIMIT_UNAVAILABLE' }, { status: 503 });

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('rate limit deadline exceeded')), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Wraps an /api route handler. Order: declared-length check, rate limit, handler.
 * Every response gets SECURITY_HEADERS. PayloadTooLargeError maps to 413. A rate-limit store
 * that fails or misses RATE_LIMIT_DEADLINE_MS maps to 503 RATE_LIMIT_UNAVAILABLE.
 */
export function withApiGuards<H extends (req: Request, ctx: never) => Promise<Response>>(
  handler: H,
  opts: ApiGuardOptions = {},
): H {
  const wrapped = async (req: Request, ctx?: unknown): Promise<Response> => {
    try {
      enforceDeclaredLength(req.headers);
      const sessionToken = opts.sessionToken?.(req) ?? null;
      let limited: Response | null;
      try {
        limited = await withDeadline(
          guardRateLimit(req, opts.store ?? defaultStore(), sessionToken),
          RATE_LIMIT_DEADLINE_MS,
        );
      } catch {
        return withSecurityHeaders(storeUnavailable());
      }
      if (limited) return withSecurityHeaders(limited);
      return withSecurityHeaders(await handler(req, ctx as never));
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        return withSecurityHeaders(Response.json({ error: 'payload_too_large' }, { status: 413 }));
      }
      throw err;
    }
  };
  // Same signature as the handler, so Next's route type checks and existing one-argument calls both hold.
  return wrapped as unknown as H;
}
