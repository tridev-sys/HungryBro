# Plan 07: Edge, Deploy, and Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the app behind the shared Caddy proxy (`proxy_server/`, container `proxy-caddy`) with Let's Encrypt TLS on one `c7i.xlarge` EC2 instance in `ap-south-1`, add in-app token-bucket rate limiting, security headers and body limits, nightly backups with a monthly restore test, a CI build-and-deploy pipeline with rollback, idempotent seed data for Indiranagar and HSR, and Playwright end-to-end tests for dine-in isolation and multi-merchant delivery auctions.

**Architecture:** Plan 01's `Dockerfile` and `docker-compose.yml` stay the base. This plan adds `docker-compose.prod.yml` as an override (ports removed, CPU and memory caps, networks, EBS bind mount, logging) and a `deploy/` directory (systemd units, S3 lifecycle, deploy script). The shared Caddy proxy is a separate stack in `proxy_server/` (its own compose file and Caddyfile) that joins the external `shared` network; it is the only service that publishes host ports. Rate limiting and HTTP guards live in `lib/ratelimit/` and `lib/http/` and run on the Node runtime inside route handlers. Operational scripts live in `scripts/`. Shell tests live in `scripts/tests/`.

**Tech Stack:** Next.js 15 (Node runtime), Redis 7 Alpine (Lua for atomic buckets), Caddy 2 (`caddy:2-alpine`, shared proxy), Docker Compose v2.24.4+ (uses `!reset` and `!override`), PostgreSQL 16 + PostGIS 3.4, GitHub Actions, GHCR, systemd timers, AWS CLI v2, UFW, Playwright, Vitest, `jq`.

**Spec:** `/home/ubuntu/original/food_prompt.md` §6; PDF "Ingress & Edge Proxy" topology (WAF and token-bucket rate limiting, ephemeral session token validation) and the seed and end-to-end test lines in the PDF roadmap. Decisions in `2026-11-03-00-roadmap.md` and `2026-11-03-tech-decisions.md` apply here and override the roadmap where they differ (see Global Constraints).

## Scope

In:
- (a) Token-bucket rate limiter: pure function plus Redis-backed store, per-IP and per-session keys, tested with a fake clock.
- (b) Security headers and a 64 KiB body limit on API routes.
- (c) Shared Caddy proxy (`proxy_server/`, container `proxy-caddy`) with automatic Let's Encrypt TLS; the app is reachable only over the external `shared` network.
- (d) Per-container memory limits matching the tech-decision budget; Redis `maxmemory 256mb` with `allkeys-lru`.
- (e) Backups: `pg_dump` to S3 with 14-day retention, systemd timers, restore script that loads into a scratch database and checks row counts against a manifest; monthly restore test.
- (f) GitHub Actions: test, build, push to GHCR, SSH deploy by immutable `sha-` tag, health check, rollback to the previous tag on failure.
- (g) EC2 bootstrap for Ubuntu: Docker, Compose plugin, 2 GiB swap, UFW allowing only 22, 80, 443. No data disk (storage decision 2026-11-04).
- (h) Idempotent seed script: four test restaurants (two in Indiranagar, two in HSR) with menus and dine-in tables.
- (i) Playwright E2E suite with two specs: simultaneous dine-in sessions and a multi-merchant delivery auction.
- (j) External uptime check on `/api/health` (free monitor, 5-minute interval), a CloudWatch instance alarm as backup, and the CloudWatch log driver.
- (k) Capacitor wrapper: documented as a later step at the end of this plan, not built here.

Out:
- Cloudflare WAF rules. Tech decisions say the WAF is added once there is a domain and the app does not depend on it. This plan records the hook point (the `X-Real-IP` contract) and nothing more.
- Auction engine, dine-in routes, and KDS UI. Plans 02 and 03 build them. The E2E specs in this plan consume their contracts (see Interfaces).
- OTP-specific rate limits. Plan 05 reuses `consumeToken` with its own limits.
- Native app builds (Capacitor). Later step.
- Database migrations. Plan 07 adds none. The schema is `001_init.sql` (Plan 01), `002_mesh_auction.sql` (Plan 02), `003_dine_in.sql` (Plan 03), `004_auth_ratings_compliance.sql` (Plan 05), and `005_integrations.sql` (Plan 06). Table QR signatures use the existing `dining_tables.current_signature_token` column from Plan 03, so no schema change is needed.

## Global Constraints

- Node.js 22 LTS; TypeScript `strict: true`; Vitest for unit and integration tests; real Postgres (PostGIS) and real Redis via Compose, no database mocks.
- Rate limits (per request, both checked; a request must pass both):
  - Per IP: bucket capacity `120`, refill `2` tokens/second.
  - Per session: bucket capacity `60`, refill `1` token/second. The session key is the session cookie, hashed.
  - Denied requests get `429` with `Retry-After` in whole seconds. Restaurant Wi-Fi is shared, so the IP limit is generous.
- Body limit: `65536` bytes (64 KiB) on every `/api/*` route handler. Over the limit returns `413`.
- Security headers on every response (constant `SECURITY_HEADERS` in `lib/http/security.ts`):
  - `Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.livekit.cloud wss://*.livekit.cloud`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: microphone=(self), camera=(), geolocation=(self)`
  - Nonce-based CSP is deferred; `unsafe-inline` is the documented trade-off until then.
- Client IP: Caddy overwrites `X-Real-IP` with the TCP peer address. The app reads `X-Real-IP` first and falls back to the rightmost `X-Forwarded-For` entry. It never trusts the leftmost entry. When Cloudflare is added, Caddy switches to `CF-Connecting-IP` in one place.
- Production ports: only `proxy-caddy` (the shared proxy) publishes host ports, exactly `80` and `443`. `app`, `db`, and `redis` publish none in the prod override. `app` is on networks `shared` (external) and `backend`; `db` and `redis` are on `backend` only. Caddy obtains and renews Let's Encrypt certificates for `DOMAIN` automatically, using `ACME_EMAIL`; HTTP redirects to HTTPS.
- Resource limits and volumes (tech decisions, binding): every service sets `cpus`, `mem_limit`, `mem_reservation`, `pids_limit`, a json-file log cap (`max-size` 10m, `max-file` 3), and `restart: unless-stopped`. Postgres data is the named volume `food-os-pgdata` on the root disk (storage decision 2026-11-04; supersedes the data-disk bind mount described below). Named volumes carry fixed names and labels (`food-os-redisdata`, `proxy-caddy-data`). Volumes are never removed by `docker compose down`.
- Hardware (tech decisions, decision 4): `c7i.xlarge` (4 vCPU, 8 GiB RAM) in `ap-south-1`, Ubuntu LTS. Not c4 and not t3. EBS gp3 for all volumes: root volume 60 GiB; no data disk (storage decision 2026-11-04). At least 20 GiB kept free on the root volume for `pg_dump` scratch in `/home/ubuntu/docker/backups-scratch`.
- Memory budget (`c7i.xlarge`, 8 GiB RAM):

  | Container | `mem_limit` | Note |
  |---|---|---|
  | `db` (Postgres + PostGIS) | 2 GiB | Per tech decisions |
  | `app` (includes migrations) | 1 GiB | `NODE_OPTIONS=--max-old-space-size=768` |
  | `redis` | 320 MiB | `maxmemory 256mb`; overhead above the cap |
  | `proxy-caddy` | 128 MiB | 0.5 CPU; shared proxy in `proxy_server/` |
  | OS, Docker, page cache | about 4.5 GiB | Includes 2 GiB swap file |

- Redis: `redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru`. Auction state is ephemeral; the database holds the record.
- Persistent data: Postgres data in the named volume `food-os-pgdata` on the root EBS disk (container path `/var/lib/postgresql/data`; storage decision 2026-11-04, `PGDATA_DIR` removed). Redis AOF in the named volume `redisdata`.
- Images: `ghcr.io/<owner>/food-os:sha-<40-hex-commit>`. Production never uses `latest`. GHCR owner must be lowercase.
- Backups: nightly at 21:00 UTC (02:30 IST) to `s3://<BACKUP_BUCKET>/pg/`. Retention 14 days by S3 lifecycle rule on prefix `pg/`. Restore test on the 3rd of each month at 04:00 UTC. The `proxy-caddy-data` volume is archived weekly (Sundays 21:30 UTC) to `s3://<BACKUP_BUCKET>/caddy/` with the same 14-day rule (Task 6).
- Migrations must be expand-only (no column drops or renames in the same release as a code change). Rollback to the previous image is only safe under that rule.
- Seed areas: Indiranagar and HSR only (tech decisions, decision 6). Koramangala is not seeded in v1; the roadmap's Koramangala mention is superseded.
- Database roles (tech decisions, decision 2): the migration runner and `scripts/seed.ts` connect as `food_admin` (BYPASSRLS, not superuser; `SET LOCAL ROLE food_admin` for DDL). `backup-pg.sh` uses a dedicated role `food_backup` (LOGIN, password from `BACKUP_DB_PASSWORD`, granted the built-in `pg_read_all_data`; no superuser, no write grants). `restore-check.sh` uses `food_admin` for the restore step only (create and restore the scratch database, then drop it) and `food_backup` for the row counts. The bootstrap login `food` is a superuser and is used only for the one-time role bootstrap (Task 6), which the instance owner runs once and which is documented as such. None of these scripts use `food_app` (request traffic) or `food_sync` (nightly sync job only).
- Caddy, not Nginx (tech decisions).
- Secrets: never in the repository. Host secrets live in `/home/ubuntu/docker/.env` (mode `600`). CI secrets live in GitHub Actions secrets.
- Seed script refuses to run when `NODE_ENV=production` unless `ALLOW_SEED_PROD=yes`.
- Seed data uses fictional restaurant names. Do not use the PDF's real example brands (Meghna Foods, Empire).
- Delivery E2E drop point: `DROP = { lat: 12.9420, lng: 77.6430 }` is a placeholder between the Indiranagar and HSR clusters, labelled `OWNER TO SET a real address`. It is within the 6 km transit radius of all four seeded kitchens (about 3.0 to 3.9 km each). The owner replaces it with a real address.
- Playwright E2E runs in the Playwright image attached to the `shared` network, against `E2E_BASE_URL=http://food-os-app:3000` (Gap A decision: the app publishes no host port, so `localhost:3000` is unreachable).
- The host runs Docker only. No Node, npm, or npx on the host: every Node command runs in a container (`node:22-alpine`, run as UID 1000, `--network host` to reach the local `localhost:5432` and `6379` ports), as shown in the Run lines.

