# Plan 05: Auth, Profile, Ratings, Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build phone-first `+91` sign-in with OTP and a signed session cookie, saved UPI VPAs and GSTIN on the profile page, FSSAI and GSTIN validation, Razorpay and Cashfree webhook signature checks, the purchase-gated rating endpoint and modal, and allergen filtering.

**Architecture:** Pure logic (phone, validators, timing compare, allergen filter, GST) has no I/O. Database access goes through `getPool()` and `asRole()` from Plan 01. Migration `004` is append-only and adds columns, tables, policies, a trigger, and SQL functions (`app_lookup_user_by_phone`, `app_create_user_after_otp`, `app_issue_otp_challenge`, `app_refresh_restaurant_rating`). Route handlers and Server Actions are thin wrappers over service functions that are tested against a real PostGIS database.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Zod, `pg`, `jose` (JWT HS256), Node `crypto`, Vitest, PostgreSQL 16 + PostGIS 3.4 (from Plan 01 Compose).

**Spec:** `/home/ubuntu/original/food_prompt.md` §2 (DDL for `users`, `order_refs` context, `verified_customer_ratings`), §3, §4 Routes 4 and 5. PDF: Route 4 OTP and UPI VPA wireframes, "2-Second Rating Modal" (Wireframe Layout 5), and the "Regulatory Compliance" and "Taxation Engine" paragraphs. Decisions in `2026-11-03-00-roadmap.md` and `2026-11-03-tech-decisions.md` apply here. Plan 01 is the baseline: `getPool`, `asRole`, `users`, `order_refs`, `menu_items`, the rating policy, and `splitGst` are reused exactly.

## Scope

In:
- Phone normalization to `+91` E.164 (Task 2).
- OTP issue and verify: 6 digits, 5-minute expiry, 5 verify attempts per challenge, single use, 3 challenges per phone per hour, MSG91 adapter, dev fixed-code fake (Task 3).
- Session cookie with `role` claim, HS256 JWT, 30-day diner and 12-hour staff expiry (Task 4).
- Route 4: `app/auth/login/page.tsx` and `app/profile/settings/page.tsx` with phone entry, OTP entry, saved VPA list, GSTIN (Tasks 5 and 7).
- GSTIN (15-character standard pattern), FSSAI (14 digits), VPA (`name@bank`) validators; GST invoice breakdown reusing Plan 01 `splitGst` (Task 6).
- Razorpay and Cashfree webhook signature verification on the raw body, constant-time compare, replay rejection (Task 8).
- `POST /api/ratings`: 1 to 5 stars, the four named tags, completed order owned by the session user, 2-second window after settlement enforced in the database insert policy (Task 1) and in app code (Task 9).
- `rating_aggregate` and `total_verified_reviews` recalculated in the same transaction as each verified insert (Task 1).
- Route 5 rating modal with star selector and tag chips (Task 10).
- Allergen tags on `menu_items` and a filter helper (Task 11).

Migration `004` adds: `order_refs.settled_at` with its CHECK (this migration is the only place `settled_at` is added), `menu_items.allergen_tags`, `user_vpas`, `otp_challenges`, `webhook_events`, `app_lookup_user_by_phone()`, `app_create_user_after_otp()`, `app_issue_otp_challenge()`, the replaced `ratings_insert_verified` policy with the 2-second rule, and the `trg_refresh_restaurant_rating` trigger. Each is needed by a task below.

Out (roadmap or later plans):
- Supabase (not used, per tech decisions).
- Writing `order_refs` rows with `status = 'completed'` and `settled_at` in production code. Plan 03 writes these rows at session close, after migration `004` is applied. Plan 06 settles them from the verified payment webhook. Tests here insert them directly.
- Payment-state changes driven by webhooks. Plan 06 consumes the verified event; this plan only verifies and records it.
- HTTP token-bucket rate limiting middleware (Plan 07). The per-phone OTP limit (3 challenges per hour) is in this plan.
- Where a diner's declared allergens are persisted. This plan's filter takes them as an argument.
- WhatsApp OTP channel. The md mentions it; tech decisions specify MSG91 SMS.

Open items (do not block this plan, must be resolved before pilot, see Acceptance):
- The 2-second rating window is the spec's number. It is very tight for a human. The owner should confirm it.
- MSG91 and Cashfree exact endpoints and header names are taken from their public docs as recalled; confirm against current docs during Task 3 and Task 8. Each is marked `VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING` where it is used.
- Cashfree timestamp unit: epoch milliseconds in this plan and in code. Plan 06 said seconds; its text is corrected and the code fix is d411f82. The production value is NOT VERIFIED until a live Cashfree webhook is checked.
- Cashfree event id: this plan uses the signature header value, and Plan 06 uses `data.payment.cf_payment_id`. The signature changes with each timestamp, so it is not a stable replay key. Unresolved; choose one before Task 8.
- Route path: this plan serves `/api/webhooks/razorpay` and `/api/webhooks/cashfree`; Plan 06 names `POST /api/payments/[provider]/webhook`. Unresolved; one path must be chosen and Plan 06 aligned.

## Global Constraints

- Phone identity is `+91` E.164 only, stored in `users.phone_number` (`VARCHAR(15)`).
- Identity inside the database comes from `app_current_user_id()`, set by `asRole()`. Never use `auth.uid()`.
- OTP: 6 digits, expires after 300 seconds, at most 5 attempts, single use. Only an HMAC of the code is stored. The dev fixed code `123456` is allowed only when `OTP_PROVIDER=dev` and `NODE_ENV !== 'production'`.
- Session cookie name `fos_session`; attributes `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. JWT HS256 via `jose`. Claims: `sub` = user id, `role` = `UserRole`. Expiry: `diner` 30 days (2592000 s); every other role 12 hours (43200 s).
- Webhooks: read the body as text first; verify the HMAC over that exact string; only then parse JSON. Compare with `constantTimeEqual`, never `===`.
- Ratings: integer 1 to 5; tags from `RATING_TAGS` only; the 2-second window is measured on the database clock (`NOW()`), not the app clock. The database insert policy (migration `004`) is authoritative; the app check in Task 9 runs first as a fast path.
- Migration `004` is append-only. Never edit `001`, `002`, or `003`.
- Environment variables introduced here: `AUTH_JWT_SECRET` (32+ characters), `OTP_HMAC_KEY` (16+ characters), `OTP_PROVIDER` (`msg91` or `dev`), `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `RAZORPAY_WEBHOOK_SECRET`, `CASHFREE_WEBHOOK_SECRET`. Tests that need them set them in `beforeAll`.
- Tests use real PostGIS via `DATABASE_URL`. No database mocks. External HTTP (MSG91) is tested with an injected `fetch` stub.
- Money uses `round2` and Plan 01 `gstOn` and `splitGst`. No new money math.

## Review Focus

1. A malformed or non-Indian phone number never reaches the OTP provider or the database. Owned by Task 2.
2. An OTP is single use, expires after 300 seconds, locks after 5 wrong attempts, and a phone gets at most 3 challenges per hour; the dev fixed code is refused in production. Owned by Task 3 (rate limit in SQL, migration `004`).
3. A tampered, re-labelled, expired, or unsigned session token never yields a role. Owned by Task 4.
4. A forged or replayed Razorpay or Cashfree webhook is rejected before any event id is recorded. Owned by Task 8.
5. A rating is accepted only for the session user's completed order, submitted within 2 seconds of settlement, and only once per order. Owned by Task 9, with the database rule owned by Task 1.

---

### Task 1: Migration 004 and Database Helpers

**Files:**
- Create: `db/migrations/004_auth_ratings_compliance.sql`, `tests/helpers/db.ts`
- Test: `tests/db/migration-004.test.ts`

**Interfaces:**
- Consumes (Plan 01): `getPool(): pg.Pool`, `runMigrations(pool): Promise<string[]>`, `asRole<T>(pool, userId: string | null, fn): Promise<T>`, SQL function `app_current_user_id()`, role `food_app`, tables `users`, `order_refs`, `menu_items`, `restaurant_nodes`, `verified_customer_ratings`, and its insert policy `ratings_insert_verified`.
- Produces:
  - `order_refs.settled_at TIMESTAMPTZ NULL`; CHECK `order_refs_completed_has_settlement`: `status <> 'completed' OR settled_at IS NOT NULL`. Added only here (decision 6); Plan 03 writes the rows after this migration.
  - Rating window (decision 5): `ratings_insert_verified` is dropped and recreated with the added condition `verified_customer_ratings.created_at <= order_refs.settled_at + INTERVAL '2 seconds'`. `created_at` is never supplied by the app; its column default `NOW()` is the database clock.
  - Rating recalculation: AFTER INSERT trigger `trg_refresh_restaurant_rating` on `verified_customer_ratings` calls SECURITY DEFINER `app_refresh_restaurant_rating()`, which sets `restaurant_nodes.rating_aggregate = ROUND(AVG(rating_score), 2)` and `total_verified_reviews = COUNT(*)` for the row's restaurant, inside the insert's transaction. A rolled-back insert changes nothing.
  - OTP limit: `app_issue_otp_challenge(p_phone TEXT, p_code_hash TEXT) RETURNS UUID`. It takes a per-phone advisory transaction lock, returns NULL when the phone already has 3 challenges created in the last hour, and otherwise inserts with `expires_at = NOW() + 300 seconds` and returns the id.
  - `menu_items.allergen_tags TEXT[] NOT NULL DEFAULT '{}'`; CHECK `menu_items_allergen_tags_valid`: subset of `{peanut, shellfish, dairy, gluten}`.
  - `user_vpas(user_id UUID, vpa VARCHAR(100), created_at, PRIMARY KEY (user_id, vpa))`; CHECK `vpa ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,30}$'`; RLS FORCE; policy `user_vpas_self_manage`.
  - `otp_challenges(id, phone_e164 VARCHAR(13), code_hash TEXT, attempts INT, expires_at, consumed_at, created_at)`.
  - `webhook_events(provider TEXT CHECK in ('razorpay','cashfree'), event_id TEXT, received_at, PRIMARY KEY (provider, event_id))`.
  - `app_lookup_user_by_phone(p_phone TEXT) RETURNS SETOF users`: read-only (STABLE), never creates a user; SECURITY DEFINER, owned by `food_admin`, fixed `search_path`, `EXECUTE` granted to `food_app`.
  - `app_create_user_after_otp(p_phone TEXT) RETURNS users`: the only function that creates a user. Raises `OTP_NOT_VERIFIED` (SQLSTATE `42501`) unless `otp_challenges` has a row for the phone with `consumed_at` within the last 10 minutes. SECURITY DEFINER, owned by `food_admin`, fixed `search_path`, `EXECUTE` granted to `food_app`.
  - Test helpers: `randomPhone(): string`, `makeRestaurant(pool): Promise<string>`, `makeUser(pool, role?: string, restaurantId?: string | null): Promise<string>`.

