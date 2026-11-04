# Plan 02: Delivery Mesh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the delivery mesh: a reverse-auction matching engine over PostGIS, a Redis Pub/Sub bus with an 18-second bid window inside a 90-second auction lifetime, `POST /api/delivery/intent`, an SSE stream for live bids, a 3PL dispatch adapter with a sandbox fake, and the Route 2 delivery page.

**Architecture:** Pure matching and pricing logic (`lib/auction/engine.ts`, `lib/mesh/geohash.ts`) has no I/O. PostGIS access goes through a `KitchenRepository` and an auction repository, both on `lib/db/client.ts` (`asRole`). Redis Pub/Sub (`lib/mesh/bus.ts`) carries geohash-channel intents and per-auction events. The database is the record; Redis holds no auction state beyond the pub/sub fan-out. Live updates reach the browser over Server-Sent Events from a Next.js route handler. Dispatch goes through the `DispatchAdapter` interface defined in Plan 06 Task 12 (`lib/dispatch/types.ts`); this plan defines no dispatch interface of its own and adds only a sandbox implementation.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS v4, Zod, `pg`, `ioredis` (new in this plan), Vitest, PostgreSQL 16 + PostGIS 3.4, Redis 7 Alpine, Docker Compose.

**Spec:** `/home/ubuntu/original/food_prompt.md` §2 (mesh tables and mesh RLS), §4 Route 2, §5 (matching logic); PDF in `/home/ubuntu/original/` (Reverse Dutch Auction, Redis geohash channels, 18-second window). Decisions in `2026-11-03-00-roadmap.md` and `2026-11-03-tech-decisions.md` apply here; they are not re-opened.

## Scope

> **Decision 2026-11-04 (owner, binding).** Two rules in this plan are operational constraints, not labels:
> 1. **Load threshold is inclusive.** A kitchen with `active_kds_load` exactly `0.85` is eligible; only a load greater than `0.85` is excluded. Every "strictly below" or "`>= 0.85`" wording below is superseded: eligible when `load <= 0.85`.
> 2. **Under-30-minutes SLA is enforced.** A kitchen is eligible for a bid only when `prep_time + transit_time + buffer <= max_sla_minutes`. `max_sla_minutes` defaults to `30` when the diner gives none (the delivery SLA range stays an integer 15 to 120 minutes). `buffer` is `3` minutes (engineering default). `prep_time` is the bid's `estimatedPrepMinutes`. `transit_time` is `ceil(distanceM / 1000 / 20 * 60)` minutes (20 km/h, the same basis as the 6 km note in the roadmap). The check runs in `evaluateCounterBids` (Task 3) and is tested there. The UI shows the SLA as the enforced limit, not as a promise the engine does not check.
>
> Engineering chose the transit formula and buffer; the owner set the 30-minute SLA and the inclusive 0.85 threshold. Recorded in `2026-11-03-00-roadmap.md`.

In:
- (a) Matching engine (md §5) using the Plan 01 pricing rules (`quoteBundle`), 6 km radius, load at or below 0.85 (inclusive), and the under-30-minute SLA check (decision note above).
- (b) PostGIS `KitchenRepository` (`ST_MakePoint(lng, lat)`).
- (c) Redis Pub/Sub geohash channels; 18 s bid window inside a 90 s lifetime; counter-bids persisted to `auction_counter_bids`.
- (d) `POST /api/delivery/intent` validating `DeliveryIntentSchema` and returning ranked bundles.
- (e) Route 2 at `app/delivery/page.tsx`: typed-text voice stub, extracted metadata card, live counter-bid list over SSE, 3PL status panel with a mocked rider, handshake token, and 68 °C hot-bag temperature.
- (f) 3PL dispatch: uses Plan 06 Task 12's `DispatchAdapter` (`createTask`, `getTask`, `cancelTask`); this plan adds a sandbox implementation only. Decision 2026-11-04: the logistics cost of each dispatched task is passed through at cost (about INR 50 baseline) and recorded in the business ledger (planned migration `010_business_ledger`); this plan does not write ledger rows and does not change the mesh fee.

Out (other plans): real Shadowfax/Rapido/Dunzo wiring (Plan 06); voice capture and LLM extraction (Plan 04); phone OTP and real sessions (Plan 05); production seed data and E2E tests (Plan 07); Socket.io (not used; SSE per tech decisions). Ratings: this plan does not read or write ratings; the 2-second rating window belongs to Plan 05.

**OWNER TO SET: business values.** Each value below is a placeholder until the owner confirms it. Change it here only; the tasks reference this table.

| # | Value | Placeholder used in this plan | Status |
|---|---|---|---|
| 1 | Ranking weights and order for bundles | Lexical order: offered price ascending, then rating descending, then prep minutes ascending, then distance ascending. The md says "price, rating, and prep speed" with no weights. | OWNER TO SET |
| 2 | Counter-bid discount rule | Sandbox kitchens bid at list price. The sources give no discount rule. Under the Plan 01 floor, a bid below about 98.5% of list fails the floor, so the engine rejects deep discounts. | OWNER TO SET |
| 3 | "₹180 saved" reference price (aggregator comparison) | Omitted in v1. No source provides an aggregator reference price, so the UI omits the savings line. | OWNER TO SET |
| 4 | Locality coordinates (Indiranagar, HSR centroids) | Indiranagar `{ lat: 12.9719, lng: 77.6408 }`; HSR `{ lat: 12.9250, lng: 77.6410 }`. Approximate. | OWNER TO SET |