## Review Focus

1. A token bucket never grants more than its capacity after long idle periods, and a denied request consumes no tokens. Owned by Task 1.
2. A client-sent `X-Forwarded-For` cannot change its own rate-limit bucket. Owned by Task 2.
3. A request body over 64 KiB is rejected even when `Content-Length` is absent. Owned by Task 3.
4. Across the whole stack, only `proxy-caddy` publishes host ports, exactly `80` and `443`; `app`, `db`, and `redis` publish none; the host listens publicly on only 22, 80, and 443. Owned by Task 4 (compose) and Task 5 (host).
5. A restore whose restored row counts differ from the backup manifest fails the restore check. Owned by Task 6.

---

### Task 1: Token-Bucket Core (Pure Function)

**Files:**
- Create: `lib/ratelimit/bucket.ts`, `lib/ratelimit/limits.ts`
- Test: `tests/ratelimit/bucket.test.ts`

**Interfaces:**
- Consumes: none
- Produces:
  - `interface BucketConfig { capacity: number; refillPerSecond: number }`
  - `interface BucketState { tokens: number; updatedAtMs: number }`
  - `interface Decision { allowed: boolean; state: BucketState; retryAfterSeconds: number }`
  - `consumeToken(state: BucketState | null, cfg: BucketConfig, nowMs: number, cost?: number): Decision`. `null` state means a full bucket at `nowMs`. `cost` defaults to `1`.
  - `LIMITS = { ip: { capacity: 120, refillPerSecond: 2 }, session: { capacity: 60, refillPerSecond: 1 } } as const` in `lib/ratelimit/limits.ts`.

- [ ] **Step 1: Write the failing tests (fake clock: `nowMs` is passed explicitly)**

```ts
// tests/ratelimit/bucket.test.ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker run --rm --network host --user 1000:1000 -e HOME=/tmp -v /home/ubuntu/docker:/app -w /app node:22-alpine npx vitest run tests/ratelimit/bucket.test.ts`
Expected: FAIL, "Cannot find module '@/lib/ratelimit/bucket'".

- [ ] **Step 3: Implement `lib/ratelimit/bucket.ts` and `lib/ratelimit/limits.ts`**

Fixed logic for `consumeToken`:

```ts
export function consumeToken(state: BucketState | null, cfg: BucketConfig, nowMs: number, cost = 1): Decision {
  if (!(cfg.capacity > 0) || !(cfg.refillPerSecond > 0)) throw new RangeError('bucket config must be positive');
  if (!(cost > 0) || cost > cfg.capacity) throw new RangeError('cost must be in (0, capacity]');
  const start = state ?? { tokens: cfg.capacity, updatedAtMs: nowMs };
  const elapsedSec = Math.max(0, nowMs - start.updatedAtMs) / 1000;
  const tokens = Math.min(cfg.capacity, start.tokens + elapsedSec * cfg.refillPerSecond);
  if (tokens >= cost) {
    return { allowed: true, state: { tokens: tokens - cost, updatedAtMs: nowMs }, retryAfterSeconds: 0 };
  }
  return {
    allowed: false,
    state: { tokens, updatedAtMs: nowMs },
    retryAfterSeconds: Math.ceil((cost - tokens) / cfg.refillPerSecond),
  };
}
```

`limits.ts` exports `LIMITS` exactly as in Interfaces. No other logic in this file.

- [ ] **Step 4: Verify**

Run: `docker run --rm --network host --user 1000:1000 -e HOME=/tmp -v /home/ubuntu/docker:/app -w /app node:22-alpine npx vitest run tests/ratelimit/bucket.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/ratelimit/bucket.ts lib/ratelimit/limits.ts tests/ratelimit/bucket.test.ts
git commit -m "feat: add token-bucket core with fake-clock tests

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Redis-Backed Store, Keys, and Rate-Limit Guard

**Files:**
- Create: `lib/ratelimit/redis-store.ts`, `lib/ratelimit/keys.ts`, `lib/http/guard.ts`
- Test: `tests/ratelimit/redis-store.test.ts`, `tests/ratelimit/keys.test.ts`

**Interfaces:**
- Consumes: `consumeToken`, `BucketConfig`, `Decision` (Task 1); `LIMITS` (Task 1); `REDIS_URL` (Plan 01).
- Produces:
  - `interface RedisLike { eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown> }` (matches `ioredis`)
  - `class RedisRateLimitStore { constructor(redis: RedisLike); consume(key: string, cfg: BucketConfig, nowMs: number, cost?: number): Promise<Decision> }`. Runs one Lua script per call, so check and update are atomic.
  - `bucketKeyForIp(ip: string): string` returns `rl:ip:<ip>`.
  - `bucketKeyForSession(sessionToken: string): string` returns `rl:sess:<first 32 hex chars of sha256(token)>`.
  - `clientIpFromHeaders(h: Headers): string` returns `x-real-ip` if set, otherwise the rightmost `x-forwarded-for` entry, otherwise `'unknown'`.
  - `guardRateLimit(req: Request, store: RedisRateLimitStore, sessionToken: string | null, nowMs?: number): Promise<Response | null>`. Returns `null` when allowed; otherwise a `429` `Response` with `Retry-After`. Checks IP then session; both must allow. Consumes from the IP bucket even when the session bucket denies, so the IP bucket also reflects the attempt.
  - `withApiGuards(handler)` wrapper is added in Task 3.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/ratelimit/keys.test.ts
import { bucketKeyForIp, bucketKeyForSession, clientIpFromHeaders } from '@/lib/ratelimit/keys';

test('session key never contains the raw token', () => {
  const k = bucketKeyForSession('eyJhbGciOiJIUzI1NiJ9.secret-part');
  expect(k.startsWith('rl:sess:')).toBe(true);
  expect(k).not.toContain('secret-part');
  expect(k.length).toBe('rl:sess:'.length + 32);
});

test('IP key is prefixed', () => {
  expect(bucketKeyForIp('203.0.113.9')).toBe('rl:ip:203.0.113.9');
});

test('Caddy-set X-Real-IP wins over any forwarded chain', () => {
  const h = new Headers({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.66' });
  expect(clientIpFromHeaders(h)).toBe('203.0.113.9');
});

test('client-sent X-Forwarded-For cannot pick its own IP (Review Focus 2)', () => {
  // Caddy appends the real peer to the end of the chain. The leftmost entry is attacker-controlled.
  const h = new Headers({ 'x-forwarded-for': '198.51.100.66, 203.0.113.9' });
  expect(clientIpFromHeaders(h)).toBe('203.0.113.9');
  expect(clientIpFromHeaders(new Headers())).toBe('unknown');
});
```

```ts
// tests/ratelimit/redis-store.test.ts
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
```

Guard test (`tests/ratelimit/guard.test.ts`, Redis real): given a store with `capacity 120` IP bucket and a session key, a request from one IP with 60 sequential session-A calls and then one more returns `429` with a numeric `Retry-After`; a request from the same IP with a different session still gets `null` until the IP bucket is empty. Use fixed `nowMs` values.

- [ ] **Step 2: Run to verify it fails**

Run: `docker run --rm --network host --user 1000:1000 -e HOME=/tmp -e REDIS_URL=redis://localhost:6379 -v /home/ubuntu/docker:/app -w /app node:22-alpine npx vitest run tests/ratelimit`
Expected: FAIL, "Cannot find module '@/lib/ratelimit/keys'" (Redis must be running from the Plan 01 compose stack).

- [ ] **Step 3: Implement**

Lua script for `redis-store.ts` (fixed logic; same math as `consumeToken`):

```lua
-- KEYS[1] = bucket key; ARGV: capacity, refill_per_sec, now_ms, cost
local cap = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1]) or cap
local ts = tonumber(data[2]) or now
local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(cap, tokens + elapsed * rate)
local allowed = 0
local retry = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry = math.ceil((cost - tokens) / rate)
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate * 2000))
return { allowed, retry }
```

- `RedisRateLimitStore.consume` passes `cfg.capacity`, `cfg.refillPerSecond`, `nowMs`, `cost ?? 1`; parses the reply into `Decision`. The returned `state` is reconstructed as `{ tokens, updatedAtMs: nowMs }` only when needed by callers; the store is stateless from the caller's view.
- `keys.ts` uses `node:crypto` `createHash('sha256')`.
- `guard.ts`: `guardRateLimit` builds the two keys, calls `store.consume` with `LIMITS.ip` then `LIMITS.session` (when a session token exists), and returns a `Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retry) } })` on denial.

- [ ] **Step 4: Verify**