Assumption: both functions are SECURITY DEFINER and owned by `food_admin` (BYPASSRLS, not superuser), so they can run before any user context exists. The tests `app_lookup_user_by_phone and app_create_user_after_otp are SECURITY DEFINER...` and the `app_lookup_user_by_phone returns no row...` and `app_create_user_after_otp...` tests prove this with no user context set.

- [ ] **Step 1: Write the failing test**

```ts
// tests/helpers/db.ts
import type pg from 'pg';
import { randomUUID, randomInt } from 'node:crypto';

export const randomPhone = () => '+919' + String(randomInt(100_000_000, 999_999_999));

export async function makeRestaurant(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO restaurant_nodes (slug, name, fssai_license_number, gstin, location)
     VALUES ($1, $1, $2, '29ABCDE1234F1Z5', ST_SetSRID(ST_MakePoint(77.64, 12.97), 4326)) RETURNING id`,
    [`r-${randomUUID()}`, String(randomInt(1e13, 1e14))]);
  return rows[0].id;
}

export async function makeUser(pool: pg.Pool, role = 'diner', restaurantId: string | null = null): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (phone_number, role, restaurant_id) VALUES ($1, $2, $3) RETURNING id`,
    [randomPhone(), role, restaurantId]);
  return rows[0].id;
}
```

```ts
// tests/db/migration-004.test.ts
import { getPool, runMigrations, asRole } from '@/lib/db/client';
import { makeRestaurant, makeUser } from '../helpers/db';

const pool = getPool();

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://food:change-me@localhost:5432/food_os';
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

test('order_refs has settled_at and rejects completed orders without it', async () => {
  const col = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'order_refs' AND column_name = 'settled_at'`);
  expect(col.rowCount).toBe(1);
  const rid = await makeRestaurant(pool);
  const did = await makeUser(pool);
  await expect(pool.query(
    `INSERT INTO order_refs (restaurant_id, diner_user_id, status) VALUES ($1, $2, 'completed')`, [rid, did]))
    .rejects.toThrow(/order_refs_completed_has_settlement/);
  await pool.query(
    `INSERT INTO order_refs (restaurant_id, diner_user_id, status, settled_at) VALUES ($1, $2, 'completed', NOW())`, [rid, did]);
});

test('menu_items.allergen_tags defaults to empty and rejects unknown tags', async () => {
  const rid = await makeRestaurant(pool);
  const ok = await pool.query(
    `INSERT INTO menu_items (restaurant_id, pos_item_code, name, base_price, dietary)
     VALUES ($1, 'P-1', 'Paneer', 300, 'pure_veg') RETURNING allergen_tags`, [rid]);
  expect(ok.rows[0].allergen_tags).toEqual([]);
  await expect(pool.query(
    `INSERT INTO menu_items (restaurant_id, pos_item_code, name, base_price, dietary, allergen_tags)
     VALUES ($1, 'P-2', 'Sesame', 100, 'vegan', ARRAY['sesame'])`, [rid])).rejects.toThrow(/menu_items_allergen_tags_valid/);
});

test('user_vpas enforces format and per-user RLS', async () => {
  const a = await makeUser(pool);
  const b = await makeUser(pool);
  await asRole(pool, a, (c) => c.query(`INSERT INTO user_vpas (user_id, vpa) VALUES ($1, 'ravi@okhdfcbank')`, [a]));
  await expect(asRole(pool, a, (c) => c.query(`INSERT INTO user_vpas (user_id, vpa) VALUES ($1, 'not-a-vpa')`, [a])))
    .rejects.toThrow(/user_vpas_format/);
  await expect(asRole(pool, b, (c) => c.query(`INSERT INTO user_vpas (user_id, vpa) VALUES ($1, 'x@okaxis')`, [a])))
    .rejects.toThrow(/row-level security/);
  const seenByB = await asRole(pool, b, async (c) => (await c.query('SELECT count(*)::int AS n FROM user_vpas')).rows[0].n);
  expect(seenByB).toBe(0);
});

test('app_lookup_user_by_phone and app_create_user_after_otp are SECURITY DEFINER, owned by food_admin, with a fixed search_path', async () => {
  const { rows } = await pool.query(`
    SELECT proname, prosecdef, pg_get_userbyid(proowner) AS owner, proconfig
    FROM pg_proc WHERE proname IN ('app_lookup_user_by_phone', 'app_create_user_after_otp')`);
  expect(rows).toHaveLength(2);
  for (const r of rows) {
    expect(r.prosecdef).toBe(true);
    expect(r.owner).toBe('food_admin');
    expect(r.proconfig.join(' ')).toMatch(/search_path=/);
  }
});

test('app_lookup_user_by_phone returns no row and creates no user for an unknown phone', async () => {
  const phone = randomPhone();
  const rows = await asRole(pool, null, async (c) =>
    (await c.query('SELECT id FROM app_lookup_user_by_phone($1)', [phone])).rows);
  expect(rows).toEqual([]);
  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE phone_number = $1', [phone]);
  expect(rowCount).toBe(0);
});

test('app_create_user_after_otp is rejected without a verified challenge and creates no user', async () => {
  const phone = randomPhone();
  // No challenge at all.
  await expect(asRole(pool, null, (c) => c.query('SELECT id FROM app_create_user_after_otp($1)', [phone])))
    .rejects.toThrow(/OTP_NOT_VERIFIED/);
  // Issued but not verified (consumed_at NULL).
  await pool.query(
    `INSERT INTO otp_challenges (phone_e164, code_hash, expires_at) VALUES ($1, 'test-hash', NOW() + INTERVAL '5 minutes')`,
    [phone]);
  await expect(asRole(pool, null, (c) => c.query('SELECT id FROM app_create_user_after_otp($1)', [phone])))
    .rejects.toThrow(/OTP_NOT_VERIFIED/);
  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE phone_number = $1', [phone]);
  expect(rowCount).toBe(0);
});

test('app_create_user_after_otp with a verified challenge creates exactly one user', async () => {
  const phone = randomPhone();
  await pool.query(
    `INSERT INTO otp_challenges (phone_e164, code_hash, expires_at, consumed_at)
     VALUES ($1, 'test-hash', NOW() + INTERVAL '5 minutes', NOW())`,
    [phone]);
  const [first, second] = await asRole(pool, null, async (c) => [
    (await c.query('SELECT id, role FROM app_create_user_after_otp($1)', [phone])).rows[0],
    (await c.query('SELECT id FROM app_create_user_after_otp($1)', [phone])).rows[0],
  ]);
  expect(first.role).toBe('diner');
  expect(second.id).toBe(first.id);
  const { rows } = await pool.query('SELECT id FROM users WHERE phone_number = $1', [phone]);
  expect(rows).toHaveLength(1);
});

test('webhook_events rejects a duplicate (provider, event_id) pair', async () => {
  await pool.query(`INSERT INTO webhook_events (provider, event_id) VALUES ('razorpay', 'evt_dup_test') ON CONFLICT DO NOTHING`);
  const again = await pool.query(
    `INSERT INTO webhook_events (provider, event_id) VALUES ('razorpay', 'evt_dup_test') ON CONFLICT DO NOTHING RETURNING 1`);
  expect(again.rowCount).toBe(0);
});

async function settledOrder(rid: string, diner: string, ago = '0 seconds'): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO order_refs (restaurant_id, diner_user_id, status, settled_at)
     VALUES ($1, $2, 'completed', NOW() - $3::interval) RETURNING id`, [rid, diner, ago]);
  return rows[0].id;
}

const rate = (diner: string, rid: string, orderId: string, score: number) =>
  asRole(pool, diner, (c) => c.query(
    `INSERT INTO verified_customer_ratings (restaurant_id, diner_user_id, order_ref_id, rating_score) VALUES ($1, $2, $3, $4)`,
    [rid, diner, orderId, score]));

const agg = async (rid: string) => (await pool.query(
  `SELECT rating_aggregate::float8 AS r, total_verified_reviews AS n FROM restaurant_nodes WHERE id = $1`, [rid])).rows[0];

test('a rating inserted 3 seconds after settled_at is rejected by RLS (decision 5)', async () => {
  const rid = await makeRestaurant(pool);
  const diner = await makeUser(pool);
  const late = await settledOrder(rid, diner, '3 seconds');
  await expect(rate(diner, rid, late, 5)).rejects.toThrow(/row-level security/);
});

test('a rating inserted 1 second after settled_at is accepted (decision 5)', async () => {
  const rid = await makeRestaurant(pool);
  const diner = await makeUser(pool);
  await expect(rate(diner, rid, await settledOrder(rid, diner, '1 second'), 5)).resolves.toBeDefined();
});

test('rating_aggregate and total_verified_reviews are recomputed in the insert transaction', async () => {
  const rid = await makeRestaurant(pool);
  const d1 = await makeUser(pool);
  const d2 = await makeUser(pool);
  await rate(d1, rid, await settledOrder(rid, d1), 5);
  expect(await agg(rid)).toEqual({ r: 5, n: 1 });
  await rate(d2, rid, await settledOrder(rid, d2), 4);
  expect(await agg(rid)).toEqual({ r: 4.5, n: 2 });
});

test('a rejected rating leaves the aggregate unchanged (same transaction)', async () => {
  const rid = await makeRestaurant(pool);
  const diner = await makeUser(pool);
  await rate(diner, rid, await settledOrder(rid, diner), 5);
  const late = await settledOrder(rid, diner, '3 seconds');
  await expect(rate(diner, rid, late, 1)).rejects.toThrow(/row-level security/);
  expect(await agg(rid)).toEqual({ r: 5, n: 1 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/db/migration-004.test.ts`
Expected: FAIL. The first test fails with `expected 0 to be 1` on the `settled_at` column check. Later tests fail with `relation "user_vpas" does not exist`.

- [ ] **Step 3: Implement the migration**

Create `db/migrations/004_auth_ratings_compliance.sql` with this content (fixed logic):