**Other gaps this plan fills with explicit choices (the sources do not specify them):**
1. Item matching: a requested query matches a menu item whose name contains the query (case-insensitive). Every requested query must match, and the cheapest matching item is used.
2. Ranking: see OWNER TO SET table, row 1.
3. Counter-bid pricing: see OWNER TO SET table, row 2.
4. "₹180 saved" savings line: see OWNER TO SET table, row 3.
5. Geohash precision 5 (cells about 4.9 km square, matching the PDF's `mesh:auction:tdr1v` example). Intents are published to the origin cell and its 8 neighbours. A 6 km circle can extend beyond that 3×3 block, so kitchens outside it are not pushed to. PostGIS remains authoritative for eligibility. Owner or engineering should confirm this or move to precision 4.
6. The md's `matchKitchenNodes(coords, maxBudget, requestedItems)` is adapted to `matchKitchenNodes(repo, intent)` so it can be tested without a database.
7. Authentication does not exist until Plan 05. `resolveDiner` returns a fixed dev diner only when `ALLOW_DEV_DINER=1`; otherwise it returns 401.
8. Auction close is driven lazily by diner requests and SSE ticks. A background sweeper is deferred to Plan 07.
9. Locality centroids (Indiranagar, HSR): see OWNER TO SET table, row 4.
10. Rider name, vehicle, and temperature in the sandbox are fixtures, not real data. The PDF's rider name is not used.

## Global Constraints

- Next.js 15 App Router; Route Handlers for HTTP and SSE; route `params` are `Promise`-typed and must be awaited.
- Tailwind CSS v4 with a neutral palette (no visual direction yet); Lucide React icons; TypeScript `strict: true`.
- PostgreSQL 16 `postgis/postgis:16-3.4`; Redis 7 Alpine.
- `GEOGRAPHY(Point, 4326)`; SQL points `ST_MakePoint(lng, lat)`; app coordinates `{ lat, lng }`.
- Money `NUMERIC(10, 2)`; `round2` half-up; all money through `quoteBundle` or `round2`.
- Constants: mesh fee `0.035`; floor margin default `0.05`; transit radius `6000` m; max load `0.85` (inclusive: eligible when load `<= 0.85`; decision 2026-11-04); SLA buffer `3` min and default `max_sla_minutes` `30` (decision 2026-11-04); bid window `18` s; auction lifetime `90` s; geohash precision `5`.
- Time comparisons use the database clock (`now()`), never the app clock.
- Tests use real PostGIS and Redis (via Compose on `127.0.0.1`). No mocks for the database or Redis. Pure logic may use plain fixture objects.
- Vitest runs with `fileParallelism: false` because test files share one database.
- Environment: `DATABASE_URL`, `REDIS_URL`, `ALLOW_DEV_DINER` (`0` by default), `SANDBOX_BID_DELAY_MS` (max random delay for sandbox bids; `0` in tests), `DISPATCH_MODE` (`sandbox` by default; `live` throws in v1).
- Keys and secrets never logged. The handshake token is shown only to the diner who owns the auction.
- Port `3000`. Commit messages follow the Plan 01 format.

## Review Focus

1. A bid submitted after 18 s is rejected by the repository (`BidWindowClosedError`) and by the RLS insert policy. Owned by Task 1 (policy) and Task 6 (repository).
2. Kitchens at load `> 0.85` never appear as candidates or bundles (load exactly `0.85` is eligible; decision 2026-11-04), checked in SQL and again in the engine. Kitchens failing `prep + transit + buffer <= max_sla_minutes` never win a bid. Owned by Task 3 (engine) and Task 4 (SQL).
3. Every SQL point is `ST_MakePoint(lng, lat)`, verified by a distance assertion. Owned by Task 4.
4. A counter-bid below the kitchen floor, above the diner's budget, or with a zero or negative offer is never ranked. Owned by Task 3.
5. No real 3PL can be reached in v1: this plan constructs only `createSandboxDispatch()`, and `assertSandboxDispatchMode()` throws when `DISPATCH_MODE=live`. Owned by Task 5.

---

### Task 1: Mesh Policies, Test Fixtures, and Redis Client

**Files:**
- Create: `db/migrations/002_mesh_auction.sql`, `tests/helpers/mesh-fixtures.ts`, `tests/db/mesh-rls.test.ts`
- Modify: `package.json` (add `ioredis`), `vitest.config.ts` (add `fileParallelism: false`), `docker-compose.yml` (bind redis to `127.0.0.1:6379`), `.env.example` (add `ALLOW_DEV_DINER=0`)

**Interfaces:**
- Consumes: Plan 01 `getPool`, `runMigrations`, `asRole` from `@/lib/db/client`; `app_current_user_id()` from `001_init.sql`.
- Produces:
  - Fixture helpers in `tests/helpers/mesh-fixtures.ts`:
    - `makeUser(pool: pg.Pool, role: string, restaurantId?: string | null): Promise<string>`
    - `makeRestaurant(pool: pg.Pool, o: { lat: number; lng: number; load?: number; rating?: number; floor?: number }): Promise<string>` (random unique slug and FSSAI number)
    - `makeMenuItem(pool: pg.Pool, restaurantId: string, name: string, price: number, station?: string): Promise<void>`
    - `makeAuction(pool: pg.Pool, dinerId: string, o?: { createdAgoSeconds?: number; intent?: object }): Promise<string>` (`created_at = now() - interval`; `intent` defaults to a valid DeliveryIntent using `budget 800, sla 30`)
  - Migration `002_mesh_auction.sql` (policies below); the only migration this plan creates. No new tables; Plan 01 already granted table privileges.
  - `vitest.config.ts` with `fileParallelism: false`.

- [ ] **Step 1: Install and configure**

Run: `npm i ioredis` (ioredis ships its own types; no `@types` package).
Expected: `npm ls ioredis` shows one version; no peer-dependency errors.

Add `ALLOW_DEV_DINER=0` to `.env.example`.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/db/mesh-rls.test.ts
import { getPool, runMigrations, asRole } from '@/lib/db/client';
import { makeUser, makeRestaurant, makeAuction } from '../helpers/mesh-fixtures';
import type pg from 'pg';

const pool = getPool();
beforeAll(async () => { await runMigrations(pool); });
afterAll(async () => { await pool.end(); });

const bidSql = `INSERT INTO auction_counter_bids
  (auction_id, restaurant_id, offered_price_inr, estimated_prep_minutes, bundle_contents)
  VALUES ($1, $2, 700, 12, '[]')`;

test('a diner cannot open an auction for another diner', async () => {
  const a = await makeUser(pool, 'diner');
  const b = await makeUser(pool, 'diner');
  await expect(asRole(pool, a, (c) => c.query(
    `INSERT INTO mesh_food_auctions (diner_user_id, voice_query_transcript, raw_intent_payload,
       budget_ceiling_inr, max_sla_minutes, delivery_location)
     VALUES ($1, 'x', '{}', 800, 30, ST_SetSRID(ST_MakePoint(77.6, 12.9), 4326))`, [b])))
    .rejects.toThrow(/row-level security/);
});

test('kitchen staff cannot place a bid for another restaurant', async () => {
  const rX = await makeRestaurant(pool, { lat: 12.97, lng: 77.64 });
  const rY = await makeRestaurant(pool, { lat: 12.97, lng: 77.64 });
  const staffX = await makeUser(pool, 'restaurant_staff', rX);
  const diner = await makeUser(pool, 'diner');
  const auction = await makeAuction(pool, diner);
  await expect(asRole(pool, staffX, (c) => c.query(bidSql, [auction, rY])))
    .rejects.toThrow(/row-level security/);
});

test('staff can bid for their own restaurant inside the window', async () => {
  const rX = await makeRestaurant(pool, { lat: 12.97, lng: 77.64 });
  const staffX = await makeUser(pool, 'restaurant_staff', rX);
  const diner = await makeUser(pool, 'diner');
  const auction = await makeAuction(pool, diner, { createdAgoSeconds: 1 });
  await expect(asRole(pool, staffX, (c) => c.query(bidSql, [auction, rX]))).resolves.toBeDefined();
});

test('a bid after 18 seconds is rejected by RLS (Review Focus 1)', async () => {
  const rX = await makeRestaurant(pool, { lat: 12.97, lng: 77.64 });
  const staffX = await makeUser(pool, 'restaurant_staff', rX);
  const diner = await makeUser(pool, 'diner');
  const auction = await makeAuction(pool, diner, { createdAgoSeconds: 18.5 });
  await expect(asRole(pool, staffX, (c) => c.query(bidSql, [auction, rX])))
    .rejects.toThrow(/row-level security/);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/db/mesh-rls.test.ts`
Expected: FAIL, "Cannot find module '../helpers/mesh-fixtures'".

- [ ] **Step 4: Implement**

- `db/migrations/002_mesh_auction.sql` (header comment explains it adds policies only). Fixed logic:

```sql
CREATE POLICY mesh_auctions_diner_insert ON mesh_food_auctions FOR INSERT
  WITH CHECK (diner_user_id = app_current_user_id());
CREATE POLICY mesh_auctions_diner_update ON mesh_food_auctions FOR UPDATE
  USING (diner_user_id = app_current_user_id())
  WITH CHECK (diner_user_id = app_current_user_id());
CREATE POLICY mesh_auctions_staff_open_read ON mesh_food_auctions FOR SELECT
  USING (status = 'open' AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = app_current_user_id()
      AND u.role IN ('restaurant_staff', 'kitchen_lead')));

ALTER TABLE auction_counter_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_counter_bids FORCE ROW LEVEL SECURITY;

CREATE POLICY counter_bids_staff_insert ON auction_counter_bids FOR INSERT
  WITH CHECK (
    restaurant_id = (SELECT u.restaurant_id FROM users u WHERE u.id = app_current_user_id())
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = app_current_user_id()
      AND u.role IN ('restaurant_staff', 'kitchen_lead'))
    AND EXISTS (SELECT 1 FROM mesh_food_auctions a
      WHERE a.id = auction_id AND a.status = 'open'
        AND now() < a.created_at + INTERVAL '18 seconds'));
CREATE POLICY counter_bids_diner_read ON auction_counter_bids FOR SELECT
  USING (EXISTS (SELECT 1 FROM mesh_food_auctions a
    WHERE a.id = auction_id AND a.diner_user_id = app_current_user_id()));
CREATE POLICY counter_bids_staff_read_own ON auction_counter_bids FOR SELECT
  USING (restaurant_id = (SELECT u.restaurant_id FROM users u WHERE u.id = app_current_user_id())
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = app_current_user_id()
      AND u.role IN ('restaurant_staff', 'kitchen_lead')));