Run: `docker run --rm --network host --user 1000:1000 -e HOME=/tmp -e REDIS_URL=redis://localhost:6379 -v /home/ubuntu/docker:/app -w /app node:22-alpine npx vitest run tests/ratelimit`
Expected: all pass: `keys` (4 tests), `redis-store` (3 tests), `guard` (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ratelimit lib/http/guard.ts tests/ratelimit
git commit -m "feat: add Redis token-bucket store, rate-limit keys, and guard

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Security Headers and Body Size Limit

**Files:**
- Create: `lib/http/security.ts`, `lib/http/body.ts`
- Modify: `lib/http/guard.ts` (add `withApiGuards`), `next.config.ts` (add `headers()` from `SECURITY_HEADERS`)
- Test: `tests/http/security.test.ts`, `tests/http/body.test.ts`

**Interfaces:**
- Consumes: `guardRateLimit` (Task 2); `Response` headers API.
- Produces:
  - `SECURITY_HEADERS: Record<string, string>` (exact list in Global Constraints)
  - `withSecurityHeaders(res: Response): Response`
  - `BODY_LIMIT_BYTES = 65536`
  - `class PayloadTooLargeError extends Error`
  - `enforceDeclaredLength(h: Headers, limit?: number): void` throws `PayloadTooLargeError` when `content-length` is present and greater than `limit`.
  - `readJsonWithLimit(req: Request, limit?: number): Promise<unknown>` reads the body stream, counts bytes, throws `PayloadTooLargeError` once the count exceeds `limit`, then parses JSON.
  - `withApiGuards<C>(handler: (req: Request, ctx: C) => Promise<Response>, opts?: { sessionToken?: (req: Request) => string | null }): (req: Request, ctx: C) => Promise<Response>`. Order: declared-length check, rate limit, handler; every response passes through `withSecurityHeaders`; `PayloadTooLargeError` maps to `413`. Each route handler sets `export const runtime = 'nodejs'`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/http/body.test.ts
import { readJsonWithLimit, enforceDeclaredLength, PayloadTooLargeError, BODY_LIMIT_BYTES } from '@/lib/http/body';

function streamOf(totalBytes: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(1024);
  return new ReadableStream({
    start(c) {
      let sent = 0;
      while (sent < totalBytes) {
        const n = Math.min(chunk.length, totalBytes - sent);
        c.enqueue(chunk.subarray(0, n));
        sent += n;
      }
      c.close();
    },
  });
}

test('limit is 64 KiB', () => {
  expect(BODY_LIMIT_BYTES).toBe(65536);
});

test('rejects a streamed body over the limit with no Content-Length (Review Focus 3)', async () => {
  const req = new Request('http://localhost/api/t', { method: 'POST', body: streamOf(65 * 1024), duplex: 'half' } as RequestInit);
  await expect(readJsonWithLimit(req)).rejects.toBeInstanceOf(PayloadTooLargeError);
});

test('accepts a JSON body at exactly the limit', async () => {
  const json = JSON.stringify({ s: 'a'.repeat(BODY_LIMIT_BYTES - 6) }); // 65536 bytes total
  expect(new TextEncoder().encode(json).length).toBe(BODY_LIMIT_BYTES);
  const req = new Request('http://localhost/api/t', { method: 'POST', body: json });
  expect(await readJsonWithLimit(req)).toEqual({ s: 'a'.repeat(BODY_LIMIT_BYTES - 6) });
});

test('declared Content-Length above the limit is refused before reading', () => {
  expect(() => enforceDeclaredLength(new Headers({ 'content-length': '70000' }))).toThrow(PayloadTooLargeError);
  expect(() => enforceDeclaredLength(new Headers({ 'content-length': '100' }))).not.toThrow();
  expect(() => enforceDeclaredLength(new Headers())).not.toThrow();
});
```

```ts
// tests/http/security.test.ts
import { withSecurityHeaders, SECURITY_HEADERS } from '@/lib/http/security';

test('every security header is applied and the server banner is absent', () => {
  const res = withSecurityHeaders(Response.json({ ok: true }));
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('x-frame-options')).toBe('DENY');
  expect(res.headers.get('strict-transport-security')).toContain('max-age=31536000');
  expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  expect(res.headers.get('permissions-policy')).toContain('microphone=(self)');
  expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  expect(Object.keys(SECURITY_HEADERS)).toHaveLength(6);
});