```sql
-- 004_auth_ratings_compliance.sql (Plan 05). Append-only; never edit 001, 002, or 003.

-- Settlement timestamp for the 2-second rating window (Tasks 1 and 9).
ALTER TABLE order_refs ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
ALTER TABLE order_refs ADD CONSTRAINT order_refs_completed_has_settlement
  CHECK (status <> 'completed' OR settled_at IS NOT NULL);

-- Decision 5: the 2-second window is enforced by the database. Policies OR together, so the
-- Plan 01 policy must be dropped and recreated with the extra condition. created_at has a
-- DEFAULT NOW() and the app never sets it, so it is the database clock.
DROP POLICY IF EXISTS ratings_insert_verified ON verified_customer_ratings;
CREATE POLICY ratings_insert_verified ON verified_customer_ratings FOR INSERT
  WITH CHECK (
    diner_user_id = app_current_user_id()
    AND EXISTS (
      SELECT 1 FROM order_refs o
       WHERE o.id = verified_customer_ratings.order_ref_id
         AND o.status = 'completed'
         AND o.diner_user_id = app_current_user_id()
         AND o.restaurant_id = verified_customer_ratings.restaurant_id
         AND o.settled_at IS NOT NULL
         AND verified_customer_ratings.created_at <= o.settled_at + INTERVAL '2 seconds'
    )
  );

-- Allergen tags (Task 11).
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS allergen_tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE menu_items ADD CONSTRAINT menu_items_allergen_tags_valid
  CHECK (allergen_tags <@ ARRAY['peanut', 'shellfish', 'dairy', 'gluten']::text[]);

-- Saved UPI VPAs (Task 7).
CREATE TABLE IF NOT EXISTS user_vpas (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vpa VARCHAR(100) NOT NULL CONSTRAINT user_vpas_format CHECK (vpa ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,30}$'),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (user_id, vpa)
);
ALTER TABLE user_vpas ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_vpas FORCE ROW LEVEL SECURITY;
CREATE POLICY user_vpas_self_manage ON user_vpas FOR ALL
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

-- OTP challenges (Task 3). Only an HMAC of the code is stored.
CREATE TABLE IF NOT EXISTS otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 VARCHAR(13) NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_phone_created ON otp_challenges(phone_e164, created_at DESC);

-- Webhook event ids for replay rejection (Task 8).
CREATE TABLE IF NOT EXISTS webhook_events (
  provider TEXT NOT NULL CHECK (provider IN ('razorpay', 'cashfree')),
  event_id TEXT NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (provider, event_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON user_vpas, otp_challenges, webhook_events TO food_app;

-- OTP limit: at most 3 challenges per phone per hour (Task 3). The advisory lock serialises
-- concurrent requests for one phone. The 300-second TTL must equal OTP_TTL_SECONDS in Task 3.
CREATE OR REPLACE FUNCTION app_issue_otp_challenge(p_phone TEXT, p_code_hash TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE new_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('otp:' || p_phone));
  IF (SELECT count(*) FROM otp_challenges
        WHERE phone_e164 = p_phone AND created_at > NOW() - INTERVAL '1 hour') >= 3 THEN
    RETURN NULL;
  END IF;
  INSERT INTO otp_challenges (phone_e164, code_hash, expires_at)
  VALUES (p_phone, p_code_hash, NOW() + INTERVAL '300 seconds')
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;
GRANT EXECUTE ON FUNCTION app_issue_otp_challenge(TEXT, TEXT) TO food_app;

-- Rating recalculation in the same transaction as each verified insert (decision: Task 1).
-- SECURITY DEFINER runs as its owner, food_admin (BYPASSRLS), so it can update restaurant_nodes past RLS.
CREATE OR REPLACE FUNCTION app_refresh_restaurant_rating()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE restaurant_nodes r
     SET rating_aggregate = agg.avg_score,
         total_verified_reviews = agg.n
    FROM (SELECT ROUND(AVG(v.rating_score)::numeric, 2) AS avg_score, COUNT(*)::int AS n
            FROM verified_customer_ratings v
           WHERE v.restaurant_id = NEW.restaurant_id) agg
   WHERE r.id = NEW.restaurant_id;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION app_refresh_restaurant_rating() FROM PUBLIC;
CREATE TRIGGER trg_refresh_restaurant_rating
  AFTER INSERT ON verified_customer_ratings
  FOR EACH ROW EXECUTE FUNCTION app_refresh_restaurant_rating();

-- Sign-in lookup: read-only, never creates a user. Returns zero or one row.
-- SECURITY DEFINER, owned by food_admin (BYPASSRLS, not superuser), fixed search_path.
CREATE OR REPLACE FUNCTION app_lookup_user_by_phone(p_phone TEXT)
RETURNS SETOF users LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT * FROM users WHERE phone_number = p_phone;
$$;
REVOKE ALL ON FUNCTION app_lookup_user_by_phone(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_lookup_user_by_phone(TEXT) TO food_app;

-- The only path that creates a user. Called only by the OTP verify route, after verifyOtp succeeds
-- in the same request. Rejects unless this phone has a verified challenge (consumed_at set by
-- verifyOtp) in the last 10 minutes. SECURITY DEFINER, owned by food_admin, fixed search_path.
CREATE OR REPLACE FUNCTION app_create_user_after_otp(p_phone TEXT)
RETURNS users LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r users;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM otp_challenges
    WHERE phone_e164 = p_phone
      AND consumed_at IS NOT NULL
      AND consumed_at > NOW() - INTERVAL '10 minutes'
  ) THEN
    RAISE EXCEPTION 'OTP_NOT_VERIFIED' USING ERRCODE = '42501';
  END IF;
  INSERT INTO users (phone_number) VALUES (p_phone)
  ON CONFLICT (phone_number) DO UPDATE SET updated_at = NOW()
  RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION app_create_user_after_otp(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_create_user_after_otp(TEXT) TO food_app;
```

If the `asRole(pool, null, ...)` test fails because `set_config` rejects NULL, fix Plan 01's `asRole` to pass `''` instead of `null`. Do not special-case it here.

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/db/migration-004.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/004_auth_ratings_compliance.sql tests/helpers/db.ts tests/db/migration-004.test.ts
git commit -m "feat: add migration 004 for settlement time, rating window, OTP limit, allergens, VPAs, webhook ids

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Phone Normalization

**Files:**
- Create: `lib/auth/phone.ts`
- Test: `tests/auth/phone.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `normalizeIndianMobile(input: string): string | null` returns `+91` plus 10 digits, or `null`.

Rules: remove spaces and hyphens; accept an optional `+91`, `91`, or `0` prefix; the remaining 10 digits must start with 6, 7, 8, or 9.

- [ ] **Step 1: Write the failing test**

```ts
// tests/auth/phone.test.ts
import { normalizeIndianMobile } from '@/lib/auth/phone';

test.each([
  ['98765 43210', '+919876543210'],
  ['98765-43210', '+919876543210'],
  ['09876543210', '+919876543210'],
  ['+91 98765 43210', '+919876543210'],
  ['919876543210', '+919876543210'],
  ['9123456789', '+919123456789'],
])('accepts %s', (input, e164) => {
  expect(normalizeIndianMobile(input)).toBe(e164);
});