```

Policy coverage (Review Focus 1 and the RLS requirements): diners insert and update only their own `mesh_food_auctions` rows; restaurant staff and kitchen leads insert and read `auction_counter_bids` only for their own `restaurant_id`; diners read bids only on their own auctions. Plan 01 enables RLS on `mesh_food_auctions`; this migration enables and forces RLS on `auction_counter_bids`.

- `tests/helpers/mesh-fixtures.ts`: the four helpers above. Use `randomUUID` for slugs, FSSAI numbers as 14-digit strings, and `pos_item_code` values. Insert through the seed/fixture pool, which connects as `food_admin` (BYPASSRLS, not superuser; see Plan 01).
- `vitest.config.ts`: add `fileParallelism: false`.
- `docker-compose.yml`: under `redis`, add `ports: ["127.0.0.1:6379:6379"]`.

- [ ] **Step 5: Run to verify it passes**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/db/mesh-rls.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/002_mesh_auction.sql tests/helpers/mesh-fixtures.ts tests/db/mesh-rls.test.ts package.json package-lock.json vitest.config.ts docker-compose.yml .env.example
git commit -m "feat: add mesh auction RLS policies and test fixtures

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Geohash Cells and Channel Names

**Files:**
- Create: `lib/mesh/geohash.ts`, `tests/mesh/geohash.test.ts`

**Interfaces:**
- Consumes: `LatLng` type from `@/types/food-os` (Plan 01 Task 2).
- Produces:
  - `MESH_GEOHASH_PRECISION = 5`
  - `encodeGeohash(p: LatLng, precision?: number): string`
  - `decodeGeohashCenter(cell: string): LatLng`
  - `geohashNeighbors(cell: string): string[]` (exactly 8 distinct cells, none equal to `cell`)
  - `geohashBlock(cell: string): string[]` (the cell plus its 8 neighbours, 9 distinct cells)
  - `meshChannel(cell: string): string` returns `mesh:auction:<cell>`
  - `auctionEventsChannel(auctionId: string): string` returns `mesh:auction:events:<auctionId>`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/mesh/geohash.test.ts
import { encodeGeohash, decodeGeohashCenter, geohashNeighbors, geohashBlock, meshChannel, auctionEventsChannel } from '@/lib/mesh/geohash';

test('encodes the standard reference point (42.6, -5.6) to ezs42 at precision 5', () => {
  expect(encodeGeohash({ lat: 42.6, lng: -5.6 }, 5)).toBe('ezs42');
});

test('decoded centre of a cell lies within the cell', () => {
  const c = decodeGeohashCenter('ezs42');
  expect(Math.abs(c.lat - 42.6)).toBeLessThan(0.05);
  expect(Math.abs(c.lng - (-5.6))).toBeLessThan(0.05);
});

test('a Bengaluru point encodes to a 5-character base32 cell', () => {
  const cell = encodeGeohash({ lat: 12.9716, lng: 77.6412 });
  expect(cell).toMatch(/^[0-9bcdefghjkmnpqrstuvwxyz]{5}$/);
});

test('neighbours are 8 distinct cells, excluding the origin', () => {
  const n = geohashNeighbors('ezs42');
  expect(n).toHaveLength(8);
  expect(new Set(n).size).toBe(8);
  expect(n).not.toContain('ezs42');
});

test('the 3x3 block contains a point 4 km north of the origin cell centre', () => {
  const origin = decodeGeohashCenter('ezs42');
  const north = { lat: origin.lat + 0.036, lng: origin.lng };
  expect(geohashBlock('ezs42')).toContain(encodeGeohash(north));
});

test('channel names follow the PDF pattern', () => {
  expect(meshChannel('tdr1v')).toBe('mesh:auction:tdr1v');
  expect(auctionEventsChannel('a1')).toBe('mesh:auction:events:a1');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/mesh/geohash.test.ts`
Expected: FAIL, "Cannot find module '@/lib/mesh/geohash'".

- [ ] **Step 3: Implement**

Standard geohash: base32 alphabet `0123456789bcdefghjkmnpqrstuvwxyz`; bisection of longitude then latitude alternately, starting with longitude; five bits per character. Neighbours are computed by decoding the cell's bounding box and encoding offset centres (north, south, east, west and four diagonals), then deduplicating and removing the origin. Keep the functions short; no third-party geohash package.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/mesh/geohash.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/mesh/geohash.ts tests/mesh/geohash.test.ts
git commit -m "feat: add geohash cells, neighbours, and mesh channel names

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pure Matching Engine

**Files:**
- Create: `lib/auction/engine.ts`, `tests/auction/engine.test.ts`

**Interfaces:**
- Consumes: `quoteBundle`, `round2`, `PriceLine` from `@/lib/pricing` (Plan 01 Task 3); `DeliveryIntent`, `LatLng`, `StationCategory` from `@/types/food-os`.
- Produces:
  - `AUCTION_MAX_LOAD = 0.85`, `TRANSIT_RADIUS_M = 6000`, `BID_WINDOW_MS = 18_000`, `AUCTION_LIFETIME_MS = 90_000`
  - `interface MatchedLine { itemId: string; name: string; basePrice: number; quantity: number; station: StationCategory }`
  - `interface KitchenCandidate { restaurantId: string; name: string; distanceM: number; activeKdsLoad: number; ratingAggregate: number; floorMargin: number; lines: MatchedLine[] }`
  - `interface CounterBid { restaurantId: string; offeredPriceInr: number; estimatedPrepMinutes: number; bundleContents: MatchedLine[] }`
  - `interface RankedBundle { restaurantId: string; name: string; distanceM: number; offeredPriceInr: number; meshFee: number; kitchenNet: number; estimatedPrepMinutes: number; ratingAggregate: number; bundleContents: MatchedLine[] }`
  - `interface KitchenSearch { point: LatLng; radiusM: number; maxLoad: number; items: Array<{ query: string; servingTarget: number }>; dietaryProfiles: string[] }`
  - `interface KitchenRepository { findCandidates(search: KitchenSearch): Promise<KitchenCandidate[]> }`
  - `evaluateCounterBids(candidates: KitchenCandidate[], bids: CounterBid[], budgetInr: number, slaMaxMinutes = 30): RankedBundle[]` (the `slaMaxMinutes` argument is added by decision 2026-11-04)
  - `matchKitchenNodes(repo: KitchenRepository, intent: DeliveryIntent): Promise<KitchenCandidate[]>`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/auction/engine.test.ts
import { evaluateCounterBids, matchKitchenNodes, type KitchenCandidate, type CounterBid, type KitchenRepository } from '@/lib/auction/engine';
import type { DeliveryIntent } from '@/types/food-os';

const line = (base: number, qty = 2) => ({ itemId: `i${base}`, name: 'Biryani', basePrice: base, quantity: qty, station: 'Curry' as const });
const cand = (id: string, o: Partial<KitchenCandidate> = {}): KitchenCandidate => ({
  restaurantId: id, name: id, distanceM: 1400, activeKdsLoad: 0.42, ratingAggregate: 4.7, floorMargin: 0.05,
  lines: [line(350, 2)], ...o,
});
const bid = (id: string, offered: number, prep = 12, base = 350): CounterBid => ({
  restaurantId: id, offeredPriceInr: offered, estimatedPrepMinutes: prep, bundleContents: [line(base, 2)],
});

test('ranks passing bids by price ascending and reports the mesh fee split', () => {
  const cands = [cand('K1'), cand('K2', { activeKdsLoad: 0.68, ratingAggregate: 4.6 })];
  const out = evaluateCounterBids(cands, [bid('K2', 749, 15), bid('K1', 710)], 800);
  expect(out.map((b) => b.restaurantId)).toEqual(['K1', 'K2']);
  expect(out[0]).toMatchObject({ offeredPriceInr: 710, meshFee: 24.85, kitchenNet: 685.15 });
});

test('excludes kitchens above load 0.85 and keeps load exactly 0.85 (inclusive, decision 2026-11-04)', () => {
  const over = [cand('BUSY', { activeKdsLoad: 0.86 })];
  expect(evaluateCounterBids(over, [bid('BUSY', 690)], 800)).toEqual([]);
  const exact = [cand('EDGE', { activeKdsLoad: 0.85 })];
  expect(evaluateCounterBids(exact, [bid('EDGE', 690)], 800)).toHaveLength(1);
});

test('excludes a kitchen whose prep + transit + buffer exceeds the 30-minute SLA (decision 2026-11-04)', () => {
  // 6 km transit is 18 min; 12 min prep + 18 + 3 buffer = 33 > 30.
  const far = [cand('FAR', { distanceM: 6000 })];
  expect(evaluateCounterBids(far, [bid('FAR', 690, 12)], 800, 30)).toEqual([]);
  // 1.4 km transit is 5 min; 12 + 5 + 3 = 20 <= 30.
  const near = [cand('NEAR', { distanceM: 1400 })];
  expect(evaluateCounterBids(near, [bid('NEAR', 690, 12)], 800, 30)).toHaveLength(1);
});

test('excludes bids above the budget ceiling', () => {
  expect(evaluateCounterBids([cand('K1')], [bid('K1', 850)], 800)).toEqual([]);
});

test('excludes bids that fail the kitchen floor (Review Focus 4)', () => {
  expect(evaluateCounterBids([cand('G', { lines: [line(1000, 1)] })], [bid('G', 500, 12, 1000)], 800)).toEqual([]);
});