test('existing response body and status are preserved', async () => {
  const res = withSecurityHeaders(Response.json({ ok: true }, { status: 201 }));
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker run --rm --network host --user 1000:1000 -e HOME=/tmp -v /home/ubuntu/docker:/app -w /app node:22-alpine npx vitest run tests/http`
Expected: FAIL, "Cannot find module '@/lib/http/body'".

- [ ] **Step 3: Implement**

Fixed logic for `readJsonWithLimit`:

```ts
export async function readJsonWithLimit(req: Request, limit = BODY_LIMIT_BYTES): Promise<unknown> {
  enforceDeclaredLength(req.headers, limit);
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new PayloadTooLargeError(limit);
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return JSON.parse(new TextDecoder().decode(buf));
}
```

- `next.config.ts`: `headers()` returns `[{ source: '/:path*', headers: Object.entries(SECURITY_HEADERS).map(([key, value]) => ({ key, value })) }]`. Import from `lib/http/security.ts`; keep `security.ts` free of Next imports.
- Extend `guard.ts` with `withApiGuards` per Interfaces.

- [ ] **Step 4: Verify**

Run: `docker run --rm --network host --user 1000:1000 -e HOME=/tmp -v /home/ubuntu/docker:/app -w /app node:22-alpine npx vitest run tests/http && docker run --rm --network host --user 1000:1000 -e HOME=/tmp -v /home/ubuntu/docker:/app -w /app node:22-alpine npm run typecheck && docker run --rm --network host --user 1000:1000 -e HOME=/tmp -v /home/ubuntu/docker:/app -w /app node:22-alpine npm run build`
Expected: 6 tests pass (body: 4, security: 2); typecheck exits 0; build succeeds with headers configured. Add one guard test to `tests/ratelimit/guard.test.ts` that a streamed oversize body returns `413` through `withApiGuards`; it must pass in this step too.

- [ ] **Step 5: Commit**

```bash
git add lib/http next.config.ts tests/http
git commit -m "feat: add security headers, 64 KiB body limit, and API guard wrapper

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shared Proxy and Production Override

**Files:**
- Create (or verify, if already present): `proxy_server/Caddyfile`, `proxy_server/docker-compose.yml`, `docker-compose.prod.yml`, `scripts/tests/prod-compose.test.sh`
- Modify: `docker-compose.yml` (Plan 01 base): only the `redis` service `command`

**Interfaces:**
- Consumes: Plan 01 `docker-compose.yml` (`app`, `db`, `redis`, `pgdata`, `redisdata`, the `backend` and external `shared` networks, healthchecks); `proxy_server/create-shared-network.sh` (creates `shared`); `IMAGE_TAG`, `GHCR_OWNER`, `POSTGRES_PASSWORD` env (set in `/home/ubuntu/docker/.env`); `DOMAIN` and `ACME_EMAIL` env (set in the proxy's `.env`).
- Produces:
  - `proxy_server/Caddyfile`: global block `{ email {$ACME_EMAIL} }`; one site block for `{$DOMAIN}` with `encode zstd gzip`, `header { -Server }`, `reverse_proxy food-os-app:3000` with `header_up X-Real-IP {remote_host}`, and access logs to stdout. Automatic Let's Encrypt TLS and the HTTP-to-HTTPS redirect come from Caddy's defaults. Adding an app means adding one site block.
  - `proxy_server/docker-compose.yml` (run from `proxy_server/`): service `caddy`, `container_name: proxy-caddy`, `image: caddy:2-alpine`, `ports: ["80:80", "443:443"]`, mounts `./Caddyfile:/etc/caddy/Caddyfile:ro` and the named volumes `caddy_data` and `caddy_config`, env `DOMAIN` and `ACME_EMAIL` (both required via `${...:?}`), `restart: unless-stopped`, `networks: [shared]`, caps `cpus: 0.5`, `mem_limit: 128m`, `mem_reservation: 64m`, `pids_limit: 128` (tech decisions require both keys but give no Caddy values; these two are proposed), json-file log cap (`max-size` 10m, `max-file` 3). Top level: `networks: { shared: { external: true } }`.
    - Volume `caddy_data`: `name: proxy-caddy-data`, labels `app: food-os`, `purpose: tls-certificates`. It holds Let's Encrypt certificates and ACME account keys; losing it forces re-issuance, so it is part of the backup set (backup mechanism to be confirmed; see Unresolved Gaps). `caddy_config` is labelled `purpose: caddy-config`.
  - `docker-compose.prod.yml` override (run as `docker compose -f docker-compose.yml -f docker-compose.prod.yml`):
    - `app`: `image: ghcr.io/${GHCR_OWNER}/food-os:${IMAGE_TAG:?}`, `build: !reset null`, `ports: !reset []`, `expose: ["3000"]`, `cpus: 1.5`, `mem_limit: 1g`, `mem_reservation: 512m`, `pids_limit: 512`, `networks: [shared, backend]`, `restart: unless-stopped`.
    - `db`: `ports: !reset []` (the base's `127.0.0.1:5432` binding is removed; prod publishes nothing), `volumes: !override ["pgdata:/var/lib/postgresql/data"]` (named volume `food-os-pgdata` on the root disk, declared in the prod file with the base's name and labels; storage decision 2026-11-04), `cpus: 2.0`, `mem_limit: 2g`, `mem_reservation: 1g`, `shm_size: 256m`, `pids_limit: 256`, `networks: [backend]`, `restart: unless-stopped`.
    - `redis`: `ports: !reset []`, `cpus: 0.5`, `mem_limit: 320m`, `mem_reservation: 128m`, `pids_limit: 128`, `networks: [backend]`, `restart: unless-stopped`.
    - No `caddy` service here (the proxy is its own stack), and no `depends_on` across stacks.
  - Base `redis` `command`: `redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru`.

- [ ] **Step 1: Write the failing test**

```bash
#!/usr/bin/env bash
# scripts/tests/prod-compose.test.sh
set -euo pipefail
export IMAGE_TAG=sha-0000000000000000000000000000000000000000 GHCR_OWNER=example DOMAIN=test.example.com \
  ACME_EMAIL=ops@example.com POSTGRES_PASSWORD=change-me
cfg=$(docker compose -f docker-compose.yml -f docker-compose.prod.yml config --format json)
pcfg=$(docker compose -f proxy_server/docker-compose.yml config --format json)
j() { echo "$cfg" | jq -e "$1" >/dev/null || { echo "FAIL: $1" >&2; exit 1; }; }
p() { echo "$pcfg" | jq -e "$1" >/dev/null || { echo "FAIL (proxy): $1" >&2; exit 1; }; }

# Review Focus 4: across the whole stack, exactly 80 and 443 are published, both by proxy-caddy
p '.services.caddy.container_name == "proxy-caddy" and .services.caddy.image == "caddy:2-alpine"'
p '[.services.caddy.ports[].published | tonumber] | sort == [80, 443]'
all=$( (echo "$cfg"; echo "$pcfg") | jq -s '[.[].services[] | (.ports // [])[] | .published | tonumber] | sort')
[ "$all" = "[80,443]" ] || { echo "FAIL: published ports across the stack are $all" >&2; exit 1; }
j '([.services.app.ports // []] | flatten | length) == 0'
j '([.services.db.ports // []] | flatten | length) == 0'
j '([.services.redis.ports // []] | flatten | length) == 0'

# CPU and memory caps (tech decisions, "Container resource limits")
j '(.services.app.cpus | tonumber) == 1.5 and (.services.app.mem_limit | tonumber) == 1073741824'
j '(.services.db.cpus | tonumber) == 2.0 and (.services.db.mem_limit | tonumber) == 2147483648'
j '(.services.redis.cpus | tonumber) == 0.5 and (.services.redis.mem_limit | tonumber) == 335544320'
p '(.services.caddy.cpus | tonumber) == 0.5 and (.services.caddy.mem_limit | tonumber) == 134217728'

# Postgres data is the named volume food-os-pgdata on the root disk (storage decision 2026-11-04)
j '[.services.db.volumes[] | select(.target == "/var/lib/postgresql/data") | .type, .source] == ["volume", "pgdata"]'

# Redis cap and eviction
j '(.services.redis.command | if type == "array" then join(" ") else . end) | contains("--maxmemory 256mb") and contains("--maxmemory-policy allkeys-lru")'

# Network isolation: app is on shared and backend; db and redis only on backend; proxy only on shared
j '(.services.app.networks | keys | sort) == ["backend", "shared"]'
j '.networks.shared.external == true'
j '(.services.db.networks | keys) == ["backend"]'
j '(.services.redis.networks | keys) == ["backend"]'
p '(.services.caddy.networks | keys) == ["shared"]'

echo "prod compose OK"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash scripts/tests/prod-compose.test.sh`
Expected: FAIL, a `docker compose` error "no such file" for `docker-compose.prod.yml` or `proxy_server/docker-compose.yml`, or a failed `caddy` or override assertion.

- [ ] **Step 3: Implement**

- `proxy_server/Caddyfile` and `proxy_server/docker-compose.yml`: as in Interfaces. Add `header { -Server }` to strip the server banner. Run `proxy_server/create-shared-network.sh` once on the host before the first `up` of either stack; the app's compose fails without the external `shared` network.
- Base `docker-compose.yml`: change only `redis.command` to the value in Interfaces. Keep the healthcheck and volume.
- `docker-compose.prod.yml`: as in Interfaces. `!reset` and `!override` require Compose v2.24.4 or later; the bootstrap script in Task 5 installs the current plugin.
- Validate the Caddyfile once: `docker run --rm -v "$PWD/proxy_server/Caddyfile:/etc/caddy/Caddyfile:ro" -e DOMAIN=test.example.com -e ACME_EMAIL=ops@example.com caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile`. Expected: `Valid configuration`.
- On the host, the proxy runs from `/home/ubuntu/docker/proxy_server/` (owner decision; inside the project root, as its own compose stack). Stopping the app stack never removes the proxy's volumes.

- [ ] **Step 4: Verify**

Run: `bash scripts/tests/prod-compose.test.sh`
Expected: `prod compose OK`.

- [ ] **Step 5: Commit**

```bash
git add proxy_server/Caddyfile proxy_server/docker-compose.yml docker-compose.yml docker-compose.prod.yml scripts/tests/prod-compose.test.sh
git commit -m "feat: add shared Caddy proxy, prod compose override, resource caps, and Redis cap

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 5: EC2 Bootstrap and Host Verification

**Files:**
- Create: `scripts/ec2-bootstrap.sh`, `scripts/verify-host.sh`
- Test: `scripts/verify-host.sh` is the test (run on the instance)

**Interfaces:**
- Consumes: Ubuntu LTS on `c7i.xlarge`, `ap-south-1`; root gp3 volume 60 GiB; no data disk (the 100 GiB data disk is detached and not used, storage decision 2026-11-04).
- Produces:
  - `scripts/ec2-bootstrap.sh` (run once as root, safe to re-run). Idempotent steps: Docker Engine and Compose plugin from Docker's apt repo; `deploy` user (docker group, key-only login, public key from `DEPLOY_PUBLIC_KEY`); 2 GiB swap at `/swapfile` with `vm.swappiness=10`; `/home/ubuntu/docker` owned by `deploy`; UFW: default deny incoming, allow `22/tcp`, `80/tcp`, `443/tcp`, enable; `unattended-upgrades` enabled.
  - `scripts/verify-host.sh` exits 0 only when all checks pass; prints one line per check.

- [ ] **Step 1: Write the verification script first (this is the failing test)**

`scripts/verify-host.sh` checks, each printing `PASS` or `FAIL`:
1. `ufw status | grep -q "Status: active"`.
2. Publicly listening TCP ports are exactly `22 80 443` (Review Focus 4): `ss -tln | awk 'NR>1 {print $4}' | grep -E '^(0\.0\.0\.0|\[::\]|\*):' | sed 's/.*://' | sort -u` must equal the three numbers. Loopback-bound Docker ports are excluded by design; the shared proxy's 80 and 443 are the only Docker-published ports.
3. `swapon --show=SIZE --bytes --noheadings` total is at least `2147483648`.
4. `docker volume inspect food-os-pgdata` succeeds (storage decision 2026-11-04; no data disk).
5. `docker compose version` reports v2.24.4 or later.
6. `id deploy` shows `docker` group membership; `sudo -u deploy docker ps` exits 0.
7. `sshd -T | grep -q '^passwordauthentication no$'`.
8. `df --output=avail -B1G /home/ubuntu/docker | tail -1` is at least `20` (pg_dump scratch on the root disk, Global Constraints).

- [ ] **Step 2: Run to verify it fails**

Run (on a fresh instance before bootstrap): `bash scripts/verify-host.sh`
Expected: exit 1, with at least checks 1, 3, 4, and 6 printing `FAIL`.

- [ ] **Step 3: Implement `scripts/ec2-bootstrap.sh`**

- `set -euo pipefail`; refuse to run unless `id -u` is 0.
- Use the official Docker apt repository (`download.docker.com/linux/ubuntu`), packages `docker-ce docker-ce-cli containerd.io docker-compose-plugin`.
- Swap: create `/swapfile` with `fallocate -l 2G` only if absent; `chmod 600`; `mkswap`; `swapon`; append to `/etc/fstab` only if the line is missing.
- EBS: none. No data disk is mounted (storage decision 2026-11-04).
- UFW: `ufw default deny incoming`, `ufw default allow outgoing`, `ufw allow 22/tcp`, `ufw allow 80/tcp`, `ufw allow 443/tcp`, `ufw --force enable`.
- SSH: write `/etc/ssh/sshd_config.d/90-food-os.conf` with `PasswordAuthentication no` and `PermitRootLogin no`; `systemctl reload ssh`.
- Instance profile (set in AWS, not in the script; document here): IAM role with `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`, `logs:DescribeLogStreams` on `/food-os/*`, and `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` on `<BACKUP_BUCKET>` (`pg/*`). Security group inbound: 22 from the owner's IP only; 80 and 443 from anywhere.

- [ ] **Step 4: Verify**

Run on the instance: `sudo bash scripts/ec2-bootstrap.sh && bash scripts/verify-host.sh`
Expected: bootstrap exits 0; verify prints eight `PASS` lines and exits 0. Run bootstrap a second time; it still exits 0 and changes nothing.

- [ ] **Step 5: Commit**

```bash
git add scripts/ec2-bootstrap.sh scripts/verify-host.sh
git commit -m "feat: add idempotent EC2 bootstrap and host verification

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Backups, Retention, Systemd Timers, and Restore Check

**Files:**
- Create: `scripts/backup-pg.sh`, `scripts/restore-check.sh`, `scripts/tests/backup-restore.test.sh`, `deploy/s3-lifecycle.json`, `deploy/systemd/food-os-backup.service`, `deploy/systemd/food-os-backup.timer`, `deploy/systemd/food-os-restore-check.service`, `deploy/systemd/food-os-restore-check.timer`, `scripts/caddy-data-backup.sh`, `deploy/systemd/food-os-caddy-backup.service`, `deploy/systemd/food-os-caddy-backup.timer`

**Interfaces:**
- Consumes: `db` container (`food_os` database; decision 2); roles `food_backup` and `food_admin` (created by the one-time role bootstrap below); `BACKUP_DB_PASSWORD` (in `/home/ubuntu/docker/.env`, mode `600`); `BACKUP_TARGET` (`s3://bucket/prefix` in production, or `file:///dir` for tests only); `AWS_REGION=ap-south-1`.
- Produces:
  - Role bootstrap (one time, superuser, run by the instance owner; documented here as the only step that needs the bootstrap login `food`): `docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db psql -U food -d postgres -v ON_ERROR_STOP=1 -v pw="$BACKUP_DB_PASSWORD"` with stdin set to this SQL, which is idempotent:
    ```sql
    SELECT format('CREATE ROLE food_backup LOGIN PASSWORD %L', :'pw')
      WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_backup') \gexec
    ALTER ROLE food_backup LOGIN PASSWORD :'pw';
    GRANT pg_read_all_data TO food_backup;
    ALTER ROLE food_admin CREATEDB;  -- restore-check creates the scratch database as food_admin
    ```
    Re-running it changes nothing except re-setting the same password. Verify the grants in Task 6 Step 4.
  - `scripts/backup-pg.sh`: runs `pg_dump -Fc -U food_backup food_os` inside `db` via `docker compose exec -T -e PGPASSWORD="$BACKUP_DB_PASSWORD" db`. Writes `pg/food_os-<UTC timestamp>.dump` and a sidecar `pg/food_os-<UTC timestamp>.counts.json` containing exact row counts of `restaurant_nodes`, `menu_items`, `menu_categories`, `dining_tables`, `tabletop_sessions`, `kds_tickets`, `mesh_food_auctions`, `verified_customer_ratings`, taken from the same snapshot (run the counts inside the same `pg_dump` transaction via `--snapshot` or by dumping counts in a `REPEATABLE READ` transaction). Uploads both with `aws s3 cp` (or copies with `cp` for `file://`). Exit non-zero on any failure.
  - `scripts/restore-check.sh <dump-uri-or-path>`: copies the dump into the `db` container, creates `food_os_restore_check`, runs `pg_restore --no-owner --exit-on-error` as `food_admin` (the only step that uses `food_admin`), counts the same tables as `food_backup`, compares with the sidecar manifest; drops the scratch database in a `trap`. Prints `restore check OK` and exits 0 only on exact equality for every table (Review Focus 5). Prints per-table mismatches and exits 1 otherwise.
  - `deploy/s3-lifecycle.json`: rule `expire-pg-14d`, prefix `pg/`, `Expiration: { Days: 14 }`, and rule `expire-caddy-14d`, prefix `caddy/`, the same expiration; applied with `aws s3api put-bucket-lifecycle-configuration`.
  - systemd: `food-os-backup.timer` with `OnCalendar=*-*-* 21:00:00 UTC` and `Persistent=true`; service runs `/home/ubuntu/docker/scripts/backup-pg.sh` as `deploy` with `EnvironmentFile=/home/ubuntu/docker/.env` and `WorkingDirectory=/home/ubuntu/docker` (all units set this). `food-os-restore-check.timer` with `OnCalendar=*-*-03 04:00:00 UTC`, `Persistent=true`; service runs `restore-check.sh` on the latest key (`scripts/restore-check.sh latest`, which resolves the newest `pg/*.dump` by name), then `scripts/caddy-data-backup.sh check latest`.
  - Gap B, `proxy-caddy-data` backup: `scripts/caddy-data-backup.sh backup` runs as `deploy`. It archives the volume read-only with `docker run --rm -v proxy-caddy-data:/data:ro -v "$dir:/out" alpine tar -C /data -czf /out/caddy-data-<UTC timestamp>.tar.gz .`, where `$dir` is a `mktemp -d` under `BACKUP_SCRATCH` removed by a `trap`. It uploads with `aws s3 cp` to `s3://<BACKUP_BUCKET>/caddy/`. The archive holds certificates and ACME account keys, so the bucket must stay private. Losing the volume forces certificate re-issue.
  - Restore check for it: `scripts/caddy-data-backup.sh check latest` downloads the newest `caddy/*.tar.gz`, extracts it into a throwaway volume (removed by a `trap`), and passes only if `caddy/acme` and `caddy/certificates` exist and are non-empty. Prints `caddy-data check OK`.
  - systemd: `food-os-caddy-backup.timer` with `OnCalendar=Sun *-*-* 21:30:00 UTC` and `Persistent=true`; service runs the backup as `deploy` with `EnvironmentFile` and `WorkingDirectory` as above.

- [ ] **Step 1: Write the failing test**

```bash
#!/usr/bin/env bash
# scripts/tests/backup-restore.test.sh   (needs the local compose stack up with migrations applied)
set -euo pipefail
T=$(mktemp -d)
export BACKUP_TARGET="file://$T" BACKUP_SCRATCH="$T" MIN_FREE_GIB=0
bash scripts/backup-pg.sh
dump=$(ls "$T"/pg/food_os-*.dump)
manifest="${dump%.dump}.counts.json"
test -s "$dump"
test -s "$manifest"

# Happy path
out=$(bash scripts/restore-check.sh "$dump")
echo "$out" | grep -q 'restore check OK'

# Review Focus 5: a manifest that disagrees with the restored data must fail
jq '.menu_items += 1' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
if bash scripts/restore-check.sh "$dump" > "$T/neg.log" 2>&1; then
  echo "FAIL: restore check passed with a wrong manifest" >&2; exit 1
fi
grep -q 'menu_items' "$T/neg.log"
# Scratch DB is always dropped
docker compose exec -T -e PGPASSWORD="$BACKUP_DB_PASSWORD" db psql -U food_backup -d food_os -tAc \
  "SELECT count(*) FROM pg_database WHERE datname = 'food_os_restore_check'" | grep -qx 0
echo "backup-restore OK"
```

```bash
# scripts/tests/backup-role.test.sh   (needs the local stack up and the role bootstrap applied)
set -euo pipefail
: "${BACKUP_DB_PASSWORD:?}"
T=$(mktemp -d)
psql_backup() {
  docker compose exec -T -e PGPASSWORD="$BACKUP_DB_PASSWORD" db psql -U food_backup -d food_os -v ON_ERROR_STOP=1 "$@"
}
# food_backup can read
n=$(psql_backup -tAc 'SELECT count(*) FROM restaurant_nodes')
[[ "$n" =~ ^[0-9]+$ ]]
# food_backup cannot write: the INSERT is rejected with a permission error (WHERE false inserts no rows)
if psql_backup -c 'INSERT INTO restaurant_nodes SELECT * FROM restaurant_nodes WHERE false' > "$T/ins.log" 2>&1; then
  echo "FAIL: food_backup INSERT succeeded" >&2; exit 1
fi
grep -q 'permission denied' "$T/ins.log"
echo "backup-role OK"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash scripts/tests/backup-restore.test.sh`
Expected: FAIL, "scripts/backup-pg.sh: No such file or directory".

- [ ] **Step 3: Implement**

- Follow the Interfaces exactly. Use `set -euo pipefail`, quote every variable, and write dumps under `mktemp -d` inside `BACKUP_SCRATCH` (default `backups-scratch/` in the repo, on the root volume) and remove it on exit with `trap`. Before dumping, refuse to run when less than `MIN_FREE_GIB` (default `20`) GiB is free on that filesystem, keeping the pg_dump headroom from Global Constraints. Tests set `MIN_FREE_GIB=0`.
- `BACKUP_TARGET=file://` is accepted only so the test can run without AWS; the script refuses `file://` when `NODE_ENV=production` is set in the environment.
- `restore-check.sh latest` on S3 uses `aws s3 ls` sorted by key and picks the last `*.dump`.
- Apply the lifecycle rule once: `aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration file://deploy/s3-lifecycle.json`. Verify: `aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET"` shows `Days: 14`.
- Install the six systemd units to `/etc/systemd/system/`, then `systemctl daemon-reload && systemctl enable --now food-os-backup.timer food-os-restore-check.timer food-os-caddy-backup.timer`.

- [ ] **Step 4: Verify**

Run: `bash scripts/tests/backup-role.test.sh && bash scripts/tests/backup-restore.test.sh`
Expected: `backup-role OK`, then `backup-restore OK`. The role test is the check that `food_backup` can `SELECT count(*) FROM restaurant_nodes` and cannot `INSERT` into it.
Run on the instance: `systemctl start food-os-backup.service && systemctl list-timers food-os-*`
Expected: backup service exits 0; both timers listed with a next-run time; one `.dump` and one `.counts.json` present under `pg/` in S3.

- [ ] **Step 5: Commit**

```bash
git add scripts/backup-pg.sh scripts/restore-check.sh scripts/tests/backup-restore.test.sh deploy/s3-lifecycle.json deploy/systemd
git commit -m "feat: add nightly pg_dump to S3, 14-day lifecycle, and monthly restore check

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 7: GitHub Actions Pipeline and Remote Deploy with Rollback

**Files:**
- Create: `.github/workflows/deploy.yml`, `deploy/deploy.sh` (installed to `/home/ubuntu/docker/deploy.sh` on the host)
- Test: `scripts/tests/rollback-drill.sh` (run on the instance)

**Interfaces:**
- Consumes: `docker-compose.yml` and `docker-compose.prod.yml` on the host at `/home/ubuntu/docker/`; the shared proxy (`proxy_server/`, run from `/home/ubuntu/docker/proxy_server/`, started separately and not by `deploy.sh`) must already be up, and the external `shared` network must exist; `/home/ubuntu/docker/.env` with `IMAGE_TAG`, `GHCR_OWNER`, `DOMAIN`, `POSTGRES_PASSWORD`; GitHub secrets `EC2_HOST`, `EC2_USER` (`deploy`), `EC2_SSH_KEY`, `DOMAIN`; host-side GHCR pull token in `/home/ubuntu/docker/.env` as `GHCR_TOKEN` with `read:packages` (login run by `deploy.sh`).
- Produces:
  - Workflow `deploy.yml`, triggered on push to `main`, with concurrency group `deploy-prod` and `cancel-in-progress: false`. Jobs:
    1. `test`: job `container: node:22-alpine`, so Node runs in a container; `npm ci`, `npm run typecheck`, `npm test` with service containers `postgis/postgis:16-3.4` (env `POSTGRES_PASSWORD=ci`, `POSTGRES_USER=food`, `POSTGRES_DB=food_os`) and `redis:7-alpine`; `DATABASE_URL` and `REDIS_URL` point at them.
    2. `e2e`: needs `test`; creates `shared` with `proxy_server/create-shared-network.sh` if missing; `docker compose up -d --build --wait` with `POSTGRES_PASSWORD=ci`; seeds with `npx tsx scripts/seed.ts` in a `node:22-alpine` container on `--network host`; runs Playwright in the Playwright image attached to `shared` with `E2E_BASE_URL=http://food-os-app:3000` (Gap A: the app publishes no host port, so the job reaches it by container name); uploads the Playwright report on failure.
    3. `build`: needs `test`; `docker/login-action` to `ghcr.io` with `GITHUB_TOKEN`; `docker/build-push-action` with `push: true`, tag `ghcr.io/${{ github.repository_owner }}/food-os:sha-${{ github.sha }}`, and GHA layer cache. Lowercase the owner in a step (GHCR rejects uppercase).
    4. `deploy`: needs `build`; `environment: production`; writes `EC2_SSH_KEY` to a `0600` file; runs `ssh -o StrictHostKeyChecking=yes "$EC2_USER@$EC2_HOST" "/home/ubuntu/docker/deploy.sh sha-$GITHUB_SHA"`; then `curl -fsS --retry 5 --retry-delay 5 https://$DOMAIN/api/health | grep -q '"ok":true'`.
  - `deploy/deploy.sh <sha-tag>`: pulls and starts `app` with the new tag, waits for the in-container health check, and rolls back to the last good tag on failure. Writes `state/current_tag` on success and `state/previous_tag` for manual rollback. Exit `0` on success, `1` after a failed deploy (rollback attempted), `2` on bad usage.

Deploy script core logic (fixed):

```bash
#!/usr/bin/env bash
set -euo pipefail
NEW="${1:?usage: deploy.sh sha-<40-hex>}"
case "$NEW" in sha-*) ;; *) echo "tag must be sha-<commit>" >&2; exit 2;; esac
DIR=/home/ubuntu/docker; STATE="$DIR/state"; mkdir -p "$STATE"
COMPOSE=(docker compose -f "$DIR/docker-compose.yml" -f "$DIR/docker-compose.prod.yml" --env-file "$DIR/.env")
CURRENT=$(cat "$STATE/current_tag" 2>/dev/null || true)

set_tag() { sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" "$DIR/.env"; }
healthy() {
  for _ in $(seq 1 24); do
    if "${COMPOSE[@]}" exec -T app wget -qO- http://localhost:3000/api/health 2>/dev/null | grep -q '"ok":true'; then return 0; fi
    sleep 5
  done
  return 1
}
deploy_tag() {
  set_tag "$1"
  "${COMPOSE[@]}" pull app && "${COMPOSE[@]}" up -d --no-deps app && healthy
}

if deploy_tag "$NEW"; then
  [ -n "$CURRENT" ] && [ "$CURRENT" != "$NEW" ] && echo "$CURRENT" > "$STATE/previous_tag"
  echo "$NEW" > "$STATE/current_tag"
  echo "deployed $NEW"
  exit 0
fi
echo "deploy of $NEW failed; rolling back" >&2
if [ -n "$CURRENT" ] && deploy_tag "$CURRENT"; then
  echo "rolled back to $CURRENT" >&2
else
  echo "ROLLBACK FAILED; manual action required" >&2
fi
exit 1
```

Before `deploy_tag` the script also runs `echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin` from `.env`.

- [ ] **Step 1: Write the rollback drill first (failing until the script exists)**

```bash
#!/usr/bin/env bash
# scripts/tests/rollback-drill.sh   (run on the instance after the first good deploy)
set -euo pipefail
good=$(cat /home/ubuntu/docker/state/current_tag)
bad=sha-0000000000000000000000000000000000000000   # does not exist in GHCR
if /home/ubuntu/docker/deploy.sh "$bad"; then echo "FAIL: bad tag deployed" >&2; exit 1; fi
grep -q "IMAGE_TAG=$good" /home/ubuntu/docker/.env
[ "$(cat /home/ubuntu/docker/state/current_tag)" = "$good" ]
curl -fsS https://"$DOMAIN"/api/health | grep -q '"ok":true'
echo "rollback drill OK"
```

Run: `bash scripts/tests/rollback-drill.sh`
Expected before implementation: FAIL, "/home/ubuntu/docker/deploy.sh: No such file or directory" (exit 1).

- [ ] **Step 2: Implement**

- Write `deploy/deploy.sh` exactly as in the Produces logic and install it to `/home/ubuntu/docker/deploy.sh` (mode `755`, owner `deploy`).
- Write `.github/workflows/deploy.yml` per the Produces job list. Pin actions to major versions (`actions/checkout@v4`, `actions/setup-node@v4`, `docker/login-action@v3`, `docker/build-push-action@v6`). Use `permissions: contents: read, packages: write` at the workflow level.
- The `deploy` job must not run when `test` or `build` fails (default `needs` behavior).

- [ ] **Step 3: Verify**

Run (after the first deploy via the workflow): `bash scripts/tests/rollback-drill.sh`
Expected: `rollback drill OK`. The bad tag fails at `pull`, `deploy.sh` exits `1`, and the app stays on the previous tag.
Run: a normal push to `main` shows all four jobs green; `curl -fsS https://$DOMAIN/api/health` returns `{"ok":true}`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml deploy/deploy.sh scripts/tests/rollback-drill.sh
git commit -m "feat: add GitHub Actions build-and-deploy with SHA tags and rollback

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 8: External Uptime Check and CloudWatch Logs

**Files:**
- Modify: `docker-compose.prod.yml` (add `logging` to `app`, `db`, `redis`), `proxy_server/docker-compose.yml` (add `logging` to `caddy`)
- Create: `scripts/tests/logging.test.sh`

**Interfaces:**
- Consumes: `IMAGE_TAG` and other env from Task 4; instance profile logs permissions from Task 5.
- Produces:
  - Every service in both compose files (`app`, `db`, `redis` in `docker-compose.prod.yml`; `caddy` in `proxy_server/docker-compose.yml`) has `logging: { driver: awslogs, options: { awslogs-region: ap-south-1, awslogs-group: /food-os/prod, awslogs-stream: <service name>, awslogs-create-group: "true" } }`.
  - CloudWatch log group `/food-os/prod` with retention 30 days (`aws logs put-retention-policy --log-group-name /food-os/prod --retention-in-days 30`).
  - External uptime monitor. Owner creates the account; the plan documents the URL and the check settings: URL `https://<DOMAIN>/api/health`, check interval 5 minutes (free tiers do not offer 1-minute checks), keyword `"ok":true`, alerts to the owner's email and phone.
  - CloudWatch alarm as backup: name `food-os-status-check`, namespace `AWS/EC2`, metric `StatusCheckFailed`, dimension `InstanceId=<INSTANCE_ID>`, statistic `Maximum`, period 300 s, 2 evaluation periods, threshold `0`, `GreaterThanThreshold`, action `<ALERT_SNS_TOPIC_ARN>` (an SNS topic the owner creates).

- [ ] **Step 1: Write the failing test**

```bash
#!/usr/bin/env bash
# scripts/tests/logging.test.sh
set -euo pipefail
export IMAGE_TAG=sha-0000000000000000000000000000000000000000 GHCR_OWNER=example DOMAIN=test.example.com \
  ACME_EMAIL=ops@example.com POSTGRES_PASSWORD=change-me
cfg=$(docker compose -f docker-compose.yml -f docker-compose.prod.yml config --format json)
pcfg=$(docker compose -f proxy_server/docker-compose.yml config --format json)
for svc in app db redis; do
  echo "$cfg" | jq -e --arg s "$svc" \
    '.services[$s].logging.driver == "awslogs"
     and .services[$s].logging.options["awslogs-group"] == "/food-os/prod"
     and .services[$s].logging.options["awslogs-region"] == "ap-south-1"
     and .services[$s].logging.options["awslogs-stream"] == $s' >/dev/null \
    || { echo "FAIL: $svc logging" >&2; exit 1; }
done
echo "$pcfg" | jq -e '.services.caddy.logging.driver == "awslogs"
  and .services.caddy.logging.options["awslogs-group"] == "/food-os/prod"
  and .services.caddy.logging.options["awslogs-stream"] == "caddy"' >/dev/null \
  || { echo "FAIL: caddy logging" >&2; exit 1; }
retention=$(aws logs describe-log-groups --log-group-name-prefix /food-os/prod \
  --query 'logGroups[?logGroupName==`/food-os/prod`].retentionInDays | [0]' --output text)
[ "$retention" = "30" ] || { echo "FAIL: retention is $retention" >&2; exit 1; }
echo "logging OK"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash scripts/tests/logging.test.sh`
Expected: FAIL, "FAIL: app logging".

- [ ] **Step 3: Implement**

- Add the `logging` block to `app`, `db`, and `redis` in `docker-compose.prod.yml`, and to `caddy` in `proxy_server/docker-compose.yml`, as in Produces.
- Run once on the instance: `aws logs put-retention-policy --log-group-name /food-os/prod --retention-in-days 30` (creating the group happens on first container start via `awslogs-create-group`).
- Owner creates the uptime monitor account and sets the settings above. Create the CloudWatch alarm: `aws cloudwatch put-metric-alarm --alarm-name food-os-status-check --namespace AWS/EC2 --metric-name StatusCheckFailed --dimensions Name=InstanceId,Value=<INSTANCE_ID> --statistic Maximum --period 300 --evaluation-periods 2 --threshold 0 --comparison-operator GreaterThanThreshold --alarm-actions <ALERT_SNS_TOPIC_ARN>`. Record the monitor's name in the runbook section of the team's ops notes (not a repository file).

- [ ] **Step 4: Verify**

Run: `bash scripts/tests/logging.test.sh` after `docker compose up -d` on the instance.
Expected: `logging OK`. Then force a failure drill: `docker compose stop app`; the uptime monitor reports DOWN within about 10 minutes (two 5-minute checks) and sends an alert; `docker compose start app` brings it back UP.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.prod.yml proxy_server/docker-compose.yml scripts/tests/logging.test.sh
git commit -m "feat: ship container logs to CloudWatch and document uptime check

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Idempotent Seed Data (Indiranagar and HSR)

**Files:**
- Create: `lib/seed/fixtures.ts`, `lib/seed/run.ts`, `scripts/seed.ts`
- Test: `tests/seed/seed.test.ts`

**Interfaces:**
- Consumes: `getPool()`, `runMigrations()` (Plan 01 Task 4); `menu_items`, `menu_categories`, `dining_tables`, `restaurant_nodes` schema (Plan 01); `issueSignatureToken()` from `lib/dine/signature.ts` and `dining_tables.current_signature_token` (Plan 03).
- Produces:
  - `interface SeedRestaurant { id: string; slug: string; name: string; area: 'Indiranagar' | 'HSR'; lat: number; lng: number; fssai: string; gstin: string; tables: string[] }`
  - `interface SeedItem { code: string; name: string; station: 'Tandoor' | 'Curry' | 'Pantry' | 'Bar' | 'General'; dietary: 'pure_veg' | 'jain' | 'halal' | 'non_veg' | 'vegan' | 'egg'; basePrice: number }`
  - `FIXTURE_RESTAURANTS: SeedRestaurant[]` (four entries, slugs `seed-indiranagar-1`, `seed-indiranagar-2`, `seed-hsr-1`, `seed-hsr-2`; tables `['01','02','03','04']`). Fixed UUIDs: `fixedUuid(n, k)` builds `00000000-0000-4000-8000-<4-digit n><8-digit k>`.
  - `FIXTURE_ITEMS: Record<string, SeedItem>` with at least `paneerTikka` (`IND1-PNR-TIKKA`, Tandoor, jain, 320) and `freshLimeSoda` (`IND1-LIME-SODA`, Bar, pure_veg, 120), `chickenBiryani` and `seekhKebab` present in every restaurant.
  - `DROP = { lat: 12.9420, lng: 77.6430 }` (exported from `lib/seed/fixtures.ts`). Placeholder, labelled `OWNER TO SET a real address`.
  - `tableSignatures(pool: pg.Pool, restaurantId: string): Promise<Record<string, string>>` in `lib/seed/run.ts`: returns table number to `current_signature_token` for that restaurant, for the `?sig=` query used in Task 10.
  - `runSeed(pool: pg.Pool, opts?: { nodeEnv?: string; allowProd?: boolean }): Promise<{ restaurants: number; menuItems: number; tables: number }>`. Throws `Error('refusing to seed production (set ALLOW_SEED_PROD=yes)')` when `nodeEnv === 'production'` and `allowProd` is not true. Idempotent: `INSERT ... ON CONFLICT (id) DO UPDATE` for restaurants and categories, `ON CONFLICT (restaurant_id, pos_item_code) DO UPDATE` for items, `ON CONFLICT (restaurant_id, table_number) DO UPDATE` for tables. Each new table gets a token from `issueSignatureToken()`; on conflict the column is `COALESCE(dining_tables.current_signature_token, EXCLUDED.current_signature_token)`, so re-runs keep each table's QR signature.
  - `scripts/seed.ts`: CLI; calls `runSeed(getPool(), { nodeEnv: process.env.NODE_ENV, allowProd: process.env.ALLOW_SEED_PROD === 'yes' })`, logs counts, exits 0.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/seed/seed.test.ts
import { getPool, runMigrations } from '@/lib/db/client';
import { runSeed } from '@/lib/seed/run';
import { FIXTURE_RESTAURANTS, FIXTURE_ITEMS } from '@/lib/seed/fixtures';
import type pg from 'pg';

const pool = getPool();
beforeAll(async () => { await runMigrations(pool); });
afterAll(async () => { await pool.end(); });

async function counts(p: pg.Pool) {
  const { rows } = await p.query(`
    SELECT
      (SELECT count(*)::int FROM restaurant_nodes WHERE slug LIKE 'seed-%') AS restaurants,
      (SELECT count(*)::int FROM menu_items mi JOIN restaurant_nodes r ON r.id = mi.restaurant_id WHERE r.slug LIKE 'seed-%') AS items,
      (SELECT count(*)::int FROM dining_tables dt JOIN restaurant_nodes r ON r.id = dt.restaurant_id WHERE r.slug LIKE 'seed-%') AS tables`);
  return rows[0];
}

test('running the seed twice leaves the same row counts (idempotent)', async () => {
  await runSeed(pool);
  const first = await counts(pool);
  await runSeed(pool);
  const second = await counts(pool);
  expect(second).toEqual(first);
  expect(first.restaurants).toBe(4);
  expect(first.tables).toBe(4 * 4);
});

test('two restaurants per pilot area, all within 1.0 km of their area centre', () => {
  const centre = { Indiranagar: { lat: 12.9716, lng: 77.6412 }, HSR: { lat: 12.9121, lng: 77.6446 } };
  const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const dLat = (a.lat - b.lat) * 111.2;
    const dLng = (a.lng - b.lng) * 111.2 * Math.cos((a.lat * Math.PI) / 180);
    return Math.hypot(dLat, dLng);
  };
  for (const area of ['Indiranagar', 'HSR'] as const) {
    const rs = FIXTURE_RESTAURANTS.filter((r) => r.area === area);
    expect(rs).toHaveLength(2);
    for (const r of rs) expect(km(r, centre[area])).toBeLessThan(1.0);
  }
});

test('every restaurant has the items the E2E specs need, with valid stations and positive prices', () => {
  for (const r of FIXTURE_RESTAURANTS) {
    expect(r.tables.slice(0, 2)).toEqual(['01', '02']);
  }
  for (const item of Object.values(FIXTURE_ITEMS)) {
    expect(item.basePrice).toBeGreaterThan(0);
    expect(['Tandoor', 'Curry', 'Pantry', 'Bar', 'General']).toContain(item.station);
  }
  expect(FIXTURE_ITEMS.paneerTikka.code).toBe('IND1-PNR-TIKKA');
  expect(FIXTURE_ITEMS.freshLimeSoda.code).toBe('IND1-LIME-SODA');
});

test('refuses to seed when NODE_ENV is production', async () => {
  await expect(runSeed(pool, { nodeEnv: 'production' })).rejects.toThrow(/refusing to seed production/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker run --rm --network host --user 1000:1000 -e HOME=/tmp -e DATABASE_URL=postgres://food:change-me@localhost:5432/food_os -v /home/ubuntu/docker:/app -w /app node:22-alpine npx vitest run tests/seed/seed.test.ts`
Expected: FAIL, "Cannot find module '@/lib/seed/run'".

- [ ] **Step 3: Implement**

- `fixtures.ts`: the restaurant table above with coordinates Indiranagar-1 `(12.9716, 77.6412)`, Indiranagar-2 `(12.9760, 77.6360)`, HSR-1 `(12.9121, 77.6446)`, HSR-2 `(12.9150, 77.6390)`. Each restaurant has categories with fixed ids (`fixedUuid(n, k)`) for `Tandoor & Breads` (Tandoor), `Curries` (Curry), `Salads` (Pantry), `Drinks` (Bar). FSSAI numbers `10000000000001` to `10000000000004`; GSTIN `29AAAAA0000A1Z5`-style fictional values, 15 characters.
- `run.ts`: one transaction per run as `food_admin` (`pool.connect()`, `BEGIN` … `COMMIT`; decision 2: never `food_app` or `food_sync`). `food_admin` bypasses RLS, which is intended for seeding; do not use `asRole`.
- Each item has `pos_item_code` from `FIXTURE_ITEMS` and `category_id` mapped by station.
- Seed areas are Indiranagar and HSR only. Koramangala is not seeded in v1.

- [ ] **Step 4: Verify**

Run: `docker run --rm --network host --user 1000:1000 -e HOME=/tmp -e DATABASE_URL=postgres://food:change-me@localhost:5432/food_os -v /home/ubuntu/docker:/app -w /app node:22-alpine npx tsx scripts/seed.ts && docker run --rm --network host --user 1000:1000 -e HOME=/tmp -e DATABASE_URL=postgres://food:change-me@localhost:5432/food_os -v /home/ubuntu/docker:/app -w /app node:22-alpine npx vitest run tests/seed/seed.test.ts`
Expected: seed prints `restaurants=4 menuItems=<n> tables=16`; 4 tests pass; a second seed run prints the same counts.

- [ ] **Step 5: Commit**

```bash
git add lib/seed scripts/seed.ts tests/seed
git commit -m "feat: add idempotent seed for Indiranagar and HSR test restaurants

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Playwright End-to-End Suite

**Files:**
- Create: `playwright.config.ts`, `e2e/dine-in-isolation.spec.ts`, `e2e/delivery-auction.spec.ts`
- Modify: `package.json` (add `@playwright/test` as a dev dependency and an `e2e` script)

**Interfaces:**
- Consumes:
  - Seed fixtures and table signatures (Task 9): `FIXTURE_RESTAURANTS`, `FIXTURE_ITEMS`, `DROP`, `tableSignatures`.
  - Plan 03 dine-in route `/dine/[restaurantId]/[tableNumber]?sig=<signature>` exists (Plan 03 `TableSessionGate`, `sig` query parameter). The test ids `add-item-<pos_item_code>` and `kds-ticket` are NOT defined in Plan 03; they are required from Task 11.
  - Plan 02 delivery route `/delivery` and `POST /api/delivery/intent` exist (Plan 02). The `?lat=&lng=` override, the `Voice search` label, the `Find food` button, and the `bundle-card` attributes are NOT defined in Plan 02; they are required from Task 11.
- Produces:
  - `playwright.config.ts`: `testDir: 'e2e'`; `baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000'`; project `chromium` using the `Pixel 7` device profile (mobile-first); `trace: 'retain-on-failure'`; `workers` default; `reporter: [['list'], ['html', { open: 'never' }]]`. The run commands set `E2E_BASE_URL=http://food-os-app:3000` (Gap A decision, Task 7); the `localhost` default is only for a host-run dev server.
  - Spec 1 (dine-in isolation): two browser contexts at two tables of `FIXTURE_RESTAURANTS[0]` order different items at the same moment and each sees only its own ticket.
  - Spec 2 (delivery auction): one voice query returns at least two ranked bundles from at least two different seeded kitchens, each priced at or under `₹800`.

- [ ] **Step 1: Write the failing specs**

```ts
// e2e/dine-in-isolation.spec.ts
import { test, expect } from '@playwright/test';
import { FIXTURE_RESTAURANTS, FIXTURE_ITEMS } from '@/lib/seed/fixtures';
import { getPool } from '@/lib/db/client';
import { tableSignatures } from '@/lib/seed/run';

const r = FIXTURE_RESTAURANTS[0];
let sigs: Record<string, string> = {};
test.beforeAll(async () => { sigs = await tableSignatures(getPool(), r.id); });
test.afterAll(async () => { await getPool().end(); });

test('two tables ordering at the same moment do not see each other tickets', async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await Promise.all([
      a.goto(`/dine/${r.id}/${r.tables[0]}?sig=${sigs[r.tables[0]]}`),
      b.goto(`/dine/${r.id}/${r.tables[1]}?sig=${sigs[r.tables[1]]}`),
    ]);
    await Promise.all([
      a.getByTestId(`add-item-${FIXTURE_ITEMS.paneerTikka.code}`).click(),
      b.getByTestId(`add-item-${FIXTURE_ITEMS.freshLimeSoda.code}`).click(),
    ]);
    await expect(a.getByTestId('kds-ticket')).toHaveCount(1);
    await expect(a.getByTestId('kds-ticket')).toContainText(FIXTURE_ITEMS.paneerTikka.name);
    await expect(b.getByTestId('kds-ticket')).toHaveCount(1);
    await expect(b.getByTestId('kds-ticket')).toContainText(FIXTURE_ITEMS.freshLimeSoda.name);
    await expect(a.getByTestId('kds-ticket').filter({ hasText: FIXTURE_ITEMS.freshLimeSoda.name })).toHaveCount(0);
    await expect(b.getByTestId('kds-ticket').filter({ hasText: FIXTURE_ITEMS.paneerTikka.name })).toHaveCount(0);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
```

```ts
// e2e/delivery-auction.spec.ts
import { test, expect } from '@playwright/test';
import { FIXTURE_RESTAURANTS, DROP } from '@/lib/seed/fixtures';

const seededIds = new Set(FIXTURE_RESTAURANTS.map((r) => r.id));

test('one voice query returns ranked bundles from several seeded kitchens', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`/delivery?lat=${DROP.lat}&lng=${DROP.lng}`);
  await page.getByLabel('Voice search').fill(
    'Dinner for 3: Biryani & Kebab strictly under ₹800, delivered in 30 mins to Indiranagar',
  );
  await page.getByRole('button', { name: 'Find food' }).click();

  const bundles = page.getByTestId('bundle-card');
  await expect.poll(() => bundles.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  const ranks = await bundles.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-rank'))));
  expect(ranks).toEqual(ranks.map((_, i) => i + 1));

  const merchants = await bundles.evaluateAll((els) => els.map((e) => e.getAttribute('data-restaurant-id') ?? ''));
  expect(new Set(merchants).size).toBeGreaterThanOrEqual(2);
  for (const id of merchants) expect(seededIds.has(id)).toBe(true);

  const prices = await bundles.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-price'))));
  for (const p of prices) expect(p).toBeLessThanOrEqual(800);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker compose up -d --wait && docker run --rm --network host --user 1000:1000 -e HOME=/tmp -e DATABASE_URL=postgres://food:change-me@localhost:5432/food_os -v /home/ubuntu/docker:/app -w /app node:22-alpine npx tsx scripts/seed.ts && docker run --rm --network shared --user 1000:1000 -e HOME=/tmp -e E2E_BASE_URL=http://food-os-app:3000 -v /home/ubuntu/docker:/app -w /app mcr.microsoft.com/playwright:<pinned @playwright/test version> npx playwright test`
Expected before Plans 02 and 03 exist: both specs FAIL with a 404 or a timeout on `getByTestId('add-item-IND1-PNR-TIKKA')` or `getByTestId('bundle-card')`. A spec that fails for a missing route or test id is the expected failure.

- [ ] **Step 3: Implement**

- `playwright.config.ts` per Produces.
- Add `@playwright/test` (`docker run --rm --network host --user 1000:1000 -e HOME=/tmp -v /home/ubuntu/docker:/app -w /app node:22-alpine npm i -D @playwright/test`) and `"e2e": "playwright test"` to `package.json` scripts.
- The `tsconfig.json` path alias `@/*` is picked up by Playwright; no extra config.
- Do not add retries in the config; flaky timing belongs in the test, not hidden by retries.
- This task does not add the Plan 02 or Plan 03 test hooks. Task 11 lists them; both specs fail until they exist.

- [ ] **Step 4: Verify**

Run: `docker run --rm --network shared --user 1000:1000 -e HOME=/tmp -e E2E_BASE_URL=http://food-os-app:3000 -v /home/ubuntu/docker:/app -w /app mcr.microsoft.com/playwright:<pinned @playwright/test version> npm run e2e`
Expected: 2 passed, after Plans 02 and 03 are built. Run it three times in a row; all pass each time.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e package.json package-lock.json
git commit -m "test: add Playwright E2E for dine-in isolation and delivery auction

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Required Test Hooks From Plans 02 and 03 (Dependency)

**Files:**
- Owned by Plan 02 (`app/delivery/page.tsx`, `app/delivery/_components/VoiceInput.tsx`, `app/delivery/_components/DeliveryConsole.tsx`) and Plan 03 (`app/dine/[restaurantId]/[tableNumber]/page.tsx`, the menu and ticket components). Not built in this plan.
- Test: Task 10 is the check.

**Interfaces:**
- Consumes: Plan 02 `POST /api/delivery/intent` (`bundles: RankedBundle[]`, with `restaurantId` and `offeredPriceInr`); Plan 03 `/dine/[restaurantId]/[tableNumber]` and `GET /api/dine/stream`.
- Requires, not defined in Plans 02 or 03 as written. Those plans must add them. This plan does not define them itself.
  - Plan 02, `/delivery`:
    - Reads `lat` and `lng` query parameters as the client coordinates, overriding the locality stub in `extractIntentStub`.
    - The transcript input has the accessible label `Voice search`. Plan 02 defines `VoiceInput` as a text box and does not give it this label.
    - The submit control has the accessible name `Find food`. Plan 02 does not define this name.
    - After a `201` response, each entry of `bundles` renders as a `bundle-card` with `data-rank` (1-based, in array order), `data-restaurant-id` (`RankedBundle.restaurantId`), and `data-price` (`RankedBundle.offeredPriceInr`, INR). Plan 02 defines `CounterBidList` for live bids, not these cards.
    - The 18-second countdown text is visible while the bid window is open.
  - Plan 03, dine-in page:
    - Each menu item's add control has test id `add-item-<pos_item_code>`.
    - Each ticket shown in the diner's own view has test id `kds-ticket` and shows the item name as text. Only the tickets of the session in `fos_table_session` are rendered.

**Steps:**

- [ ] **Step 1: Add the hooks in Plans 02 and 03**

  Plan 02 and Plan 03 owners add the hooks above in their own tasks, with the same names and attributes. If either plan renames a component, update this task before implementation.

- [ ] **Step 2: Verify through the E2E suite**

  Run: the Task 10 Step 4 e2e command. Expected: both specs pass. Until the hooks exist, the specs fail on a missing test id, which is the expected result.

No commit in this plan. The hooks are committed under Plans 02 and 03.

---

## Later Step (Not Built in This Plan): Capacitor Wrapper

Capacitor is item (k). It is documented here so the path is clear, and it is not implemented in Plan 07.

- Prerequisite: the PWA is live on `https://<DOMAIN>`, the voice flow works in mobile Chrome and Safari, and the Playwright suite is green on the Pixel 7 profile.
- Shape: a Capacitor project that loads the production URL in a WebView. The web app stays the single source of truth; no business logic moves into the native shell.
- Native-only work to scope when the step starts: microphone permission strings for iOS and Android, background audio behavior for the LiveKit session, and push notifications for order status.
- Store accounts and signing keys are owner decisions. Engineering does not create them.
- Revisit the timing when the PWA has real pilot usage; the tech decisions put this after Plan 07.

---

## Acceptance for Plan 07

- `npm test` (containerised, per Global Constraints) passes all suites, including rate limiter (bucket, Redis store, keys, guard), HTTP (body, security), seed, and the Plan 01 suites.
- `bash scripts/tests/prod-compose.test.sh` prints `prod compose OK`: app, db, and redis publish no host ports; across the stack only `proxy-caddy` publishes, exactly 80 and 443; CPU and memory caps, the bind-mounted Postgres data, and the Redis cap match the budget.
- `bash scripts/verify-host.sh` exits 0 on the instance: publicly listening ports are exactly 22, 80, 443; 2 GiB swap is active; the `food-os-pgdata` volume exists and the root disk has at least 20 GiB free for `backups-scratch`; `deploy` can run Docker.
- `bash scripts/tests/backup-restore.test.sh` prints `backup-restore OK`; the S3 lifecycle rules show 14 days for `pg/` and `caddy/`; all three systemd timers are listed and enabled; `scripts/caddy-data-backup.sh check latest` prints `caddy-data check OK`.
- The `deploy` workflow runs green on `main`, and `curl -fsS https://<DOMAIN>/api/health` returns `{"ok":true}` from the EC2 instance.
- `bash scripts/tests/rollback-drill.sh` prints `rollback drill OK`.
- `bash scripts/tests/logging.test.sh` prints `logging OK`; the external uptime monitor (5-minute check) shows UP and alerts when `app` is stopped in the drill, and the CloudWatch alarm `food-os-status-check` exists.
- The seed script, run twice, leaves identical counts (4 restaurants, 16 tables).
- The Task 10 e2e command passes both specs, three runs in a row.

## Unresolved Gaps (carry to the owner or to other plans)

1. Domain name for `DOMAIN` is still needed. Let's Encrypt certificates (Caddy, with `ACME_EMAIL` for expiry notices) and the health check need it.
2. Owner creates the external uptime monitor account. The plan documents the URL and the check settings: 5-minute interval, since free tiers do not offer 1-minute checks (decision 5).
3. GHCR pull token (`read:packages`) for the host must be created by the owner.
4. Plans 02 and 03 must provide the test hooks listed in Task 11. Neither plan defines them yet.
5. OWNER TO SET a real address. The delivery E2E drop point (`DROP`) is a placeholder midway between the Indiranagar and HSR clusters, so both pilot clusters are in range.
6. OTP and login rate limits are not in this plan; Plan 05 reuses `consumeToken` with its own limits.
7. Cloudflare WAF is deferred per tech decisions. Switching the client-IP source to `CF-Connecting-IP` is a one-line Caddy change when it lands.
8. Migrations must stay expand-only for the rollback path to be safe. Plans 02 to 06 must follow this rule.
9. Nonce-based CSP is deferred; the current policy uses `unsafe-inline` for scripts and styles.
10. Resolved (Gap B): Task 6 archives `proxy-caddy-data` weekly to `caddy/` with a 14-day lifecycle and a restore check (`scripts/caddy-data-backup.sh check`).
11. Resolved (Gap A): Playwright runs in a container on `shared` with `E2E_BASE_URL=http://food-os-app:3000`, in CI and locally (Task 7 and Task 10).
12. Host layout: the shared proxy runs from `/home/ubuntu/docker/proxy_server/` (binding project location). `deploy.sh` does not manage the proxy.
13. Logging conflict: Task 8 switches `app`, `db`, `redis`, and `caddy` to the `awslogs` driver, while Global Constraints and tech decisions require a bounded json-file log (`max-size` 10m, `max-file` 3). Owner or engineering to choose; both stay in the plan until decided. The Caddy `mem_reservation` (64m) and `pids_limit` (128) values are proposed, not from tech decisions; confirm them.