test.each([
  '5876543210',    // starts with 5
  '987654321',     // 9 digits
  '98765432109',   // 11 digits without a leading 0
  '+1 2025550123', // US number
  '+910987654321', // +91 followed by 0
  '98765abcde',
  '',
])('rejects %j (Review Focus 1)', (input) => {
  expect(normalizeIndianMobile(input)).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/auth/phone.test.ts`
Expected: FAIL, "Cannot find module '@/lib/auth/phone'".

- [ ] **Step 3: Implement**

```ts
// lib/auth/phone.ts
const MOBILE = /^(?:\+?91|0)?([6-9]\d{9})$/;

export function normalizeIndianMobile(input: string): string | null {
  const m = input.replace(/[\s-]/g, '').match(MOBILE);
  return m ? `+91${m[1]}` : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/auth/phone.test.ts`
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/phone.ts tests/auth/phone.test.ts
git commit -m "feat: normalize Indian mobile numbers to +91 E.164

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 3: OTP Issue and Verify, MSG91 Adapter, Dev Fake

**Files:**
- Create: `lib/security/timing.ts`, `lib/auth/otp-providers.ts`, `lib/auth/otp.ts`, `lib/auth/sign-in.ts`
- Test: `tests/auth/otp.test.ts`, `tests/auth/otp-providers.test.ts`

**Interfaces:**
- Consumes: `normalizeIndianMobile` (Task 2); `getPool`, `asRole` (Plan 01); `otp_challenges`, `app_lookup_user_by_phone`, `app_create_user_after_otp` (Task 1); `UserRole` (`types/food-os.ts`, Plan 01).
- Produces:
  - `constantTimeEqual(a: string, b: string): boolean` (`lib/security/timing.ts`). Returns `false` for unequal lengths; otherwise uses `crypto.timingSafeEqual`.
  - `interface OtpProvider { readonly name: 'msg91' | 'dev'; codeFor(): string; send(e164: string, code: string): Promise<void>; }`
  - `class Msg91OtpProvider implements OtpProvider` with `constructor(opts: { authKey: string; templateId: string; fetchImpl?: typeof fetch })`. `codeFor()` returns a random 6-digit string with leading zeros kept. `send()` POSTs JSON to `https://control.msg91.com/api/v5/otp` with header `authkey` and body `{ template_id, mobile: e164 without '+', otp }`. VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING (endpoint URL, `authkey` header name, and body field names). Throws on a non-2xx response.
  - `const DEV_OTP_CODE = '123456'`; `class DevFixedCodeProvider implements OtpProvider` with `codeFor() => DEV_OTP_CODE` and a no-op `send`.
  - `selectOtpProvider(env: NodeJS.ProcessEnv): OtpProvider`. `OTP_PROVIDER=dev` throws if `NODE_ENV === 'production'`. `OTP_PROVIDER=msg91` requires `MSG91_AUTH_KEY` and `MSG91_TEMPLATE_ID`. Unset: `msg91` in production, `dev` otherwise. Any other value throws.
  - `const OTP_TTL_SECONDS = 300`; `const OTP_MAX_ATTEMPTS = 5`.
  - `requestOtp(pool: pg.Pool, provider: OtpProvider, rawPhone: string): Promise<{ ok: true; e164: string } | { ok: false; reason: 'INVALID_PHONE' | 'RATE_LIMITED' }>`. `RATE_LIMITED` means the phone already has 3 challenges in the last hour.
  - `verifyOtp(pool: pg.Pool, rawPhone: string, code: string): Promise<{ ok: true; e164: string } | { ok: false; reason: 'INVALID_PHONE' | 'EXPIRED_OR_LOCKED' | 'WRONG_CODE' }>`
  - `lookupUserByPhone(pool: pg.Pool, e164: string): Promise<{ id: string; role: UserRole } | null>` (`lib/auth/sign-in.ts`). Sign-in read path; never creates a user.
  - `createUserAfterOtp(pool: pg.Pool, e164: string): Promise<{ id: string; role: UserRole }>` (`lib/auth/sign-in.ts`). Calls `app_create_user_after_otp`; the database rejects it without a verified challenge in the last 10 minutes. Called only from `completeLogin` (Task 5).

Expiry and attempts are enforced by the database clock and an atomic `UPDATE`, not by app-side timestamps. The per-phone limit (3 challenges per hour) is enforced by `app_issue_otp_challenge` in migration `004` (Task 1).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/auth/otp.test.ts
import { getPool, runMigrations } from '@/lib/db/client';
import { requestOtp, verifyOtp } from '@/lib/auth/otp';
import { DevFixedCodeProvider, selectOtpProvider } from '@/lib/auth/otp-providers';
import { randomPhone } from '../helpers/db';

const pool = getPool();
const dev = new DevFixedCodeProvider();

beforeAll(async () => {
  process.env.OTP_HMAC_KEY = 'k'.repeat(24);
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

test('issues a challenge that expires in about 5 minutes', async () => {
  const phone = randomPhone();
  expect(await requestOtp(pool, dev, phone)).toEqual({ ok: true, e164: phone });
  const { rows } = await pool.query(
    `SELECT EXTRACT(EPOCH FROM (expires_at - NOW()))::float8 AS ttl FROM otp_challenges WHERE phone_e164 = $1`, [phone]);
  expect(rows[0].ttl).toBeGreaterThan(290);
  expect(rows[0].ttl).toBeLessThanOrEqual(300);
});

test('a phone gets at most 3 challenges per hour; older challenges do not count', async () => {
  const phone = randomPhone();
  for (let i = 0; i < 3; i++) {
    expect(await requestOtp(pool, dev, phone)).toEqual({ ok: true, e164: phone });
  }
  expect(await requestOtp(pool, dev, phone)).toEqual({ ok: false, reason: 'RATE_LIMITED' });
  await pool.query(`UPDATE otp_challenges SET created_at = NOW() - INTERVAL '61 minutes' WHERE phone_e164 = $1`, [phone]);
  expect(await requestOtp(pool, dev, phone)).toEqual({ ok: true, e164: phone });
});

test('correct code signs in; the same code cannot be reused (single use)', async () => {
  const phone = randomPhone();
  await requestOtp(pool, dev, phone);
  expect(await verifyOtp(pool, phone, '123456')).toEqual({ ok: true, e164: phone });
  expect(await verifyOtp(pool, phone, '123456')).toEqual({ ok: false, reason: 'EXPIRED_OR_LOCKED' });
});

test('wrong codes return WRONG_CODE; the 6th attempt is locked (Review Focus 2)', async () => {
  const phone = randomPhone();
  await requestOtp(pool, dev, phone);
  for (let i = 0; i < 5; i++) {
    expect(await verifyOtp(pool, phone, '000000')).toEqual({ ok: false, reason: 'WRONG_CODE' });
  }
  expect(await verifyOtp(pool, phone, '123456')).toEqual({ ok: false, reason: 'EXPIRED_OR_LOCKED' });
});

test('an expired challenge is rejected even with the right code', async () => {
  const phone = randomPhone();
  await requestOtp(pool, dev, phone);
  await pool.query(`UPDATE otp_challenges SET expires_at = NOW() - INTERVAL '1 second' WHERE phone_e164 = $1`, [phone]);
  expect(await verifyOtp(pool, phone, '123456')).toEqual({ ok: false, reason: 'EXPIRED_OR_LOCKED' });
});

test('invalid phone never creates a challenge (Review Focus 1)', async () => {
  expect(await requestOtp(pool, dev, '1234')).toEqual({ ok: false, reason: 'INVALID_PHONE' });
  expect(await verifyOtp(pool, '1234', '123456')).toEqual({ ok: false, reason: 'INVALID_PHONE' });
  const { rowCount } = await pool.query(`SELECT 1 FROM otp_challenges WHERE phone_e164 = '1234'`);
  expect(rowCount).toBe(0);
});

test('dev provider is refused in production (Review Focus 2)', () => {
  expect(() => selectOtpProvider({ OTP_PROVIDER: 'dev', NODE_ENV: 'production' })).toThrow(/not allowed in production/);
  expect(selectOtpProvider({ NODE_ENV: 'test' }).name).toBe('dev');
});
```

```ts
// tests/auth/otp-providers.test.ts
import { Msg91OtpProvider } from '@/lib/auth/otp-providers';

// VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: MSG91 endpoint, authkey header, and body fields.
test('MSG91 adapter sends the code with the authkey header and E.164 digits', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{"type":"success"}', { status: 200 });
  }) as typeof fetch;
  const p = new Msg91OtpProvider({ authKey: 'KEY', templateId: 'TPL', fetchImpl });
  const code = p.codeFor();
  expect(code).toMatch(/^\d{6}$/);
  await p.send('+919876543210', code);
  expect(calls[0].url).toBe('https://control.msg91.com/api/v5/otp');
  expect((calls[0].init.headers as Record<string, string>).authkey).toBe('KEY');
  expect(JSON.parse(String(calls[0].init.body))).toEqual({ template_id: 'TPL', mobile: '919876543210', otp: code });
});

test('MSG91 adapter throws on a non-2xx response', async () => {
  const fetchImpl = (async () => new Response('bad', { status: 401 })) as typeof fetch;
  const p = new Msg91OtpProvider({ authKey: 'x', templateId: 'y', fetchImpl });
  await expect(p.send('+919876543210', '123456')).rejects.toThrow(/401/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/auth`
Expected: FAIL, "Cannot find module '@/lib/auth/otp'".

- [ ] **Step 3: Implement**

`lib/security/timing.ts`: `constantTimeEqual` as described in Interfaces.

`lib/auth/otp-providers.ts`: the two providers and `selectOtpProvider`. `codeFor()` for MSG91 uses `crypto.randomInt(0, 1_000_000)` padded to 6 digits.

`lib/auth/otp.ts`:
- `hashOtp(e164, code)` is HMAC-SHA256 over `${e164}:${code}` keyed by `OTP_HMAC_KEY`, hex encoded. Throw if the key is missing or shorter than 16 characters.
- `requestOtp`: normalize; on failure return `INVALID_PHONE`. Generate `const code = provider.codeFor()` once. Inside `asRole(pool, null, ...)`, run `SELECT app_issue_otp_challenge($1, $2) AS id` with `$2 = hashOtp(e164, code)`. A NULL id returns `{ ok: false, reason: 'RATE_LIMITED' }` and sends nothing. Otherwise send `code` through the provider after the insert commits (the same value that was hashed), and return `{ ok: true, e164 }`. The 300-second expiry and the 3-per-hour limit live in `app_issue_otp_challenge` (migration `004`).
- `verifyOtp`: normalize. Inside `asRole(pool, null, ...)`, run this atomic claim, which counts the attempt before comparing:

```sql
UPDATE otp_challenges SET attempts = attempts + 1
WHERE id = (
  SELECT id FROM otp_challenges
  WHERE phone_e164 = $1 AND consumed_at IS NULL AND expires_at > NOW() AND attempts < 5
  ORDER BY created_at DESC LIMIT 1
)
RETURNING id, code_hash
```

  No row returns `EXPIRED_OR_LOCKED`. Otherwise compare `hashOtp(e164, code)` with `code_hash` using `constantTimeEqual`. On mismatch return `WRONG_CODE`. On match run `UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1 AND consumed_at IS NULL RETURNING id`; no row returns `EXPIRED_OR_LOCKED`. Return `{ ok: true, e164 }`.

  The attempt counter commits even when the code is wrong, because `asRole` commits on return. The comparison happens after the transaction closes.

`lib/auth/sign-in.ts`: `lookupUserByPhone` runs `SELECT id, role FROM app_lookup_user_by_phone($1)` inside `asRole(pool, null, ...)` and maps zero rows to `null`. `createUserAfterOtp` runs `SELECT id, role FROM app_create_user_after_otp($1)` inside `asRole(pool, null, ...)`. Neither function is called from `requestOtp`, `verifyOtp`, or any read-only path.

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/auth`
Expected: 9 passed (7 in `otp.test.ts`, 2 in `otp-providers.test.ts`), 0 failed.

- [ ] **Step 5: Commit**

```bash
git add lib/security/timing.ts lib/auth/otp-providers.ts lib/auth/otp.ts lib/auth/sign-in.ts tests/auth/otp.test.ts tests/auth/otp-providers.test.ts
git commit -m "feat: add OTP issue and verify with attempt lock, MSG91 adapter, dev fake

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Session Cookie with Role Claim

**Files:**
- Create: `lib/auth/session.ts`
- Test: `tests/auth/session.test.ts`
- Dependency: add `jose` (`npm i jose`)

**Interfaces:**
- Consumes: `UserRole` (`types/food-os.ts`).
- Produces:
  - `const SESSION_COOKIE = 'fos_session'`; `const DINER_SESSION_SECONDS = 2592000`; `const STAFF_SESSION_SECONDS = 43200`.
  - `interface SessionClaims { userId: string; role: UserRole }`
  - `issueSession(user: { id: string; role: UserRole }, opts?: { nowSeconds?: number }): Promise<{ token: string; maxAgeSeconds: number }>`
  - `verifySession(token: string | null | undefined, opts?: { nowSeconds?: number }): Promise<SessionClaims | null>`
  - `sessionCookieOptions(maxAgeSeconds: number): { httpOnly: true; secure: true; sameSite: 'lax'; path: '/'; maxAge: number }`
  - `readSessionToken(cookieHeader: string | null): string | null`

`AUTH_JWT_SECRET` must be at least 32 characters; otherwise throw. Verification uses `algorithms: ['HS256']`, rejects a `role` not in the `UserRole` list, and returns `null` on any failure.

- [ ] **Step 1: Write the failing test**

```ts
// tests/auth/session.test.ts
import { randomUUID } from 'node:crypto';
import {
  issueSession, verifySession, readSessionToken, sessionCookieOptions,
  DINER_SESSION_SECONDS,
} from '@/lib/auth/session';

beforeAll(() => { process.env.AUTH_JWT_SECRET = 'a'.repeat(40); });

const uid = randomUUID();
const b64url = (s: string) => Buffer.from(s).toString('base64url');
const payloadOf = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

test('diner tokens last 30 days and carry the role claim', async () => {
  const { token, maxAgeSeconds } = await issueSession({ id: uid, role: 'diner' });
  expect(maxAgeSeconds).toBe(DINER_SESSION_SECONDS);
  expect(await verifySession(token)).toEqual({ userId: uid, role: 'diner' });
  const p = payloadOf(token);
  expect(p.exp - p.iat).toBe(2592000);
});

test('staff tokens last 12 hours', async () => {
  const { token, maxAgeSeconds } = await issueSession({ id: uid, role: 'restaurant_staff' });
  expect(maxAgeSeconds).toBe(43200);
  const p = payloadOf(token);
  expect(p.exp - p.iat).toBe(43200);
  expect((await verifySession(token))?.role).toBe('restaurant_staff');
});

test('a re-labelled role claim fails the signature (Review Focus 3)', async () => {
  const { token } = await issueSession({ id: uid, role: 'diner' });
  const [h, p, s] = token.split('.');
  const forged = b64url(JSON.stringify({ ...payloadOf(token), role: 'platform_admin' }));
  expect(await verifySession(`${h}.${forged}.${s}`)).toBeNull();
});

test('an expired token is rejected (Review Focus 3)', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { token } = await issueSession({ id: uid, role: 'diner' }, { nowSeconds: now - DINER_SESSION_SECONDS - 60 });
  expect(await verifySession(token)).toBeNull();
});

test('an unsigned alg=none token is rejected (Review Focus 3)', async () => {
  const token = `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ sub: uid, role: 'platform_admin' }))}.`;
  expect(await verifySession(token)).toBeNull();
});

test('cookie attributes are HttpOnly, Secure, SameSite=Lax, Path=/', () => {
  expect(sessionCookieOptions(60)).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 });
});

test('reads the session cookie from a Cookie header', () => {
  expect(readSessionToken('a=1; fos_session=x.y.z; b=2')).toBe('x.y.z');
  expect(readSessionToken('a=1')).toBeNull();
  expect(readSessionToken(null)).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/auth/session.test.ts`
Expected: FAIL, "Cannot find module '@/lib/auth/session'".

- [ ] **Step 3: Implement**

Use `SignJWT` with `setProtectedHeader({ alg: 'HS256' })`, `setSubject(id)`, `setIssuedAt(now)`, `setExpirationTime(now + maxAge)`, and the claim `role`. Verify with `jwtVerify(token, key, { algorithms: ['HS256'], currentDate: new Date(nowSeconds * 1000) })`. Default `nowSeconds` to `Math.floor(Date.now() / 1000)`. Validate that `role` is one of the six `UserRole` values. `readSessionToken` splits the header on `;`, trims, and returns the value of `fos_session`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/auth/session.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/session.ts tests/auth/session.test.ts package.json package-lock.json
git commit -m "feat: add HS256 session cookie with role claim and role-based expiry

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Login Service, Server Actions, and Login Page (Route 4)

**Files:**
- Create: `lib/auth/login.ts`, `app/auth/login/actions.ts`, `app/auth/login/page.tsx`, `app/auth/login/LoginForm.tsx`
- Test: `tests/auth/login.test.ts`

**Interfaces:**
- Consumes: `requestOtp`, `verifyOtp` (Task 3); `lookupUserByPhone`, `createUserAfterOtp` (Task 3); `issueSession`, `sessionCookieOptions`, `SESSION_COOKIE` (Task 4); `selectOtpProvider` (Task 3); `normalizeIndianMobile` (Task 2); `getPool` (Plan 01).
- Produces:
  - `type LoginState = { step: 'phone' | 'otp'; phone?: string; error?: string }`
  - `sendOtpForPhone(pool: pg.Pool, provider: OtpProvider, rawPhone: string): Promise<LoginState>`
  - `completeLogin(pool: pg.Pool, rawPhone: string, code: string): Promise<{ ok: true; token: string; maxAgeSeconds: number; userId: string; role: UserRole } | { ok: false; error: string }>`. Order: `verifyOtp`; on success `lookupUserByPhone`; if that returns `null`, call `createUserAfterOtp` in this same request. `verifyOtp` failures return before any user lookup or creation.
  - Server Actions `sendOtpAction(prev: LoginState, formData: FormData): Promise<LoginState>` and `verifyOtpAction(prev: LoginState, formData: FormData): Promise<LoginState>`. On success `verifyOtpAction` sets the cookie with `sessionCookieOptions` and calls `redirect('/')`.
- Error copy: `INVALID_PHONE` shows "Enter a valid 10-digit Indian mobile number."; `WRONG_CODE` shows "That code is not right."; `EXPIRED_OR_LOCKED` shows "This code has expired or too many attempts were made. Request a new code."; `RATE_LIMITED` shows "Too many codes requested for this number. Try again in an hour."

The page is a Server Component. It shows a "Dev code: 123456" hint only when `selectOtpProvider(process.env).name === 'dev'`. `LoginForm.tsx` is a `'use client'` component using `useActionState`, with `inputMode="numeric"` and `autoComplete="one-time-code"` on the code field.

- [ ] **Step 1: Write the failing test**

```ts
// tests/auth/login.test.ts
import { getPool, runMigrations } from '@/lib/db/client';
import { sendOtpForPhone, completeLogin } from '@/lib/auth/login';
import { DevFixedCodeProvider } from '@/lib/auth/otp-providers';
import { verifySession } from '@/lib/auth/session';
import { randomPhone } from '../helpers/db';

const pool = getPool();
const dev = new DevFixedCodeProvider();

beforeAll(async () => {
  process.env.OTP_HMAC_KEY = 'k'.repeat(24);
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

test('invalid phone stays on the phone step with an error', async () => {
  const s = await sendOtpForPhone(pool, dev, '1234');
  expect(s.step).toBe('phone');
  expect(s.error).toContain('valid 10-digit Indian mobile number');
});

test('valid phone moves to the OTP step with the normalized number', async () => {
  // A random number, so repeated runs stay under the 3-per-hour OTP limit.
  const phone = randomPhone();
  const s = await sendOtpForPhone(pool, dev, phone.replace('+91', '+91 '));
  expect(s).toEqual({ step: 'otp', phone });
});

test('correct dev code signs in a new diner with a verifiable session', async () => {
  const phone = randomPhone();
  await sendOtpForPhone(pool, dev, phone);
  const r = await completeLogin(pool, phone, '123456');
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.role).toBe('diner');
  expect(await verifySession(r.token)).toEqual({ userId: r.userId, role: 'diner' });
});

test('wrong code returns the error copy and no token', async () => {
  const phone = randomPhone();
  await sendOtpForPhone(pool, dev, phone);
  expect(await completeLogin(pool, phone, '999999')).toEqual({
    ok: false, error: 'That code is not right.',
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/auth/login.test.ts`
Expected: FAIL, "Cannot find module '@/lib/auth/login'".

- [ ] **Step 3: Implement**

`lib/auth/login.ts` holds the logic and has no `next/*` imports, so the test runs in Node. `actions.ts` is a `'use server'` file with only async exports and imports `cookies` from `next/headers` and `redirect` from `next/navigation`. The page and form follow the description above. Keep the form to two inputs: phone (`name="phone"`) on step one and code (`name="code"`) plus a hidden phone field on step two.

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/auth/login.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/login.ts app/auth/login tests/auth/login.test.ts
git commit -m "feat: add phone-first login page with OTP steps and session cookie

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 6: FSSAI, GSTIN, and VPA Validators; GST Invoice Breakdown

**Files:**
- Create: `lib/compliance/validators.ts`, `lib/compliance/gst.ts`
- Test: `tests/compliance/validators.test.ts`, `tests/compliance/gst.test.ts`

**Interfaces:**
- Consumes (Plan 01): `gstOn(subtotal: number, rate?: number): number`, `splitGst(gst: number): { cgst: number; sgst: number }`, `round2(n: number): number` from `lib/pricing.ts`.
- Produces:
  - `GSTIN_PATTERN: RegExp = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/`
  - `isValidGstin(input: string): boolean` (trims and uppercases first; pattern only, no checksum)
  - `isValidFssai(input: string): boolean` (trims; `/^\d{14}$/`; used by Plan 06 onboarding and Plan 07 seed data)
  - `UPI_VPA_PATTERN: RegExp = /^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,30}$/`; `isValidVpa(input: string): boolean` (trims)
  - `invoiceGstBreakdown(subtotal: number): { subtotal: number; gst: number; cgst: number; sgst: number }`. Uses `gstOn` and `splitGst`; every value is `round2`.

The VPA pattern must match the SQL CHECK in migration `004` (Task 1). A test in this task reads the migration file and asserts the regex text appears in it.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/compliance/validators.test.ts
import { readFileSync } from 'node:fs';
import { isValidGstin, isValidFssai, isValidVpa, UPI_VPA_PATTERN } from '@/lib/compliance/validators';

test('GSTIN follows the standard 15-character pattern', () => {
  expect(isValidGstin('29ABCDE1234F1Z5')).toBe(true);
  expect(isValidGstin(' 29abcde1234f1z5 ')).toBe(true);
  expect(isValidGstin('29ABCDE1234F1Z')).toBe(false);   // 14 characters
  expect(isValidGstin('29ABCDE1234F1X5')).toBe(false);  // position 14 must be Z
  expect(isValidGstin('2AABCDE1234F1Z5')).toBe(false);  // state code not digits
  expect(isValidGstin('29ABCDE12345F1Z5')).toBe(false); // 5 digits in the middle
});

test('FSSAI is exactly 14 digits', () => {
  expect(isValidFssai('11523999000123')).toBe(true);
  expect(isValidFssai('1152399900012')).toBe(false);
  expect(isValidFssai('1152399900012A')).toBe(false);
});

test('VPA is name@bank', () => {
  expect(isValidVpa('ravi.k@okhdfcbank')).toBe(true);
  expect(isValidVpa('98765@paytm')).toBe(true);
  expect(isValidVpa('ravi@')).toBe(false);
  expect(isValidVpa('ravi')).toBe(false);
  expect(isValidVpa('a@1bank')).toBe(false);
});

test('VPA regex matches the SQL CHECK in migration 004', () => {
  const sql = readFileSync('db/migrations/004_auth_ratings_compliance.sql', 'utf8');
  expect(sql).toContain("'^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,30}$'");
  expect(UPI_VPA_PATTERN.source).toBe('^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,30}$');
});
```

```ts
// tests/compliance/gst.test.ts
import { invoiceGstBreakdown } from '@/lib/compliance/gst';

test('invoice breakdown is 5% GST split evenly into CGST and SGST', () => {
  expect(invoiceGstBreakdown(700)).toEqual({ subtotal: 700, gst: 35, cgst: 17.5, sgst: 17.5 });
});

test('odd paise round half-up and CGST plus SGST equals GST', () => {
  const b = invoiceGstBreakdown(333.33);
  expect(round(b.cgst + b.sgst)).toBe(b.gst);
});

function round(n: number) { return Math.round(n * 100) / 100; }
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/compliance`
Expected: FAIL, "Cannot find module '@/lib/compliance/validators'".

- [ ] **Step 3: Implement**

`validators.ts` holds the three patterns and functions. `gst.ts` imports `gstOn` and `splitGst` from `@/lib/pricing` and does not reimplement the split. Keep the GSTIN check to the pattern; checksum validation is not in this plan.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/compliance`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/compliance tests/compliance
git commit -m "feat: add GSTIN, FSSAI, and VPA validators and GST invoice breakdown

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Profile Settings Page (Route 4): Saved VPAs and GSTIN

**Files:**
- Create: `lib/profile/service.ts`, `app/profile/settings/actions.ts`, `app/profile/settings/page.tsx`, `app/profile/settings/SettingsForms.tsx`
- Test: `tests/profile/service.test.ts`

**Interfaces:**
- Consumes: `isValidVpa`, `isValidGstin` (Task 6); `asRole`, `getPool` (Plan 01); `user_vpas` (Task 1); `users.default_vpa`, `users.saved_gstin` (Plan 01 `users`); `verifySession`, `readSessionToken`, `SESSION_COOKIE` (Task 4); `createUserAfterOtp` (Task 3, used by tests).
- Produces (`lib/profile/service.ts`, all run inside `asRole(pool, userId, ...)`):
  - `listVpas(pool, userId): Promise<string[]>`
  - `addVpa(pool, userId, raw): Promise<{ ok: true; vpa: string } | { ok: false; reason: 'INVALID_VPA' | 'DUPLICATE' }>`
  - `removeVpa(pool, userId, raw): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' }>`; also sets `users.default_vpa = NULL` when the removed VPA was the default.
  - `setDefaultVpa(pool, userId, raw): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' }>`; succeeds only if the VPA is in `user_vpas`.
  - `saveGstin(pool, userId, raw: string): Promise<{ ok: true; gstin: string | null } | { ok: false; reason: 'INVALID_GSTIN' }>`; an empty string clears the value to `NULL`.
  - `getProfile(pool, userId): Promise<{ vpas: string[]; defaultVpa: string | null; savedGstin: string | null }>`
- Server Actions in `app/profile/settings/actions.ts`: `addVpaAction`, `removeVpaAction`, `setDefaultVpaAction`, `saveGstinAction`. Each reads the cookie, verifies it, and redirects to `/auth/login` if the session is missing. Then it calls the service with `getPool()`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/profile/service.test.ts
import { getPool, runMigrations } from '@/lib/db/client';
import { createUserAfterOtp } from '@/lib/auth/sign-in';
import { addVpa, removeVpa, setDefaultVpa, listVpas, saveGstin, getProfile } from '@/lib/profile/service';
import { randomPhone } from '../helpers/db';

const pool = getPool();

beforeAll(async () => {
  process.env.OTP_HMAC_KEY = 'k'.repeat(24);
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

// Users are created only through the OTP path, so the helper records a verified challenge first.
const newUser = async () => {
  const phone = randomPhone();
  await pool.query(
    `INSERT INTO otp_challenges (phone_e164, code_hash, expires_at, consumed_at)
     VALUES ($1, 'test-hash', NOW() + INTERVAL '5 minutes', NOW())`, [phone]);
  return (await createUserAfterOtp(pool, phone)).id;
};

test('adds a valid VPA and lists it for its owner only', async () => {
  const a = await newUser();
  const b = await newUser();
  expect(await addVpa(pool, a, 'ravi@okhdfcbank')).toEqual({ ok: true, vpa: 'ravi@okhdfcbank' });
  expect(await listVpas(pool, a)).toEqual(['ravi@okhdfcbank']);
  expect(await listVpas(pool, b)).toEqual([]);
});

test('rejects a malformed or duplicate VPA', async () => {
  const a = await newUser();
  expect(await addVpa(pool, a, 'not-a-vpa')).toEqual({ ok: false, reason: 'INVALID_VPA' });
  await addVpa(pool, a, 'ravi@okaxis');
  expect(await addVpa(pool, a, 'ravi@okaxis')).toEqual({ ok: false, reason: 'DUPLICATE' });
});

test('set default requires a saved VPA; removing the default clears it', async () => {
  const a = await newUser();
  expect(await setDefaultVpa(pool, a, 'x@okaxis')).toEqual({ ok: false, reason: 'NOT_FOUND' });
  await addVpa(pool, a, 'ravi@okaxis');
  expect(await setDefaultVpa(pool, a, 'ravi@okaxis')).toEqual({ ok: true });
  expect((await getProfile(pool, a)).defaultVpa).toBe('ravi@okaxis');
  expect(await removeVpa(pool, a, 'ravi@okaxis')).toEqual({ ok: true });
  expect((await getProfile(pool, a)).defaultVpa).toBeNull();
});

test('GSTIN is validated; empty clears it', async () => {
  const a = await newUser();
  expect(await saveGstin(pool, a, '29ABCDE1234F1Z5')).toEqual({ ok: true, gstin: '29ABCDE1234F1Z5' });
  expect((await getProfile(pool, a)).savedGstin).toBe('29ABCDE1234F1Z5');
  expect(await saveGstin(pool, a, '29ABCDE1234F1X5')).toEqual({ ok: false, reason: 'INVALID_GSTIN' });
  expect(await saveGstin(pool, a, '')).toEqual({ ok: true, gstin: null });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/profile/service.test.ts`
Expected: FAIL, "Cannot find module '@/lib/profile/service'".

- [ ] **Step 3: Implement**

Put all database work in `service.ts` inside `asRole(pool, userId, ...)`. Catch PostgreSQL error `23505` on insert and map it to `DUPLICATE`. Normalize the VPA with `trim()` before validating. The page is a Server Component: it verifies the session (redirect to `/auth/login` if missing), calls `getProfile`, and renders `SettingsForms.tsx`, a `'use client'` component using `useActionState` for each form.

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/profile/service.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/profile app/profile tests/profile
git commit -m "feat: add profile settings with saved UPI VPAs and GSTIN

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Razorpay and Cashfree Webhook Verification and Replay Rejection

**Files:**
- Create: `lib/payments/webhooks.ts`, `app/api/webhooks/razorpay/route.ts`, `app/api/webhooks/cashfree/route.ts`
- Test: `tests/payments/webhooks.test.ts`

**Interfaces:**
- Consumes: `constantTimeEqual` (Task 3); `asRole` is not needed (`webhook_events` is not RLS-protected; access is through `getPool()` and granted to `food_app`, see Task 1); `getPool` (Plan 01).
- Produces:
  - `verifyRazorpaySignature(rawBody: string, signatureHex: string | null, secret: string): boolean`. HMAC-SHA256 hex of `rawBody` with `secret`, compared to the `X-Razorpay-Signature` header.
  - `verifyCashfreeSignature(args: { rawBody: string; timestamp: string | null; signatureB64: string | null; secret: string; nowMs: number; toleranceMs?: number }): boolean`. The signed string is `timestamp + rawBody`; the expected value is base64 HMAC-SHA256. `timestamp` is epoch milliseconds. VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: the timestamp unit (Plan 06 assumes seconds; see Open items), the signed string, and the base64 encoding. Reject if `|nowMs - timestamp| > toleranceMs` (default `300000`).
  - `recordWebhookEvent(pool: pg.Pool, provider: 'razorpay' | 'cashfree', eventId: string): Promise<'NEW' | 'DUPLICATE'>`. `INSERT ... ON CONFLICT DO NOTHING RETURNING 1`.
  - Route `POST /api/webhooks/razorpay`: read `await req.text()`; verify the signature (401 `INVALID_SIGNATURE`); take the event id from header `x-razorpay-event-id` (400 `MISSING_EVENT_ID`); `recordWebhookEvent`; DUPLICATE returns 409 `DUPLICATE_EVENT`; NEW returns 200 `{ ok: true }`. Plan 06 attaches payment-state changes after the NEW branch.
  - Route `POST /api/webhooks/cashfree`: same flow. VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: the `x-webhook-timestamp` and `x-webhook-signature` header names. Verify with those headers. The event id is the signature header value (unresolved; see Open items). The timestamp is checked inside `verifyCashfreeSignature`.
- Ordering rule: verify first, record second. A forged event never writes to `webhook_events`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/payments/webhooks.test.ts
import { createHmac, randomUUID } from 'node:crypto';
import { getPool, runMigrations } from '@/lib/db/client';
import { constantTimeEqual } from '@/lib/security/timing';
import {
  verifyRazorpaySignature, verifyCashfreeSignature, recordWebhookEvent,
} from '@/lib/payments/webhooks';
import { POST as razorpayPost } from '@/app/api/webhooks/razorpay/route';
import { POST as cashfreePost } from '@/app/api/webhooks/cashfree/route';

const pool = getPool();
const RZ = 'rz_secret_test_value';
const CF = 'cf_secret_test_value';
const body = JSON.stringify({ event: 'payment.captured', payload: { amount: 71000 } });

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://food:change-me@localhost:5432/food_os';
  process.env.RAZORPAY_WEBHOOK_SECRET = RZ;
  process.env.CASHFREE_WEBHOOK_SECRET = CF;
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

const rzSig = (b: string, s = RZ) => createHmac('sha256', s).update(b).digest('hex');
const cfSig = (ts: string, b: string, s = CF) => createHmac('sha256', s).update(ts + b).digest('base64');

test('constantTimeEqual compares strings and rejects unequal lengths', () => {
  expect(constantTimeEqual('abc', 'abc')).toBe(true);
  expect(constantTimeEqual('abc', 'abd')).toBe(false);
  expect(constantTimeEqual('abc', 'abcd')).toBe(false);
});

test('Razorpay: valid signature passes; forged, altered, or missing signature fails (Review Focus 4)', () => {
  expect(verifyRazorpaySignature(body, rzSig(body), RZ)).toBe(true);
  expect(verifyRazorpaySignature(body, rzSig(body, 'wrong'), RZ)).toBe(false);
  expect(verifyRazorpaySignature(body.replace('71000', '1'), rzSig(body), RZ)).toBe(false);
  expect(verifyRazorpaySignature(body, null, RZ)).toBe(false);
  expect(verifyRazorpaySignature(body, 'short', RZ)).toBe(false);
});

test('Cashfree: valid signature inside the 5-minute window passes; stale timestamp fails', () => {
  const now = Date.now();
  const ts = String(now);
  expect(verifyCashfreeSignature({ rawBody: body, timestamp: ts, signatureB64: cfSig(ts, body), secret: CF, nowMs: now })).toBe(true);
  const old = String(now - 6 * 60 * 1000);
  expect(verifyCashfreeSignature({ rawBody: body, timestamp: old, signatureB64: cfSig(old, body), secret: CF, nowMs: now })).toBe(false);
  expect(verifyCashfreeSignature({ rawBody: body, timestamp: ts, signatureB64: cfSig(ts, body, 'x'), secret: CF, nowMs: now })).toBe(false);
});

test('recordWebhookEvent: first delivery is NEW, replay is DUPLICATE (Review Focus 4)', async () => {
  const id = `evt_${randomUUID()}`;
  expect(await recordWebhookEvent(pool, 'razorpay', id)).toBe('NEW');
  expect(await recordWebhookEvent(pool, 'razorpay', id)).toBe('DUPLICATE');
});

test('Razorpay route: forged 401, valid 200, replayed 409', async () => {
  const id = `evt_${randomUUID()}`;
  const mk = (sig: string) => new Request('http://localhost:3000/api/webhooks/razorpay', {
    method: 'POST',
    headers: { 'x-razorpay-signature': sig, 'x-razorpay-event-id': id, 'content-type': 'application/json' },
    body,
  });
  expect((await razorpayPost(mk(rzSig(body, 'forged')))).status).toBe(401);
  expect((await razorpayPost(mk(rzSig(body)))).status).toBe(200);
  expect((await razorpayPost(mk(rzSig(body)))).status).toBe(409);
});

// VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: Cashfree header names and timestamp unit.
test('Cashfree route: forged 401, valid 200, replayed 409', async () => {
  const ts = String(Date.now());
  const sig = cfSig(ts, body);
  const mk = (s: string) => new Request('http://localhost:3000/api/webhooks/cashfree', {
    method: 'POST',
    headers: { 'x-webhook-timestamp': ts, 'x-webhook-signature': s, 'content-type': 'application/json' },
    body,
  });
  expect((await cashfreePost(mk(cfSig(ts, body, 'forged')))).status).toBe(401);
  expect((await cashfreePost(mk(sig))).status).toBe(200);
  expect((await cashfreePost(mk(sig))).status).toBe(409);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/payments/webhooks.test.ts`
Expected: FAIL, "Cannot find module '@/lib/payments/webhooks'".

- [ ] **Step 3: Implement**

`verifyRazorpaySignature` returns `false` for a null signature or a signature that is not 64 hex characters. `verifyCashfreeSignature` returns `false` for a non-numeric timestamp, a null signature, or a stale timestamp, and checks the HMAC last. Both throw if the secret is empty. Route handlers read `req.text()` before any JSON parse. Return bodies are JSON with a stable `error` code. Do not log the raw body or the secret.

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/payments/webhooks.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/payments app/api/webhooks tests/payments
git commit -m "feat: verify Razorpay and Cashfree webhook signatures and reject replays

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Verified Rating Endpoint `POST /api/ratings`

**Files:**
- Create: `lib/ratings/schema.ts`, `lib/ratings/submit.ts`, `app/api/ratings/route.ts`
- Test: `tests/ratings/submit.test.ts`

**Interfaces:**
- Consumes: `asRole`, `getPool` (Plan 01); `order_refs.settled_at` and the 2-second insert policy `ratings_insert_verified` (both from migration `004`, Task 1); `verifySession`, `readSessionToken` (Task 4); `makeRestaurant`, `makeUser` (`tests/helpers/db.ts`).
- Produces:
  - `RATING_TAGS = ['Authentic Taste', 'Fast Prep', 'Piping Hot', 'True Jain Spec'] as const`; `type RatingTag`.
  - `SubmitRatingSchema` (Zod): `{ order_ref_id: z.string().uuid(), rating_score: z.number().int().min(1).max(5), review_tags: z.array(z.enum(RATING_TAGS)).max(4).default([]).refine(unique), feedback_text: z.string().max(500).optional() }`; `type SubmitRatingInput = z.infer<typeof SubmitRatingSchema>`.
  - `const RATING_WINDOW_MS = 2000`.
  - `submitVerifiedRating(pool: pg.Pool, userId: string, input: SubmitRatingInput): Promise<{ ok: true; ratingId: string } | { ok: false; code: 'ORDER_NOT_FOUND' | 'ORDER_NOT_COMPLETED' | 'WINDOW_EXPIRED' | 'ALREADY_RATED' }>`
  - Route `POST /api/ratings`: 401 `UNAUTHENTICATED` without a valid session; 400 `INVALID_BODY` on a Zod failure; `ORDER_NOT_FOUND` maps to 404; `ORDER_NOT_COMPLETED` to 409; `WINDOW_EXPIRED` to 422; `ALREADY_RATED` to 409; success returns 201 `{ ratingId }`.

Ownership: `order_refs` has no RLS in Plan 01, so the query filters on `diner_user_id = $2` explicitly. The migration `004` insert policy then checks completion, restaurant match, and the 2-second rule (Task 1). The database rule is authoritative; the app check above is the fast path.

Window check, inside `asRole(pool, userId, ...)`:

```sql
SELECT o.restaurant_id, o.status,
       (EXTRACT(EPOCH FROM (NOW() - o.settled_at)) * 1000)::float8 AS elapsed_ms
FROM order_refs o
WHERE o.id = $1 AND o.diner_user_id = $2
```

Reject `WINDOW_EXPIRED` when `elapsed_ms < 0` or `elapsed_ms > 2000`. Run the insert after these checks. Wrap the work so that a unique violation (`23505`) becomes `ALREADY_RATED`. To roll back cleanly, throw a typed error inside `asRole` and map it outside.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ratings/submit.test.ts
import { getPool, runMigrations } from '@/lib/db/client';
import { SubmitRatingSchema } from '@/lib/ratings/schema';
import { submitVerifiedRating } from '@/lib/ratings/submit';
import { issueSession } from '@/lib/auth/session';
import { POST } from '@/app/api/ratings/route';
import { makeRestaurant, makeUser } from '../helpers/db';

const pool = getPool();

beforeAll(async () => {
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); });

async function completedOrder(diner: string, settledSqlAgo: string | null, rid?: string) {
  const restaurant = rid ?? await makeRestaurant(pool);
  const { rows } = await pool.query(
    `INSERT INTO order_refs (restaurant_id, diner_user_id, status, settled_at)
     VALUES ($1, $2, 'completed', NOW() - $3::interval) RETURNING id`,
    [restaurant, diner, settledSqlAgo ?? '0 seconds']);
  return { orderId: rows[0].id as string, restaurant };
}

const input = (orderId: string, extra: object = {}) => ({ order_ref_id: orderId, rating_score: 5, review_tags: ['Fast Prep'], ...extra });

test('accepts a rating submitted immediately after settlement', async () => {
  const diner = await makeUser(pool);
  const { orderId } = await completedOrder(diner, null);
  const r = await submitVerifiedRating(pool, diner, input(orderId));
  expect(r.ok).toBe(true);
});

test('rejects a rating submitted 2.5 seconds after settlement (Review Focus 5)', async () => {
  const diner = await makeUser(pool);
  const { orderId } = await completedOrder(diner, '2500 milliseconds');
  expect(await submitVerifiedRating(pool, diner, input(orderId))).toEqual({ ok: false, code: 'WINDOW_EXPIRED' });
  const { rowCount } = await pool.query(`SELECT 1 FROM verified_customer_ratings WHERE order_ref_id = $1`, [orderId]);
  expect(rowCount).toBe(0);
});

test('rejects a rating with no completed order (Review Focus 5)', async () => {
  const diner = await makeUser(pool);
  const rid = await makeRestaurant(pool);
  const { rows } = await pool.query(
    `INSERT INTO order_refs (restaurant_id, diner_user_id, status) VALUES ($1, $2, 'open') RETURNING id`, [rid, diner]);
  expect(await submitVerifiedRating(pool, diner, input(rows[0].id))).toEqual({ ok: false, code: 'ORDER_NOT_COMPLETED' });
});

test('another diner cannot rate an order they do not own (Review Focus 5)', async () => {
  const owner = await makeUser(pool);
  const intruder = await makeUser(pool);
  const { orderId } = await completedOrder(owner, null);
  expect(await submitVerifiedRating(pool, intruder, input(orderId))).toEqual({ ok: false, code: 'ORDER_NOT_FOUND' });
});

test('one rating per order', async () => {
  const diner = await makeUser(pool);
  const { orderId } = await completedOrder(diner, null);
  expect((await submitVerifiedRating(pool, diner, input(orderId))).ok).toBe(true);
  expect(await submitVerifiedRating(pool, diner, input(orderId))).toEqual({ ok: false, code: 'ALREADY_RATED' });
});

test('schema rejects out-of-range stars, fractional stars, and unknown tags', () => {
  const base = { order_ref_id: '00000000-0000-4000-8000-000000000000', rating_score: 3, review_tags: [] };
  expect(SubmitRatingSchema.safeParse({ ...base, rating_score: 0 }).success).toBe(false);
  expect(SubmitRatingSchema.safeParse({ ...base, rating_score: 6 }).success).toBe(false);
  expect(SubmitRatingSchema.safeParse({ ...base, rating_score: 3.5 }).success).toBe(false);
  expect(SubmitRatingSchema.safeParse({ ...base, review_tags: ['Great Vibes'] }).success).toBe(false);
  expect(SubmitRatingSchema.safeParse({ ...base, review_tags: ['Fast Prep', 'Fast Prep'] }).success).toBe(false);
});

test('route returns 401 without a session', async () => {
  const res = await POST(new Request('http://localhost:3000/api/ratings', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }));
  expect(res.status).toBe(401);
});

test('route returns 422 for the window rule and 201 inside it', async () => {
  const diner = await makeUser(pool, 'diner');
  const token = (await issueSession({ id: diner, role: 'diner' })).token;
  const late = await completedOrder(diner, '3 seconds');
  const ok = await completedOrder(diner, null);
  const call = (orderId: string) => POST(new Request('http://localhost:3000/api/ratings', {
    method: 'POST',
    headers: { cookie: `fos_session=${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(input(orderId)),
  }));
  expect((await call(late.orderId)).status).toBe(422);
  expect((await call(ok.orderId)).status).toBe(201);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/ratings/submit.test.ts`
Expected: FAIL, "Cannot find module '@/lib/ratings/schema'".

- [ ] **Step 3: Implement**

`schema.ts` exports `RATING_TAGS` and `SubmitRatingSchema`. `submit.ts` runs the SQL above and the insert inside `asRole`, mapping errors as described. If the insert raises SQLSTATE `42501`, the database rule rejected it; map it to `WINDOW_EXPIRED` and do not retry, because the app check should have caught it first. The route handler reads the session from `req.headers.get('cookie')`, parses the JSON body, validates with Zod, calls `submitVerifiedRating(getPool(), claims.userId, input)`, and maps the result to status codes.

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/ratings/submit.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/ratings/schema.ts lib/ratings/submit.ts app/api/ratings tests/ratings/submit.test.ts
git commit -m "feat: add purchase-gated rating endpoint with 2-second settlement window

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Route 5 Rating Modal

**Files:**
- Create: `components/ratings/rating-state.ts`, `components/ratings/RatingModal.tsx`
- Modify: `vitest.config.ts` (include `tests/**/*.test.{ts,tsx}`; set `esbuild: { jsx: 'automatic' }`)
- Test: `tests/ratings/rating-modal.test.tsx`

**Interfaces:**
- Consumes: `RATING_TAGS`, `RatingTag` (Task 9).
- Produces:
  - `canSubmitRating(score: number | null, tags: readonly string[]): boolean`. True only for an integer score from 1 to 5 and tags that are all in `RATING_TAGS`.
  - `toggleTag(tags: readonly RatingTag[], tag: RatingTag): RatingTag[]`
  - `RatingModal(props: { orderRefId: string; restaurantName: string; onSubmitted: () => void; onClose: () => void }): JSX.Element`. Title "Rate your experience (verified order)". Note "Only diners with verified, completed payments can submit ratings." Five `role="radio"` star buttons labelled "1 star" to "5 stars" with `aria-checked`. Four chip buttons with `aria-pressed`. Submit posts JSON to `/api/ratings`. On an error response it shows the message for the returned `error` code.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/ratings/rating-modal.test.tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { canSubmitRating, toggleTag } from '@/components/ratings/rating-state';
import { RatingModal } from '@/components/ratings/RatingModal';

test('canSubmitRating needs a whole score from 1 to 5 and known tags only', () => {
  expect(canSubmitRating(null, [])).toBe(false);
  expect(canSubmitRating(0, [])).toBe(false);
  expect(canSubmitRating(6, [])).toBe(false);
  expect(canSubmitRating(3.5, [])).toBe(false);
  expect(canSubmitRating(4, ['Great Vibes'])).toBe(false);
  expect(canSubmitRating(4, ['Fast Prep'])).toBe(true);
});

test('toggleTag adds and removes a tag', () => {
  expect(toggleTag([], 'Piping Hot')).toEqual(['Piping Hot']);
  expect(toggleTag(['Piping Hot'], 'Piping Hot')).toEqual([]);
});

test('modal renders five star radios and the four named chips', () => {
  const html = renderToStaticMarkup(
    <RatingModal orderRefId="00000000-0000-4000-8000-000000000000" restaurantName="Meghna Foods"
      onSubmitted={() => {}} onClose={() => {}} />);
  expect((html.match(/role="radio"/g) ?? []).length).toBe(5);
  expect(html).toContain('aria-label="5 stars"');
  for (const tag of ['Authentic Taste', 'Fast Prep', 'Piping Hot', 'True Jain Spec']) {
    expect(html).toContain(tag);
  }
  expect(html).toContain('verified, completed payments');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ratings/rating-modal.test.tsx`
Expected: FAIL, "Cannot find module '@/components/ratings/rating-state'". (Before the `vitest.config.ts` change, the run also fails with a parse error on JSX.)

- [ ] **Step 3: Implement**

Update `vitest.config.ts`: `include: ['tests/**/*.test.{ts,tsx}']` and `esbuild: { jsx: 'automatic' }`. `rating-state.ts` holds the two pure functions. `RatingModal.tsx` is a `'use client'` component using `useState` for score and tags, a submit state, and `fetch('/api/ratings', ...)`. Use Tailwind classes and Lucide `Star` icons. Keep the modal to these elements; no animation library is needed for this task.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/ratings/rating-modal.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add components/ratings vitest.config.ts tests/ratings/rating-modal.test.tsx
git commit -m "feat: add Route 5 rating modal with star selector and tag chips

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Allergen Tags and Filter Helper

**Files:**
- Create: `lib/menu/allergens.ts`
- Test: `tests/menu/allergens.test.ts`

**Interfaces:**
- Consumes: `AllergenTag` (`types/food-os.ts`, Plan 01); `menu_items.allergen_tags` (Task 1); `makeRestaurant` (`tests/helpers/db.ts`); `getPool`.
- Produces:
  - `ALLERGEN_TAGS: readonly AllergenTag[] = ['peanut', 'shellfish', 'dairy', 'gluten']`
  - `isAllergenSafe(item: { allergenTags: readonly string[] }, declared: readonly AllergenTag[]): boolean`
  - `filterByAllergens<T extends { allergenTags: readonly string[] }>(items: readonly T[], declared: readonly AllergenTag[]): T[]`. Removes any item whose tags intersect `declared`. Keeps item order.

`spice_level` already exists on `menu_items` in Plan 01 (0 to 3). This task does not change it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/menu/allergens.test.ts
import { getPool, runMigrations } from '@/lib/db/client';
import { filterByAllergens, isAllergenSafe, ALLERGEN_TAGS } from '@/lib/menu/allergens';
import { makeRestaurant } from '../helpers/db';

const pool = getPool();

beforeAll(async () => { await runMigrations(pool); });
afterAll(async () => { await pool.end(); });

const menu = [
  { id: 'paneer', allergenTags: ['dairy'] },
  { id: 'dal', allergenTags: [] as string[] },
  { id: 'satay', allergenTags: ['peanut', 'gluten'] },
];

test('excludes items that contain a declared allergen', () => {
  expect(filterByAllergens(menu, ['peanut']).map((i) => i.id)).toEqual(['paneer', 'dal']);
});

test('no declared allergens keeps everything', () => {
  expect(filterByAllergens(menu, [])).toHaveLength(3);
});

test('multiple declared allergens exclude every match', () => {
  expect(filterByAllergens(menu, ['dairy', 'gluten']).map((i) => i.id)).toEqual(['dal']);
});

test('isAllergenSafe agrees with the filter', () => {
  expect(isAllergenSafe(menu[2], ['gluten'])).toBe(false);
  expect(isAllergenSafe(menu[1], ['dairy', 'peanut'])).toBe(true);
});

test('the four allergen tags are exactly those in the spec', () => {
  expect([...ALLERGEN_TAGS]).toEqual(['peanut', 'shellfish', 'dairy', 'gluten']);
});

test('tags read back from menu_items filter correctly (round trip)', async () => {
  const rid = await makeRestaurant(pool);
  await pool.query(
    `INSERT INTO menu_items (restaurant_id, pos_item_code, name, base_price, dietary, allergen_tags)
     VALUES ($1, 'S-1', 'Satay', 240, 'non_veg', ARRAY['peanut','gluten'])`, [rid]);
  const { rows } = await pool.query(
    `SELECT pos_item_code AS "id", allergen_tags AS "allergenTags" FROM menu_items WHERE restaurant_id = $1`, [rid]);
  expect(filterByAllergens(rows, ['peanut'])).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/menu/allergens.test.ts`
Expected: FAIL, "Cannot find module '@/lib/menu/allergens'".

- [ ] **Step 3: Implement**

`filterByAllergens` returns `items.filter((i) => isAllergenSafe(i, declared))`. `isAllergenSafe` returns `!item.allergenTags.some((t) => declared.includes(t as AllergenTag))`.

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/menu/allergens.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/menu/allergens.ts tests/menu/allergens.test.ts
git commit -m "feat: add allergen tag filter for peanut, shellfish, dairy, gluten

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

## Acceptance for Plan 05

- `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npm test` passes every suite: `tests/auth`, `tests/db/migration-004.test.ts`, `tests/compliance`, `tests/payments`, `tests/ratings`, `tests/profile`, `tests/menu`, plus the Plan 01 suites.
- `npm run typecheck` and `npm run build` pass. The build lists `/auth/login`, `/profile/settings`, `/api/ratings`, `/api/webhooks/razorpay`, and `/api/webhooks/cashfree`.
- Migration `004` applies on a fresh database after `001` through `003`. A second `runMigrations` call applies nothing.
- Review Focus checks pass, each as a named test: 1 (Task 2, phone rejects), 2 (Task 3, OTP lock, expiry, 3-per-hour limit, dev refused in production), 3 (Task 4, re-labelled and expired tokens), 4 (Task 8, forged and replayed webhooks), 5 (Task 9 for window, ownership, completed-only; Task 1 for the database 2-second rule).
- Manual smoke test with `OTP_PROVIDER=dev` in `npm run dev`: `/auth/login` accepts `123456`, the response sets `fos_session` as HttpOnly and Secure, and `/profile/settings` lists saved VPAs.
- Open items before pilot (tracked, not blocking this merge):
  1. Owner confirms the 2-second rating window. It is enforced in the database (migration `004`, Task 1) and in `submitVerifiedRating` (Task 9).
  2. MSG91 endpoint, body fields, and template variables are confirmed against current MSG91 docs (VERIFY markers in Task 3).
  3. Cashfree timestamp unit (epoch milliseconds in this plan, code and Plan 06 after d411f82; production still NOT VERIFIED against a live webhook), signature header names, and the event id (this plan: signature header value; Plan 06: `data.payment.cf_payment_id`) are confirmed against current Cashfree docs and aligned with Plan 06 before Task 8 is implemented.
  4. Route path: this plan serves `/api/webhooks/razorpay` and `/api/webhooks/cashfree`; Plan 06 names `POST /api/payments/[provider]/webhook`. One path must be chosen and Plan 06 aligned.
  5. Producers of `order_refs` `completed` status and `settled_at` (Plan 03 writes them at session close, after migration `004`; Plan 06 settles them from the verified payment webhook) are not built yet, so the rating path has no live caller until then.
  6. HTTP token-bucket rate limiting is Plan 07. The per-phone OTP limit (3 per hour) is in this plan.
  7. Storage for a diner's declared allergens is not decided; Plan 04 passes them to the filter.
  8. The tag `True Jain Spec` follows the roadmap; the wireframe shows `Jain Spec`. Confirm the label.
  9. GSTIN checksum is not validated, per the spec's pattern-only requirement.