test('a zero or negative offer is dropped, not thrown (Review Focus 4)', () => {
  expect(() => evaluateCounterBids([cand('K1')], [bid('K1', 0)], 800)).not.toThrow();
  expect(evaluateCounterBids([cand('K1')], [bid('K1', 0)], 800)).toEqual([]);
  expect(evaluateCounterBids([cand('K1')], [bid('K1', -10)], 800)).toEqual([]);
});

test('ties on price break by rating, then prep time', () => {
  const cands = [cand('LOW', { ratingAggregate: 4.2 }), cand('HIGH', { ratingAggregate: 4.9 })];
  const out = evaluateCounterBids(cands, [bid('LOW', 710), bid('HIGH', 710)], 800);
  expect(out.map((b) => b.restaurantId)).toEqual(['HIGH', 'LOW']);
});

test('matchKitchenNodes re-applies the load cutoff to repository results', async () => {
  const intent = { modality: 'DELIVERY', budget_ceiling_inr: 800, sla_max_minutes: 30, headcount: 3,
    target_dietary_profiles: [], items_requested: [{ query: 'biryani', serving_target: 2 }],
    client_coordinates: { lat: 12.9716, lng: 77.6412 } } as DeliveryIntent;
  const repo: KitchenRepository = { findCandidates: async () => [cand('OK'), cand('BUSY', { activeKdsLoad: 0.9 })] };
  const out = await matchKitchenNodes(repo, intent);
  expect(out.map((c) => c.restaurantId)).toEqual(['OK']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/auction/engine.test.ts`
Expected: FAIL, "Cannot find module '@/lib/auction/engine'".

- [ ] **Step 3: Implement**

Fixed logic for `evaluateCounterBids`, in this order for each bid:
1. Find the candidate with the same `restaurantId`. None: skip.
2. If `candidate.activeKdsLoad > AUCTION_MAX_LOAD`: skip (load exactly 0.85 is eligible; decision 2026-11-04).
2a. SLA (decision 2026-11-04): `transitMin = Math.ceil(candidate.distanceM / 1000 / 20 * 60)`; if `bid.estimatedPrepMinutes + transitMin + SLA_BUFFER_MIN > slaMaxMinutes`, skip. `SLA_BUFFER_MIN = 3`. `slaMaxMinutes` is the 4th argument of `evaluateCounterBids` (default `30`), taken from `intent.sla_max_minutes`.
3. Call `quoteBundle(bid.bundleContents.map(l => ({ basePrice: l.basePrice, quantity: l.quantity })), bid.offeredPriceInr, candidate.floorMargin)`. Catch `RangeError` and skip.
4. If `!quote.passesFloor` or `bid.offeredPriceInr > budgetInr`: skip.
5. Otherwise emit a `RankedBundle` with the quote's `meshFee` and `kitchenNet`.

Sort by `offeredPriceInr` ascending, then `ratingAggregate` descending, then `estimatedPrepMinutes` ascending, then `distanceM` ascending.

`matchKitchenNodes`: call `repo.findCandidates({ point: intent.client_coordinates, radiusM: TRANSIT_RADIUS_M, maxLoad: AUCTION_MAX_LOAD, items: intent.items_requested.map(i => ({ query: i.query, servingTarget: i.serving_target })), dietaryProfiles: intent.target_dietary_profiles })`, then drop any candidate with `activeKdsLoad > AUCTION_MAX_LOAD` (inclusive threshold, decision 2026-11-04) or with `distanceM > TRANSIT_RADIUS_M`.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/auction/engine.test.ts`
Expected: 8 passed. (The original text said 6, but the test block as written had 7 tests; decision 2026-11-04 adds the 30-minute SLA test, giving 8.)

- [ ] **Step 5: Commit**

```bash
git add lib/auction/engine.ts tests/auction/engine.test.ts
git commit -m "feat: add pure auction matching engine with load, budget, and floor checks

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 4: PostGIS KitchenRepository

**Files:**
- Create: `lib/auction/kitchen-repository.ts`, `tests/auction/kitchen-repository.test.ts`

**Interfaces:**
- Consumes: `KitchenRepository`, `KitchenSearch`, `KitchenCandidate` from `@/lib/auction/engine`; `getPool` types from `@/lib/db/client`; helpers from Task 1 (`makeRestaurant`, `makeMenuItem`).
- Produces: `createPostgisKitchenRepository(pool: pg.Pool): KitchenRepository`

Approach (fixed): (1) one query selects restaurants where `ST_DWithin(r.location, ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography, $radius)`, `r.active_kds_load <= $maxLoad` (inclusive, decision 2026-11-04), and `r.is_accepting_delivery`, returning `ST_Distance` as `distance_m`. (2) For the returned restaurant ids, one query selects in-stock menu items whose `name ILIKE '%' || query || '%'` and whose `dietary` is in `dietaryProfiles` when that list is non-empty. (3) For each restaurant, each requested query takes the cheapest matching item; if any query has no match, the restaurant is dropped. Line `quantity` is the query's `servingTarget`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/auction/kitchen-repository.test.ts
import { getPool, runMigrations } from '@/lib/db/client';
import { createPostgisKitchenRepository } from '@/lib/auction/kitchen-repository';
import { makeRestaurant, makeMenuItem } from '../helpers/mesh-fixtures';
import { randomUUID } from 'node:crypto';

const pool = getPool();
const repo = createPostgisKitchenRepository(pool);
const Q = { lat: 12.9716, lng: 77.6412 };
// Unique item names per test so cross-test rows never match.
const tag = () => `item${randomUUID().slice(0, 8)}`;
const search = (items: string[], o: Partial<{ point: typeof Q }> = {}) => ({
  point: o.point ?? Q, radiusM: 6000, maxLoad: 0.85,
  items: items.map((q) => ({ query: q, servingTarget: 1 })), dietaryProfiles: [],
});

beforeAll(async () => { await runMigrations(pool); });
afterAll(async () => { await pool.end(); });

test('includes a kitchen 5.5 km away and excludes one 6.8 km away (6 km radius)', async () => {
  const t = tag();
  const near = await makeRestaurant(pool, { lat: Q.lat + 0.0495, lng: Q.lng });
  const far = await makeRestaurant(pool, { lat: Q.lat + 0.0612, lng: Q.lng });
  for (const r of [near, far]) await makeMenuItem(pool, r, t, 200);
  const ids = (await repo.findCandidates(search([t]))).map((c) => c.restaurantId);
  expect(ids).toContain(near);
  expect(ids).not.toContain(far);
});

test('load 0.85 is included and 0.86 is excluded (Review Focus 2, inclusive per decision 2026-11-04)', async () => {
  const t = tag();
  const at85 = await makeRestaurant(pool, { lat: Q.lat + 0.001, lng: Q.lng, load: 0.85 });
  const at86 = await makeRestaurant(pool, { lat: Q.lat + 0.001, lng: Q.lng, load: 0.86 });
  for (const r of [at85, at86]) await makeMenuItem(pool, r, t, 200);
  const ids = (await repo.findCandidates(search([t]))).map((c) => c.restaurantId);
  expect(ids).toContain(at85);
  expect(ids).not.toContain(at86);
});

test('distance reflects ST_MakePoint(lng, lat) order (Review Focus 3)', async () => {
  const t = tag();
  const r = await makeRestaurant(pool, { lat: Q.lat + 0.01, lng: Q.lng }); // about 1.11 km north
  await makeMenuItem(pool, r, t, 200);
  const [c] = await repo.findCandidates(search([t]));
  expect(Math.abs(c.distanceM - 1112)).toBeLessThan(30);
});

test('a kitchen missing any requested item is dropped', async () => {
  const have = tag(); const need = tag();
  const r = await makeRestaurant(pool, { lat: Q.lat, lng: Q.lng });
  await makeMenuItem(pool, r, have, 200);
  expect(await repo.findCandidates(search([have, need]))).toEqual([]);
});

test('the cheapest matching item is chosen for each query', async () => {
  const t = tag();
  const r = await makeRestaurant(pool, { lat: Q.lat, lng: Q.lng });
  await makeMenuItem(pool, r, t, 350);
  await makeMenuItem(pool, r, `${t}-half`, 300);
  const [c] = await repo.findCandidates(search([t]));
  expect(c.lines[0].basePrice).toBe(300);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/auction/kitchen-repository.test.ts`
Expected: FAIL, "Cannot find module '@/lib/auction/kitchen-repository'".

- [ ] **Step 3: Implement** the repository per the approach above. Use parameterised queries only. Map `distance_m` and `active_kds_load` (numeric, cast to float in SQL) to the candidate shape.

- [ ] **Step 4: Verify**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/auction/kitchen-repository.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/auction/kitchen-repository.ts tests/auction/kitchen-repository.test.ts
git commit -m "feat: add PostGIS kitchen repository with 6 km radius and load filter

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sandbox Dispatch Implementation

**Files:**
- Create: `lib/dispatch/sandbox.ts`, `tests/dispatch/sandbox.test.ts`

**Interfaces:**
- Consumes (defined in Plan 06 Task 12, not redefined here): from `@/lib/dispatch/types`, `DispatchAdapter`, `DispatchTask`, `DispatchTaskRequest`, `ThreePlProvider`. Plan 06 Task 12's `lib/dispatch/types.ts` must exist before this task; see the dependency note below.
- Produces:
  - `createSandboxDispatch(): DispatchAdapter & { readonly isSandbox: true }`: implements Plan 06's `DispatchAdapter` (`createTask`, `getTask`, `cancelTask`) with `provider: 'shadowfax'`. It is the sandbox fake this plan needs for tests and the dev route; it makes no network calls.
  - `assertSandboxDispatchMode(): void`: throws `Error('DISPATCH_MODE=live is not enabled in Plan 06')` when `DISPATCH_MODE=live`; otherwise a no-op. This plan never constructs live adapters. Live adapters come only from Plan 06's `createDispatchAdapter`.

Dependency note: this plan does not define a dispatch interface. Plan 06 Task 12 must land first (or its `lib/dispatch/types.ts` must be merged) because Task 5 imports from it. Plan 06's `DispatchTaskRequest` has no handshake field; the handshake token stays on the auction row (see Task 6).

Sandbox behaviour (fixed): `createTask` returns `{ provider: 'shadowfax', providerTaskId: 'sbx-<random 8 hex>', status: 'assigned', etaMinutes: 12 }` and records the request time. `getTask` returns the same task with `status: 'assigned'`, `etaMinutes` equal to `max(1, 12 - floor(elapsedMinutes))`, plus sandbox-only extras `rider: { name: 'Sandbox Rider', vehicle: 'EV_BIKE' }` and `bagTempC: 68` (fixtures, not in Plan 06's `DispatchTask`; the route reads them from the sandbox type only). `cancelTask` marks the task `cancelled`. Unknown `providerTaskId` throws `Error('unknown sandbox task')`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/dispatch/sandbox.test.ts
import { createSandboxDispatch, assertSandboxDispatchMode } from '@/lib/dispatch/sandbox';
import type { DispatchTaskRequest } from '@/lib/dispatch/types';

const req: DispatchTaskRequest = {
  deliveryId: 'a1',
  pickup: { lat: 12.97, lng: 77.64, address: 'Meghna Foods' },
  dropoff: { lat: 12.98, lng: 77.65, address: 'Indiranagar' },
  readyAt: '2026-11-03T12:20:00.000Z', orderValueInr: 698,
};

test('sandbox task returns a tracking id; status shows a 68 C hot bag', async () => {
  const d = createSandboxDispatch();
  const t = await d.createTask(req);
  expect(t.providerTaskId).toMatch(/^sbx-[0-9a-f]{8}$/);
  const s = await d.getTask(t.providerTaskId);
  expect(s).toMatchObject({ status: 'assigned', bagTempC: 68, rider: { name: 'Sandbox Rider', vehicle: 'EV_BIKE' } });
  expect(s.etaMinutes).toBeGreaterThanOrEqual(1);
});

test('sandbox is flagged and unknown task ids throw', async () => {
  const d = createSandboxDispatch();
  expect(d.isSandbox).toBe(true);
  await expect(d.getTask('sbx-00000000')).rejects.toThrow(/unknown/i);
});

test('live dispatch is refused in v1 (Review Focus 5)', () => {
  const prev = process.env.DISPATCH_MODE;
  process.env.DISPATCH_MODE = 'live';
  try {
    expect(() => assertSandboxDispatchMode()).toThrow(/Plan 06/);
  } finally {
    process.env.DISPATCH_MODE = prev;
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/dispatch/sandbox.test.ts`
Expected: FAIL, "Cannot find module '@/lib/dispatch/sandbox'".

- [ ] **Step 3: Implement** `createSandboxDispatch` and `assertSandboxDispatchMode` per the behaviour above. Keep the sandbox state in a module-level `Map` (test-only fake; state is not persisted). Do not create `lib/dispatch/types.ts` or any factory here; both belong to Plan 06 Task 12.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/dispatch/sandbox.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/dispatch/sandbox.ts tests/dispatch/sandbox.test.ts
git commit -m "feat: add sandbox implementation of the Plan 06 DispatchAdapter

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Auction Repository and Window Lifecycle

**Files:**
- Create: `lib/auction/auction-repository.ts`, `tests/auction/auction-repository.test.ts`

**Interfaces:**
- Consumes: `asRole` from `@/lib/db/client`; `KitchenRepository`, `CounterBid`, `RankedBundle`, `evaluateCounterBids`, `BID_WINDOW_MS`, `AUCTION_LIFETIME_MS` from `@/lib/auction/engine`; `DispatchAdapter`, `DispatchTaskRequest` from `@/lib/dispatch/types` (Plan 06 Task 12); `DeliveryIntent` from `@/types/food-os`.
- Produces:
  - `class BidWindowClosedError extends Error`
  - `createAuction(pool: pg.Pool, dinerId: string, input: { transcript: string; intent: DeliveryIntent }): Promise<{ id: string; windowClosesAt: string; expiresAt: string }>`
  - `submitCounterBid(pool: pg.Pool, staffUserId: string, auctionId: string, bid: CounterBid): Promise<{ bidId: string; submittedAt: string }>`: throws `BidWindowClosedError` when the auction is not open or `now() >= created_at + 18 s`.
  - `closeIfDue(pool: pg.Pool, dinerId: string, auctionId: string, deps: { kitchens: KitchenRepository; dispatch: DispatchAdapter }): Promise<{ status: 'open' | 'awarded' | 'expired'; windowClosesAt: string; award?: RankedBundle; dispatch?: { provider: string; trackingRef: string } }>`

Fixed logic:
- `createAuction`: insert under `asRole(pool, dinerId)` with `raw_intent_payload = intent`, `budget_ceiling_inr`, `max_sla_minutes`, `delivery_location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)`. Return `windowClosesAt = created_at + 18 s` and `expiresAt` from the row.
- `submitCounterBid`: in one `asRole(pool, staffUserId)` transaction, read the auction with `SELECT status, now() < created_at + INTERVAL '18 seconds' AS in_window`. If not open or not in window, throw `BidWindowClosedError`. Otherwise insert into `auction_counter_bids` and return. The RLS insert policy repeats the check (Task 1).
- `closeIfDue`: in one `asRole(pool, dinerId)` transaction, lock the row with `SELECT ... FOR UPDATE` (the diner has update rights). If `status <> 'open'`, return it. If `now() < created_at + 18 s`, return `status: 'open'`. Otherwise load the stored bids (diner can read them via `counter_bids_diner_read`) and the candidates (`kitchens.findCandidates` built from `raw_intent_payload`), call `evaluateCounterBids(..., budget)`, and:
  - If a winner exists: set `status = 'awarded'`, `awarded_restaurant_id`, `awarded_bid_amount`; call `dispatch.createTask({ deliveryId: auctionId, pickup, dropoff, readyAt, orderValueInr })` (pickup from the restaurant's location and address, dropoff from `delivery_location`); store `assigned_3pl_provider = task.provider` and `logistics_tracking_ref = task.providerTaskId`. The handshake token stays on the auction row and is returned only to the owning diner, because Plan 06's `DispatchTaskRequest` has no handshake field. Commit.
  - If not: set `status = 'expired'`. Commit.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/auction/auction-repository.test.ts
import { getPool, runMigrations } from '@/lib/db/client';
import { createAuction, submitCounterBid, closeIfDue, BidWindowClosedError } from '@/lib/auction/auction-repository';
import { createPostgisKitchenRepository } from '@/lib/auction/kitchen-repository';
import { createSandboxDispatch } from '@/lib/dispatch/sandbox';
import { makeUser, makeRestaurant, makeMenuItem, makeAuction } from '../helpers/mesh-fixtures';
import { randomUUID } from 'node:crypto';
import type { DeliveryIntent } from '@/types/food-os';

const pool = getPool();
const kitchens = createPostgisKitchenRepository(pool);
const dispatch = createSandboxDispatch();
const P = { lat: 12.9716, lng: 77.6412 };
beforeAll(async () => { await runMigrations(pool); });
afterAll(async () => { await pool.end(); });

async function setup() {
  const item = `item${randomUUID().slice(0, 8)}`;
  const diner = await makeUser(pool, 'diner');
  const r = await makeRestaurant(pool, { lat: P.lat, lng: P.lng });
  await makeMenuItem(pool, r, item, 350);
  const staff = await makeUser(pool, 'restaurant_staff', r);
  const intent = { modality: 'DELIVERY', budget_ceiling_inr: 800, sla_max_minutes: 30, headcount: 1,
    target_dietary_profiles: [], items_requested: [{ query: item, serving_target: 2 }],
    client_coordinates: P } as DeliveryIntent;
  const bundle = [{ itemId: 'x', name: item, basePrice: 350, quantity: 2, station: 'Curry' as const }];
  return { item, diner, r, staff, intent, bundle };
}

test('a bid 1 second into the window is accepted and persisted', async () => {
  const s = await setup();
  const a = await makeAuction(pool, s.diner, { createdAgoSeconds: 1, intent: s.intent });
  const { bidId } = await submitCounterBid(pool, s.staff, a, { restaurantId: s.r, offeredPriceInr: 700, estimatedPrepMinutes: 12, bundleContents: s.bundle });
  expect(bidId).toBeTruthy();
});

test('a bid at 18.5 seconds is rejected with BidWindowClosedError (Review Focus 1)', async () => {
  const s = await setup();
  const a = await makeAuction(pool, s.diner, { createdAgoSeconds: 18.5, intent: s.intent });
  await expect(submitCounterBid(pool, s.staff, a, { restaurantId: s.r, offeredPriceInr: 700, estimatedPrepMinutes: 12, bundleContents: s.bundle }))
    .rejects.toBeInstanceOf(BidWindowClosedError);
});

test('closeIfDue before 18 seconds leaves the auction open', async () => {
  const s = await setup();
  const a = await makeAuction(pool, s.diner, { createdAgoSeconds: 5, intent: s.intent });
  const res = await closeIfDue(pool, s.diner, a, { kitchens, dispatch });
  expect(res.status).toBe('open');
});

test('closeIfDue after 18 seconds awards the best valid bid and dispatches it', async () => {
  const s = await setup();
  const a = await makeAuction(pool, s.diner, { createdAgoSeconds: 1, intent: s.intent });
  await submitCounterBid(pool, s.staff, a, { restaurantId: s.r, offeredPriceInr: 700, estimatedPrepMinutes: 12, bundleContents: s.bundle });
  // Move the clock: backdate the auction so the window is over.
  await pool.query(`UPDATE mesh_food_auctions SET created_at = created_at - INTERVAL '18 seconds' WHERE id = $1`, [a]);
  const res = await closeIfDue(pool, s.diner, a, { kitchens, dispatch });
  expect(res.status).toBe('awarded');
  expect(res.award?.restaurantId).toBe(s.r);
  expect(res.dispatch?.provider).toBe('shadowfax');
  const { rows } = await pool.query(`SELECT status, awarded_restaurant_id FROM mesh_food_auctions WHERE id = $1`, [a]);
  expect(rows[0]).toEqual({ status: 'awarded', awarded_restaurant_id: s.r });
});

test('closeIfDue with no valid bids marks the auction expired', async () => {
  const s = await setup();
  const a = await makeAuction(pool, s.diner, { createdAgoSeconds: 19, intent: s.intent });
  const res = await closeIfDue(pool, s.diner, a, { kitchens, dispatch });
  expect(res.status).toBe('expired');
});
```

Note on the test helper: `makeAuction` must accept `intent` and store it as `raw_intent_payload`, with `budget_ceiling_inr`, `max_sla_minutes`, and `delivery_location` taken from the intent. Update `tests/helpers/mesh-fixtures.ts` accordingly in Step 3.

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/auction/auction-repository.test.ts`
Expected: FAIL, "Cannot find module '@/lib/auction/auction-repository'".

- [ ] **Step 3: Implement** the three functions per the fixed logic above, and extend `makeAuction` in the fixtures to take `intent`.

- [ ] **Step 4: Verify**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/auction/auction-repository.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/auction/auction-repository.ts tests/auction/auction-repository.test.ts tests/helpers/mesh-fixtures.ts
git commit -m "feat: add auction repository with 18 s bid window and award on close

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Redis Pub/Sub Bus

**Files:**
- Create: `lib/mesh/bus.ts`, `tests/mesh/bus.test.ts`

**Interfaces:**
- Consumes: `ioredis`; `meshChannel`, `auctionEventsChannel`, `geohashBlock`, `encodeGeohash`, `MESH_GEOHASH_PRECISION` from `@/lib/mesh/geohash`.
- Produces:
  - `interface MeshBus { publish(channel: string, message: unknown): Promise<void>; subscribe(channels: string[], onMessage: (channel: string, message: unknown) => void): Promise<() => Promise<void>>; close(): Promise<void> }`
  - `createMeshBus(redisUrl?: string): MeshBus` (defaults to `process.env.REDIS_URL`; throws if neither is set)
  - `publishIntentToBlock(bus: MeshBus, point: LatLng, payload: object): Promise<string[]>` publishes to `meshChannel(cell)` for each cell in `geohashBlock(encodeGeohash(point))`; returns the channels used.

Fixed logic: `publish` JSON-encodes; `subscribe` creates a dedicated connection (ioredis requires one per subscriber), parses JSON on message, and returns an unsubscribe function that closes that connection. `close` closes the publisher and all subscribers.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/mesh/bus.test.ts
import { createMeshBus, publishIntentToBlock } from '@/lib/mesh/bus';
import { encodeGeohash, meshChannel } from '@/lib/mesh/geohash';

const P = { lat: 12.9716, lng: 77.6412 };
const bus = createMeshBus(process.env.REDIS_URL);
afterAll(async () => { await bus.close(); });

const waitFor = <T>(fn: (push: (v: T) => void) => void) => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), 3000);
  fn((v) => { clearTimeout(t); resolve(v); });
});

test('a published message arrives on the subscribed channel as parsed JSON', async () => {
  const ch = meshChannel(encodeGeohash(P));
  const got = waitFor<{ channel: string; message: unknown }>((push) =>
    bus.subscribe([ch], (channel, message) => push({ channel, message })).then(() => bus.publish(ch, { auctionId: 'a1' })));
  expect(await got).toEqual({ channel: ch, message: { auctionId: 'a1' } });
});

test('publishIntentToBlock publishes to nine distinct channels around the point', async () => {
  const channels = await publishIntentToBlock(bus, P, { auctionId: 'a2' });
  expect(channels).toHaveLength(9);
  expect(new Set(channels).size).toBe(9);
  expect(channels).toContain(meshChannel(encodeGeohash(P)));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `REDIS_URL=redis://localhost:6379 npx vitest run tests/mesh/bus.test.ts`
Expected: FAIL, "Cannot find module '@/lib/mesh/bus'".

- [ ] **Step 3: Implement** per the fixed logic. Redis must be running (Compose, Task 1 port binding).

- [ ] **Step 4: Verify**

Run: `REDIS_URL=redis://localhost:6379 npx vitest run tests/mesh/bus.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/mesh/bus.ts tests/mesh/bus.test.ts
git commit -m "feat: add Redis Pub/Sub mesh bus with geohash block publishing

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Dev Seed, Diner Resolution, Sandbox Kitchens, and POST /api/delivery/intent

**Files:**
- Create: `lib/dev/seed-mesh.ts`, `scripts/seed-mesh-dev.ts`, `lib/delivery/diner.ts`, `lib/delivery/request.ts`, `lib/auction/sandbox-kitchens.ts`, `app/api/delivery/intent/route.ts`, `tests/api/intent.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–7; `DeliveryIntentSchema` from `@/types/food-os`; `round2` from `@/lib/pricing`.
- Produces:
  - `seedMeshDev(pool: pg.Pool): Promise<void>`: idempotent (`ON CONFLICT DO NOTHING` on slug and phone). Seed table below.
  - `resolveDiner(req: Request, pool: pg.Pool): Promise<string>`: returns the dev diner id when `ALLOW_DEV_DINER=1`; otherwise throws `HttpError(401)`.
  - `DeliveryRequestSchema = z.object({ transcript: z.string().min(1).max(500), intent: DeliveryIntentSchema })`
  - `runSandboxKitchens(args: { pool: pg.Pool; bus: MeshBus; auctionId: string; candidates: KitchenCandidate[] }): Promise<void>`: for each candidate, finds a `restaurant_staff` user with that `restaurant_id`, submits a bid at `round2(sum(basePrice × quantity))` with `estimatedPrepMinutes: 12`, then publishes the bid to `auctionEventsChannel(auctionId)` with `{ type: 'bid', ...bid }`. Each bid is delayed by a random value in `[0, SANDBOX_BID_DELAY_MS]`; when that max is `0` the function awaits all bids before returning.
  - `POST(req: Request): Promise<Response>` in `app/api/delivery/intent/route.ts`. Returns `201` with `{ auctionId, windowClosesAt, candidates: number, bundles: RankedBundle[] }`; `400` with Zod issues on invalid body; `401` when no diner.

Seed table (approximate coordinates, see Gap 9):

| slug | name | lat | lng | load | rating | menu (price, station) |
|---|---|---|---|---|---|---|
| `meghna-foods` | Meghna Foods | 12.9719 | 77.6408 | 0.42 | 4.7 | Chicken Biryani 300 Curry; Seekh Kebab 180 Tandoor |
| `empire-restaurant` | Empire Restaurant | 12.9250 | 77.6410 | 0.68 | 4.6 | Chicken Biryani 300 Curry; Seekh Kebab 170 Tandoor |
| `hsr-busy-kitchen` | HSR Busy Kitchen | 12.9700 | 77.6300 | 0.91 | 4.1 | Chicken Biryani 280 Curry; Seekh Kebab 160 Tandoor |

Plus one staff user per restaurant (`restaurant_staff`, `restaurant_id` set) and one dev diner (`+919000000001`, role `diner`). All menu items are `non_veg`, `in_stock`.

Route steps (fixed): (1) `resolveDiner`; (2) parse body with `DeliveryRequestSchema`; (3) `createAuction`; (4) `matchKitchenNodes(createPostgisKitchenRepository(pool), intent)`; (5) `publishIntentToBlock(bus, intent.client_coordinates, { auctionId, ... })`; (6) `runSandboxKitchens`; (7) read stored bids for the auction via the diner and call `evaluateCounterBids` to build `bundles`; (8) respond `201`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/api/intent.test.ts
import { getPool, runMigrations } from '@/lib/db/client';
import { seedMeshDev } from '@/lib/dev/seed-mesh';
import { POST } from '@/app/api/delivery/intent/route';

const pool = getPool();
const body = (over: object = {}) => ({
  transcript: 'Dinner for 3: Biryani & Kebab strictly under ₹800, delivered in 30 mins to Indiranagar',
  intent: {
    modality: 'DELIVERY', budget_ceiling_inr: 800, sla_max_minutes: 30, headcount: 3,
    target_dietary_profiles: [], items_requested: [{ query: 'biryani', serving_target: 2 }, { query: 'kebab', serving_target: 1 }],
    client_coordinates: { lat: 12.9719, lng: 77.6408 }, ...over,
  },
});
const req = (b: unknown) => new Request('http://localhost:3000/api/delivery/intent', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
});

beforeAll(async () => {
  process.env.ALLOW_DEV_DINER = '1';
  process.env.SANDBOX_BID_DELAY_MS = '0';
  await runMigrations(pool);
  await seedMeshDev(pool);
});
afterAll(async () => { await pool.end(); });

test('rejects out-of-range coordinates with 400 before any query (Review Focus 1, Plan 01)', async () => {
  const res = await POST(req(body({ client_coordinates: { lat: 250, lng: 77.6 } })));
  expect(res.status).toBe(400);
});

test('a seeded search returns ranked bundles, cheapest first, excluding the busy kitchen', async () => {
  const res = await POST(req(body()));
  expect(res.status).toBe(201);
  const json = await res.json();
  expect(new Date(json.windowClosesAt).getTime() - Date.now()).toBeGreaterThan(15_000);
  const names: string[] = json.bundles.map((b: { name: string }) => b.name);
  expect(names).toEqual(expect.arrayContaining(['Meghna Foods', 'Empire Restaurant']));
  expect(names).not.toContain('HSR Busy Kitchen');
  const prices: number[] = json.bundles.map((b: { offeredPriceInr: number }) => b.offeredPriceInr);
  expect(prices).toEqual([...prices].sort((a, b) => a - b));
  expect(prices.every((p) => p <= 800)).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os REDIS_URL=redis://localhost:6379 npx vitest run tests/api/intent.test.ts`
Expected: FAIL, "Cannot find module '@/lib/dev/seed-mesh'".

- [ ] **Step 3: Implement** the files listed. `scripts/seed-mesh-dev.ts` calls `seedMeshDev(getPool())` and exits. `HttpError` is a small class in `lib/delivery/diner.ts`. Route `params` are not used here.

- [ ] **Step 4: Verify**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os REDIS_URL=redis://localhost:6379 npx vitest run tests/api/intent.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/dev/seed-mesh.ts scripts/seed-mesh-dev.ts lib/delivery/diner.ts lib/delivery/request.ts lib/auction/sandbox-kitchens.ts app/api/delivery/intent/route.ts tests/api/intent.test.ts
git commit -m "feat: add POST /api/delivery/intent with ranked bundles and dev seed

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 9: SSE Stream for Live Bids

**Files:**
- Create: `app/api/delivery/auctions/[id]/events/route.ts`, `tests/api/events.test.ts`

**Interfaces:**
- Consumes: `createMeshBus`, `auctionEventsChannel`; `closeIfDue`, `createAuction`; `resolveDiner`; `createPostgisKitchenRepository`; `createSandboxDispatch` and `assertSandboxDispatchMode` (Task 5).
- Produces: `export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';` and `GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response>` returning `text/event-stream` with `Cache-Control: no-cache, no-transform`.

Event contract (fixed):
- `event: snapshot`, data `{ status, windowClosesAt, bids: CounterBid-like rows from auction_counter_bids }`, sent first.
- `event: bid`, data is the bid payload published on the auction channel.
- `event: status`, data `{ status, windowClosesAt }`, sent when the tick changes status.
- `event: dispatch`, data `{ provider, trackingRef, handshakeToken, rider, bagTempC, etaMinutes }`, sent once after award. `handshakeToken` is sent only on this diner's stream.
- `: ping` comment every 15 s.

Fixed logic: call `assertSandboxDispatchMode()` and build the dispatch adapter with `createSandboxDispatch()` before any dispatch. Subscribe to `auctionEventsChannel(id)` before sending the snapshot, so no bid is missed. Every 1000 ms while status is `open`, call `closeIfDue` as the diner and emit `status` or `dispatch` on change. Stop on `req.signal` abort: clear timers and unsubscribe. The snapshot read uses `asRole(pool, dinerId)`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/api/events.test.ts
import { getPool, runMigrations } from '@/lib/db/client';
import { createMeshBus, type MeshBus } from '@/lib/mesh/bus';
import { auctionEventsChannel } from '@/lib/mesh/geohash';
import { GET } from '@/app/api/delivery/auctions/[id]/events/route';
import { makeUser, makeAuction } from '../helpers/mesh-fixtures';

const pool = getPool();
let bus: MeshBus;
beforeAll(async () => {
  process.env.ALLOW_DEV_DINER = '1';
  await runMigrations(pool);
  bus = createMeshBus(process.env.REDIS_URL);
});
afterAll(async () => { await bus.close(); await pool.end(); });

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> {
  const dec = new TextDecoder(); let buf = '';
  const deadline = Date.now() + 5000;
  while (!buf.includes(needle)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${needle}`);
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
  }
  return buf;
}

test('stream opens with a snapshot and then forwards a bid published on the auction channel', async () => {
  const diner = await makeUser(pool, 'diner');
  const auction = await makeAuction(pool, diner, { createdAgoSeconds: 1 });
  const ac = new AbortController();
  const res = await GET(new Request('http://localhost/x', { signal: ac.signal, headers: { 'x-dev-diner': diner } }),
    { params: Promise.resolve({ id: auction }) });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const first = await readUntil(reader, 'event: snapshot');
  expect(first).toContain('"status":"open"');
  await bus.publish(auctionEventsChannel(auction), { type: 'bid', restaurantId: 'r1', offeredPriceInr: 710 });
  const next = await readUntil(reader, 'event: bid');
  expect(next).toContain('"offeredPriceInr":710');
  ac.abort();
});
```

Note: `resolveDiner` accepts the dev diner when `ALLOW_DEV_DINER=1`. For this test the route must use the diner from `makeUser` by reading header `x-dev-diner` when `ALLOW_DEV_DINER=1` (test-only override, documented in `lib/delivery/diner.ts`). Update Task 8's `resolveDiner` accordingly in this task.

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os REDIS_URL=redis://localhost:6379 npx vitest run tests/api/events.test.ts`
Expected: FAIL, "Cannot find module '@/app/api/delivery/auctions/[id]/events/route'".

- [ ] **Step 3: Implement** the route per the event contract and fixed logic. Use `ReadableStream` with a `TextEncoder`. Set `runtime` and `dynamic` exports. Note: no Socket.io.

- [ ] **Step 4: Verify**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os REDIS_URL=redis://localhost:6379 npx vitest run tests/api/events.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add app/api/delivery/auctions/[id]/events/route.ts tests/api/events.test.ts lib/delivery/diner.ts
git commit -m "feat: add SSE stream for live counter-bids and dispatch status

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Route 2 Delivery Page

**Files:**
- Create: `lib/delivery/stub-extract.ts`, `tests/delivery/stub-extract.test.ts`, `app/delivery/page.tsx`, `app/delivery/_components/DeliveryConsole.tsx`, `app/delivery/_components/VoiceInput.tsx`, `app/delivery/_components/MetadataCard.tsx`, `app/delivery/_components/CounterBidList.tsx`, `app/delivery/_components/DispatchPanel.tsx`

**Interfaces:**
- Consumes: `LatLng`, `DeliveryIntent` types; the POST and SSE contracts from Tasks 8–9.
- Produces:
  - `interface ExtractedIntent { budget_ceiling_inr?: number; sla_max_minutes?: number; headcount: number; target_dietary_profiles: string[]; items_requested: Array<{ query: string; serving_target: number }>; locality?: string; client_coordinates?: LatLng }`
  - `extractIntentStub(text: string): ExtractedIntent`: deterministic regex stub (headcount from `for (\d+)`, budget from `under ₹?(\d+)`, SLA from `in (\d+) ?min`, items split on `&` or ` and ` after the colon, locality from a fixed map: `Indiranagar` → `{ lat: 12.9719, lng: 77.6408 }`, `HSR` → `{ lat: 12.9250, lng: 77.6410 }`). Unknown localities leave `client_coordinates` undefined.
  - `default export function Page()` in `app/delivery/page.tsx` renders `DeliveryConsole`.

Behaviour (fixed): `VoiceInput` is a text box (accepts typed text) with a disabled mic button labelled "Voice input arrives in Plan 04". `MetadataCard` shows budget, SLA, headcount, dietary, items, and coordinates. Submit posts `{ transcript, intent }` to `/api/delivery/intent`; on `201`, the console opens `EventSource('/api/delivery/auctions/<id>/events')`, runs an 18-second countdown from `windowClosesAt` (server time, not client clock), lists bids as they arrive, shows **Winning Match** (first bundle) and **Runner Up** (second bundle) after the window closes, and shows `DispatchPanel` on the `dispatch` event. `DispatchPanel` shows rider name, EV bike icon, handshake token formatted as `xxxx-xxxx` from the first 8 characters, a 68 °C hot-bag reading, and ETA. The savings line is omitted (Gap 4). Use Tailwind v4 and Lucide icons; no Framer Motion required in this task.

- [ ] **Step 1: Write the failing test**

```ts
// tests/delivery/stub-extract.test.ts
import { extractIntentStub } from '@/lib/delivery/stub-extract';

test('extracts budget, SLA, headcount, items, and locality from the sample sentence', () => {
  const r = extractIntentStub('Dinner for 3: Biryani & Kebab strictly under ₹800, delivered in 30 mins to Indiranagar');
  expect(r).toMatchObject({
    budget_ceiling_inr: 800, sla_max_minutes: 30, headcount: 3, locality: 'Indiranagar',
    items_requested: [{ query: 'biryani', serving_target: 1 }, { query: 'kebab', serving_target: 1 }],
  });
  expect(Math.abs(r.client_coordinates!.lat - 12.9719)).toBeLessThan(0.001);
});

test('an unknown locality leaves coordinates undefined', () => {
  expect(extractIntentStub('Biryani under 500 in 25 min to Whitefield').client_coordinates).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/delivery/stub-extract.test.ts`
Expected: FAIL, "Cannot find module '@/lib/delivery/stub-extract'".

- [ ] **Step 3: Implement** the stub and the components per the behaviour above. The page is a Server Component that renders the client `DeliveryConsole`.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/delivery/stub-extract.test.ts && npm run typecheck && npm run build`
Expected: 2 passed; typecheck exits 0; build lists `/delivery`, `/api/delivery/intent`, and `/api/delivery/auctions/[id]/events`.

- [ ] **Step 5: Commit**

```bash
git add lib/delivery/stub-extract.ts tests/delivery/stub-extract.test.ts app/delivery
git commit -m "feat: add Route 2 delivery page with live counter-bids and 3PL panel

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Stack Verification and Acceptance Script

**Files:**
- Create: `scripts/verify-mesh.sh`

**Interfaces:**
- Consumes: `docker-compose.yml` (Plan 01, with redis port binding from Task 1); `scripts/seed-mesh-dev.ts`; `POST /api/delivery/intent`.
- Produces: a script that prints `mesh OK` on success.

- [ ] **Step 1: Write the verification script first**

```bash
#!/usr/bin/env bash
# scripts/verify-mesh.sh
set -euo pipefail
export DATABASE_URL="postgres://food:${POSTGRES_PASSWORD}@localhost:5432/food_os"
export REDIS_URL="redis://localhost:6379"
export ALLOW_DEV_DINER=1
export SANDBOX_BID_DELAY_MS=0
docker compose up -d --build --wait
npx tsx scripts/seed-mesh-dev.ts
npx vitest run
body='{"transcript":"Biryani & Kebab under 800 in 30 min","intent":{"modality":"DELIVERY","budget_ceiling_inr":800,"sla_max_minutes":30,"headcount":3,"target_dietary_profiles":[],"items_requested":[{"query":"biryani","serving_target":2},{"query":"kebab","serving_target":1}],"client_coordinates":{"lat":12.9719,"lng":77.6408}}}'
out=$(mktemp)
trap 'rm -f "$out"' EXIT
code=$(curl -s -o "$out" -w '%{http_code}' -H 'content-type: application/json' -d "$body" http://localhost:3000/api/delivery/intent)
test "$code" = "201"
grep -q '"bundles"' "$out"
echo "mesh OK"
```

Run: `POSTGRES_PASSWORD=change-me bash scripts/verify-mesh.sh`
Expected before implementation: FAIL at `npx tsx scripts/seed-mesh-dev.ts` if Task 8 is not done; with all tasks done, the script prints `mesh OK`.

- [ ] **Step 2: Run to verify it passes**

Run: `POSTGRES_PASSWORD=change-me bash scripts/verify-mesh.sh`
Expected: all Vitest suites pass (Plan 01 suites plus Plan 02 suites); HTTP 201; `mesh OK`. Then `docker compose down`.

- [ ] **Step 3: Manual check of Route 2**

Run: `npm run dev` with the same env, open `http://localhost:3000/delivery`, type the sample sentence, submit.
Expected: metadata card shows budget 800, SLA 30, headcount 3, two items, Indiranagar coordinates; bids appear within 9 seconds; the countdown ends at 18 seconds; Winning Match and Runner Up are shown; DispatchPanel shows the sandbox rider, a `xxxx-xxxx` token, and 68 °C. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-mesh.sh
git commit -m "chore: add mesh stack verification script

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

## Acceptance for Plan 02

- `npm test` passes all suites, including Plan 01 suites, with `fileParallelism: false`.
- A seeded search (`POST /api/delivery/intent`) returns `201` with ranked bundles, cheapest first, excluding `HSR Busy Kitchen` (load 0.91).
- A bid at 18.5 seconds is rejected by both `submitCounterBid` (`BidWindowClosedError`) and the RLS insert policy.
- Kitchens at load 0.85 are included; kitchens above 0.85 (for example 0.86) are excluded (decision 2026-11-04). Kitchens that would miss the 30-minute SLA (prep + transit + 3-minute buffer) are excluded from the bid ranking.
- The 6 km radius is tested at 5.5 km (in) and 6.8 km (out); distances confirm `ST_MakePoint(lng, lat)`.
- The 3PL path is sandbox-only; `DISPATCH_MODE=live` throws.
- SSE delivers the snapshot and forwards bids from Redis; no Socket.io dependency is added.
- `bash scripts/verify-mesh.sh` prints `mesh OK`, and the Route 2 manual check in Task 11 passes.
- `npm run typecheck` and `npm run build` pass.
