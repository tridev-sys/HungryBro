# Plan 06: Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the kitchen and payment edges: POS menu sync and webhooks (Petpooja, Restroworks, UrbanPiper), ESC/POS printing on port 9100, ONDC Beckn parsing from recorded fixtures, 3PL dispatch adapters in sandbox, and Razorpay/Cashfree UPI intents with webhook verification.

**Architecture:** Each integration is an adapter behind a small interface. Pure parsing and rendering code (`lib/pos/`, `lib/printing/escpos.ts`, `lib/ondc/beckn.ts`) has no I/O. Network and socket code sits in thin senders that take injected clients, so tests substitute fakes. Every inbound webhook is verified with HMAC before the handler reads or writes any state. Menu writes from request traffic go through an integration-scoped RLS context added in migration `005_integrations.sql`. The nightly menu sync is the only code that connects as `food_sync` (BYPASSRLS). POS credentials are encrypted at rest with AES-256-GCM and decrypted only in the server process.

**Tech Stack:** Next.js 15 route handlers, Node `net` and `crypto` (no new runtime dependencies), Zod, `pg`, Vitest, PostgreSQL 16 + PostGIS 3.4 (real database in integration tests, per tech decisions), systemd timer on the EC2 host.

**Spec:** `/home/ubuntu/original/food_prompt.md` §1 (Integrations line), §2 (`restaurant_nodes`, `menu_items` DDL); PDF "Hardware & POS Integration Connector Bridge", "Bi-Directional POS Synchronization Bridge", "ONDC Beckn", "Shadowfax, Rapido, Dunzo", "Razorpay/Cashfree webhook" passages. Decisions in `2026-11-03-00-roadmap.md` and `2026-11-03-tech-decisions.md` apply here. Plan 01 is the base; this plan reuses its `menu_items` and `restaurant_nodes` columns exactly, including `pos_provider` and `pos_credentials`.

**Dependency note:** Task 12 defines the 3PL `DispatchAdapter` interface (shared decision 5). `2026-11-03-02-delivery-mesh.md` exists but still defines its own `DispatchAdapter` in `lib/dispatch/adapter.ts`, with a different shape (`provider`, `isSandbox`, `requestPickup`, `getStatus`). Plan 02 must adopt this Task 12 interface. That change is made in Plan 02, not in this file.

## Scope

In:
- POS adapter interface `PosAdapter` (signature check, webhook parse, provider menu to `menu_items` rows keyed by `pos_item_code`) with Petpooja, Restroworks, UrbanPiper adapters.
- Webhook route `POST /api/pos/[provider]/[restaurantId]`.
- Nightly full menu sync as a plain function, a script entry point, and a systemd timer on EC2. The sync connects as `food_sync` and never uses the owner or a superuser pool.
- ESC/POS renderer (text, bold, cut) and a TCP sender to port 9100 with timeout.
- ONDC Beckn `on_search` and `on_select` parser (fixture-based) and a BAP client that builds requests and never sends them in tests.
- 3PL dispatch adapters (Shadowfax, Rapido, Dunzo) in sandbox mode with a shared interface and fakes.
- `PaymentProvider` interface with Razorpay (primary) and Cashfree (fallback) UPI intent creation and webhook verification (`verifyWebhook`, provider adapters only).
- AES-256-GCM encryption of `restaurant_nodes.pos_credentials` at rest, keyed by `POS_CREDENTIALS_KEY` (Task 5).

Out:
- The HTTP route for payment webhooks and every write to `order_refs`, including `settled_at`. Plan 05 owns the payment webhook route and the settlement write, through the verifier path agreed with Plan 05. This plan supplies the provider adapters only, including `verifyWebhook`, which that path calls before any state change.
- Live ONDC onboarding, live 3PL dispatch, and live payment settlement. Each is disabled by configuration in this plan.
- Printer discovery and per-station printer UI (Plan 03 KDS).
- Provisioning the `food_sync` login password and the production `POS_CREDENTIALS_KEY` on EC2 (Plan 07 ops). Task 7 and Task 5 record the steps.

## Global Constraints

- Next.js 15 App Router; TypeScript `strict: true`; Zod for every external payload.
- Money is INR, `NUMERIC(10, 2)`, rounded with `round2` from `lib/pricing.ts` (Plan 01). Razorpay expects paise (integer `amount × 100`); Cashfree expects rupees with two decimals.
- `menu_items.gst_rate` is always `0.05` for POS-synced items (5% non-ITC restaurant GST).
- `menu_items` uniqueness is `UNIQUE(restaurant_id, pos_item_code)`. Rows are never deleted by sync; an item missing from a full sync becomes `is_in_stock = false`.
- Webhook order of operations is fixed: resolve the restaurant, verify the signature, then parse, then write. A failed verification performs no write.
- Tests never call a real third-party endpoint. Task 1 enforces this with a guard that fails the run on any non-loopback connection.
- **Fixtures are synthetic.** Every file under `tests/fixtures/` carries a top-level `"_fixture"` object stating `"synthetic": true`. The shapes are taken from public documentation and paraphrased. Each fixture must be replaced with a real partner capture once that partner signs. Signature header names and algorithms for POS and 3PL providers are assumptions until partner documentation is in hand; each is marked `ASSUMED` in its adapter.
- Secrets (`webhook_secret`, API keys) come from `pos_credentials` (AES-256-GCM encrypted; decrypted only in the server process, and only after the provider check) or the environment. They are never logged and never returned to the browser.
- Dietary classification (`menu_items.dietary`: `pure_veg`, `jain`, `halal`, `non_veg`, `vegan`, `egg`) is set only by the owner. No POS payload sets or overwrites it (shared decision 7).
- Database roles: request traffic uses `food_app` (RLS enforced). The nightly sync uses `food_sync` (BYPASSRLS) only. No code in this plan runs as the owner or a superuser at runtime.
- Migration: this plan adds `db/migrations/005_integrations.sql` (shared decision 1). It runs after `001_init.sql` through `004_auth_ratings_compliance.sql`.
- Port `3000` for the app; printers on port `9100`.

## Review Focus

1. A forged POS webhook gets `401` and changes no rows; the signature is checked before any write. Owned by Task 6.
2. A forged payment webhook throws before any state change, and a Cashfree event older than 300 seconds is rejected. Owned by Task 13.
3. No test reaches a non-loopback host; the guard fails the run instead of making a call. Owned by Task 1.
4. A full menu sync never deletes a `menu_items` row and refuses an empty provider menu rather than marking the whole menu out of stock. Owned by Task 5.
5. Cashfree is used only after a Razorpay create call throws; a Razorpay success never creates a second order. Owned by Task 14.

---

### Task 1: Test Network Guard and HMAC Verifier

**Files:**
- Create: `tests/setup/no-network.ts`, `tests/setup/no-network.test.ts`, `lib/webhooks/hmac.ts`, `tests/webhooks/hmac.test.ts`
- Modify: `vitest.config.ts` (add `setupFiles`)

**Interfaces:**
- Consumes: Plan 01 `vitest.config.ts`.
- Produces:
  - `verifyHmac(check: { secret: string; payload: string; signature: string | undefined; encoding: 'hex' | 'base64' }): boolean` in `lib/webhooks/hmac.ts`. Returns `false` (never throws) for missing secret, missing signature, or length mismatch. Uses `timingSafeEqual`.
  - Test setup: any `net.Socket.connect` or global `fetch` to a host other than `127.0.0.1`, `localhost`, or `::1` throws `Error('test attempted non-loopback ...')`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/setup/no-network.test.ts
import net from 'node:net';

test('guard blocks a non-loopback TCP connection', () => {
  const s = new net.Socket();
  s.on('error', () => {});
  expect(() => s.connect({ host: 'example.com', port: 80 })).toThrow(/non-loopback/);
});

test('guard blocks a non-loopback fetch', async () => {
  await expect(fetch('https://api.razorpay.com/v1/orders')).rejects.toThrow(/network fetch/);
});

test('guard allows loopback', async () => {
  const srv = net.createServer().listen(0, '127.0.0.1');
  await new Promise<void>((r) => srv.once('listening', () => r()));
  const port = (srv.address() as net.AddressInfo).port;
  const s = net.createConnection({ host: '127.0.0.1', port });
  await new Promise<void>((r) => s.once('connect', () => r()));
  s.destroy();
  srv.close();
});
```

```ts
// tests/webhooks/hmac.test.ts
import { createHmac } from 'node:crypto';
import { verifyHmac } from '@/lib/webhooks/hmac';

const secret = 'whsec_test';
const body = '{"event":"item.stock"}';
const hex = createHmac('sha256', secret).update(body).digest('hex');
const b64 = createHmac('sha256', secret).update(body).digest('base64');

test('accepts a valid hex signature', () => {
  expect(verifyHmac({ secret, payload: body, signature: hex, encoding: 'hex' })).toBe(true);
});

test('accepts a valid base64 signature', () => {
  expect(verifyHmac({ secret, payload: body, signature: b64, encoding: 'base64' })).toBe(true);
});

test('rejects a wrong secret', () => {
  expect(verifyHmac({ secret: 'other', payload: body, signature: hex, encoding: 'hex' })).toBe(false);
});

test('rejects a tampered body', () => {
  expect(verifyHmac({ secret, payload: body + ' ', signature: hex, encoding: 'hex' })).toBe(false);
});

test('rejects a missing signature or secret without throwing', () => {
  expect(verifyHmac({ secret, payload: body, signature: undefined, encoding: 'hex' })).toBe(false);
  expect(verifyHmac({ secret: '', payload: body, signature: hex, encoding: 'hex' })).toBe(false);
});

test('rejects a truncated signature without throwing', () => {
  expect(verifyHmac({ secret, payload: body, signature: hex.slice(0, 10), encoding: 'hex' })).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/setup/no-network.test.ts tests/webhooks/hmac.test.ts`
Expected: FAIL. The guard tests report "expected function to throw" and the connection is attempted (or fails with a DNS error); the HMAC test reports "Cannot find module '@/lib/webhooks/hmac'".

- [ ] **Step 3: Implement**

- `tests/setup/no-network.ts`: patch `net.Socket.prototype.connect` and `globalThis.fetch`. Normalize the connect arguments (object form or `(port, host)` form, default host `localhost`). Allowed hosts: `127.0.0.1`, `localhost`, `::1`. Otherwise throw the message in Interfaces above. Pass allowed calls to the saved originals.
- `vitest.config.ts`: add `setupFiles: ['tests/setup/no-network.ts']` in this task. Task 5 appends `'tests/setup/pos-key.ts'` once that file exists, so Task 1 runs without it.
- `lib/webhooks/hmac.ts`: fixed logic.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface HmacCheck {
  secret: string;
  payload: string;
  signature: string | undefined;
  encoding: 'hex' | 'base64';
}

export function verifyHmac({ secret, payload, signature, encoding }: HmacCheck): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(payload, 'utf8').digest(encoding);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(encoding === 'hex' ? signature.trim().toLowerCase() : signature.trim(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/setup/no-network.test.ts tests/webhooks/hmac.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add tests/setup vitest.config.ts lib/webhooks tests/webhooks
git commit -m "feat: add test network guard and constant-time HMAC verifier

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 2: POS Adapter Interface, Shared Helpers, Petpooja Adapter

**Files:**
- Create: `lib/pos/types.ts`, `lib/pos/common.ts`, `lib/pos/petpooja.ts`, `lib/pos/registry.ts`
- Create: `tests/fixtures/pos/petpooja-menu.json`, `tests/fixtures/pos/petpooja-stock-webhook.json`
- Test: `tests/pos/petpooja.test.ts`

**Interfaces:**
- Consumes: `StationCategory` from `types/food-os.ts` (Plan 01 Task 2); `verifyHmac` from `lib/webhooks/hmac.ts` (Task 1).
- Produces:

```ts
// lib/pos/types.ts
export type PosProvider = 'petpooja' | 'restroworks' | 'urbanpiper';

// The POS sync writes only name, base_price, is_in_stock, and pos_item_code (shared decision 7).
// There is no dietary, spice, prep-time, description, or gst field: dietary is owner-only,
// and menu_items.gst_rate keeps its schema default of 0.05.
export interface MenuItemUpsert {
  pos_item_code: string;          // menu_items.pos_item_code
  name: string;
  base_price: number;             // INR, already round2
  is_in_stock: boolean;
  category_name: string;          // resolved to menu_categories.id by Task 5
  station: StationCategory;       // menu_categories.station, set when the category is created
}

export type PosEvent =
  | { kind: 'menu'; items: MenuItemUpsert[]; full: boolean }                   // full = true for a full sync, false for a partial push
  | { kind: 'stock'; pos_item_code: string; is_in_stock: boolean }
  | { kind: 'ignored'; reason: string };

export class PosPayloadError extends Error {}

export interface PosAdapter {
  readonly provider: PosProvider;
  verifySignature(args: { rawBody: string; headers: Record<string, string | undefined>; secret: string }): boolean;
  parseWebhook(rawBody: string, ctx?: { expectedLocationId?: string }): PosEvent;      // throws PosPayloadError; ctx used by UrbanPiper only
  mapMenu(providerMenu: unknown): MenuItemUpsert[];   // throws PosPayloadError
}
```

```ts
// lib/pos/common.ts
export function toStation(raw: string | undefined): StationCategory;   // unknown → 'General'
export function parseMoney(raw: string | number): number;              // round2; throws PosPayloadError if not finite or <= 0
// No toDietary or clampSpice: POS payloads never set dietary or spice (shared decision 7).
```

```ts
// lib/pos/registry.ts
export function getPosAdapter(provider: string): PosAdapter | undefined;
```

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/pos/petpooja-menu.json` (synthetic; shape paraphrased from public documentation):

```json
{
  "_fixture": { "synthetic": true, "shaped_from": "public documentation, paraphrased", "replace_with": "real Petpooja capture after partner signs" },
  "restID": "PP-TEST-001",
  "categories": [
    {
      "categoryid": "cat-breads",
      "categoryname": "Breads",
      "items": [
        { "itemid": "pp-naan-01", "itemname": "Butter Naan", "itemdescription": "Tandoor bread", "price": "60.00", "isveg": "1", "preparation_time": "10", "station": "Tandoor", "instock": "1", "spice_level": 0 },
        { "itemid": "pp-garlic-02", "itemname": "Garlic Naan", "itemdescription": "", "price": "75.50", "isveg": "1", "preparation_time": "12", "station": "Tandoor", "instock": "0", "spice_level": 1 }
      ]
    },
    {
      "categoryid": "cat-curry",
      "categoryname": "Curries",
      "items": [
        { "itemid": "pp-paneer-03", "itemname": "Paneer Butter Masala", "itemdescription": "Paneer in tomato gravy", "price": "260.00", "isveg": "1", "preparation_time": "18", "station": "Curry", "instock": "1", "spice_level": 2 },
        { "itemid": "pp-chicken-04", "itemname": "Chicken Curry", "itemdescription": "", "price": "320.00", "isveg": "0", "preparation_time": "20", "station": "Curry", "instock": "1", "spice_level": 3 }
      ]
    }
  ]
}
```

`tests/fixtures/pos/petpooja-stock-webhook.json`:

```json
{
  "_fixture": { "synthetic": true, "shaped_from": "public documentation, paraphrased", "replace_with": "real Petpooja capture after partner signs" },
  "event": "item.stock",
  "restID": "PP-TEST-001",
  "data": { "itemid": "pp-naan-01", "instock": "0" }
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/pos/petpooja.test.ts
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { petpoojaAdapter } from '@/lib/pos/petpooja';
import { PosPayloadError } from '@/lib/pos/types';

const fixture = (f: string) => readFileSync(path.join(__dirname, '../fixtures/pos', f), 'utf8');
const menu = JSON.parse(fixture('petpooja-menu.json'));

test('maps every fixture item to a menu_items row keyed by pos_item_code', () => {
  const rows = petpoojaAdapter.mapMenu(menu);
  expect(rows.map((r) => r.pos_item_code)).toEqual(['pp-naan-01', 'pp-garlic-02', 'pp-paneer-03', 'pp-chicken-04']);
  expect(rows[0]).toMatchObject({
    name: 'Butter Naan', base_price: 60, is_in_stock: true,
    category_name: 'Breads', station: 'Tandoor',
  });
  expect(rows[0]).not.toHaveProperty('dietary');
});

test('maps out-of-stock flags and never maps a veg flag to dietary (Decision 7)', () => {
  const rows = petpoojaAdapter.mapMenu(menu);
  expect(rows[1].is_in_stock).toBe(false);
  expect(rows[3]).toMatchObject({ name: 'Chicken Curry', base_price: 320 });
  expect(rows[3]).not.toHaveProperty('dietary');
});

test('verifies an ASSUMED hex HMAC over the raw body', () => {
  const raw = fixture('petpooja-stock-webhook.json');
  const sig = createHmac('sha256', 'pp-secret').update(raw).digest('hex');
  expect(petpoojaAdapter.verifySignature({ rawBody: raw, headers: { 'x-petpooja-signature': sig }, secret: 'pp-secret' })).toBe(true);
  expect(petpoojaAdapter.verifySignature({ rawBody: raw, headers: {}, secret: 'pp-secret' })).toBe(false);
});

test('parses the stock webhook into a stock event', () => {
  expect(petpoojaAdapter.parseWebhook(fixture('petpooja-stock-webhook.json')))
    .toEqual({ kind: 'stock', pos_item_code: 'pp-naan-01', is_in_stock: false });
});

test('rejects a menu with a non-positive price', () => {
  const bad = structuredClone(menu);
  bad.categories[0].items[0].price = '0.00';
  expect(() => petpoojaAdapter.mapMenu(bad)).toThrow(PosPayloadError);
});

test('registry resolves known providers only', () => {
  expect(getPosAdapter('petpooja')?.provider).toBe('petpooja');
  expect(getPosAdapter('unknown')).toBeUndefined();
});
```

(Add `import { getPosAdapter } from '@/lib/pos/registry';` to the test file header.)

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/pos/petpooja.test.ts`
Expected: FAIL, "Cannot find module '@/lib/pos/petpooja'".

- [ ] **Step 4: Implement**

- `lib/pos/types.ts`: the types in Interfaces above.
- `lib/pos/common.ts`: `toStation` maps the exact `StationCategory` strings and returns `'General'` for anything else. `parseMoney` accepts a string or number, parses with `Number`, throws `PosPayloadError` on NaN, infinity, or `<= 0`, and returns `round2`.
- `lib/pos/petpooja.ts`: `petpoojaAdapter: PosAdapter` with `provider: 'petpooja'`.
  - `verifySignature`: `ASSUMED` scheme: hex HMAC-SHA256 of the raw body in header `x-petpooja-signature` (VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: header name and encoding), via `verifyHmac`.
  - `mapMenu`: Zod-validate the top level (`restID`, `categories[]`) and each item (`itemid`, `itemname`, `price`, `instock`, `station`). `isveg`, `itemdescription`, `preparation_time`, and `spice_level` are validated as optional and not mapped. Items with `instock` of `"1"` map to `is_in_stock: true`. Flatten categories so `category_name` is the parent `categoryname`. Never map a veg flag to `dietary` (shared decision 7).
  - `parseWebhook`: Zod-validate. `event: "item.stock"` produces `{ kind: 'stock' }`. `event: "menu.sync"` with an inline menu produces `{ kind: 'menu', items: mapMenu(body) }`. Any other event returns `{ kind: 'ignored', reason }`.
- `lib/pos/registry.ts`: a `Map` of provider name to adapter. Task 3 and Task 4 add the other two entries.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/pos/petpooja.test.ts`
Expected: 6 passed. (The registry test passes only after Task 3 and Task 4 register their adapters; until then, comment out the two non-Petpooja assertions and restore them in Task 4.)

- [ ] **Step 6: Commit**

```bash
git add lib/pos tests/pos tests/fixtures/pos
git commit -m "feat: add POS adapter interface and Petpooja adapter with synthetic fixtures

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Restroworks Adapter

**Files:**
- Create: `lib/pos/restroworks.ts`, `tests/fixtures/pos/restroworks-menu.json`, `tests/fixtures/pos/restroworks-stock-webhook.json`
- Modify: `lib/pos/registry.ts` (register `restroworks`)
- Test: `tests/pos/restroworks.test.ts`

**Interfaces:**
- Consumes: `PosAdapter`, `MenuItemUpsert`, `PosEvent`, `PosPayloadError` (Task 2); `toStation`, `parseMoney` (Task 2); `verifyHmac` (Task 1).
- Produces: `export const restroworksAdapter: PosAdapter` (`provider: 'restroworks'`). Restroworks (Posist) sends item variations and modifier sets; this adapter flattens each variation into its own `pos_item_code` of the form `<itemId>::<variationId>` and ignores modifier sets for the menu row (modifiers are carried on the KDS ticket in Plan 03).

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/pos/restroworks-menu.json`: `_fixture` block as in Task 2, `"outletCode": "RW-TEST-009"`, `"menu": { "sections": [ { "sectionName": "Mains", "stationTag": "Curry", "products": [ { "productId": "rw-dal-10", "productName": "Dal Tadka", "variations": [ { "variationId": "half", "price": 140.0, "vegFlag": true, "prepMinutes": 12, "inStock": true }, { "variationId": "full", "price": 220.0, "vegFlag": true, "prepMinutes": 15, "inStock": true } ] }, { "productId": "rw-kebab-11", "productName": "Seekh Kebab", "variations": [ { "variationId": "std", "price": 360.0, "vegFlag": false, "prepMinutes": 14, "inStock": false } ] } ] } ] }`. Write it in pretty JSON.

`tests/fixtures/pos/restroworks-stock-webhook.json`: `_fixture` block, `{ "topic": "variation.stock", "outletCode": "RW-TEST-009", "payload": { "productId": "rw-dal-10", "variationId": "half", "inStock": false } }`.

- [ ] **Step 2: Write the failing test**

```ts
// tests/pos/restroworks.test.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { restroworksAdapter } from '@/lib/pos/restroworks';
import { getPosAdapter } from '@/lib/pos/registry';

const fixture = (f: string) => readFileSync(path.join(__dirname, '../fixtures/pos', f), 'utf8');
const menu = JSON.parse(fixture('restroworks-menu.json'));

test('flattens variations into pos_item_code productId::variationId', () => {
  const rows = restroworksAdapter.mapMenu(menu);
  expect(rows.map((r) => r.pos_item_code)).toEqual(['rw-dal-10::half', 'rw-dal-10::full', 'rw-kebab-11::std']);
});

test('maps names, prices, station, and stock per variation, without dietary', () => {
  const rows = restroworksAdapter.mapMenu(menu);
  expect(rows[0]).toMatchObject({ name: 'Dal Tadka', base_price: 140, station: 'Curry', is_in_stock: true });
  expect(rows[2]).toMatchObject({ base_price: 360, is_in_stock: false });
  expect(rows[0]).not.toHaveProperty('dietary');
});

test('parses a variation stock webhook into a stock event for the composite code', () => {
  expect(restroworksAdapter.parseWebhook(fixture('restroworks-stock-webhook.json')))
    .toEqual({ kind: 'stock', pos_item_code: 'rw-dal-10::half', is_in_stock: false });
});

test('verifies an ASSUMED base64 HMAC header', () => {
  const raw = fixture('restroworks-stock-webhook.json');
  const sig = createHmac('sha256', 'rw-secret').update(raw).digest('base64');
  expect(restroworksAdapter.verifySignature({ rawBody: raw, headers: { 'x-restroworks-signature': sig }, secret: 'rw-secret' })).toBe(true);
  expect(restroworksAdapter.verifySignature({ rawBody: raw, headers: { 'x-restroworks-signature': sig }, secret: 'wrong' })).toBe(false);
});

test('registry resolves restroworks', () => {
  expect(getPosAdapter('restroworks')).toBe(restroworksAdapter);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/pos/restroworks.test.ts`
Expected: FAIL, "Cannot find module '@/lib/pos/restroworks'".

- [ ] **Step 4: Implement**

- `lib/pos/restroworks.ts`: Zod-validate `menu.sections[].products[].variations[]`. `mapMenu` emits one row per variation. `category_name` is the section name. `station` comes from `stationTag` through `toStation`. `is_in_stock` comes from the variation's `inStock`.
- `verifySignature`: `ASSUMED` base64 HMAC-SHA256 in `x-restroworks-signature` over the raw body (VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: header name and encoding).
- `parseWebhook`: `topic: "variation.stock"` produces the stock event with `pos_item_code` `productId::variationId`. `topic: "menu.sync"` produces a menu event via `mapMenu`. Others are `ignored`.
- `lib/pos/registry.ts`: add the `restroworks` entry.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/pos/restroworks.test.ts tests/pos/petpooja.test.ts`
Expected: all pass (restroworks 5, petpooja 6 with registry assertions restored).

- [ ] **Step 6: Commit**

```bash
git add lib/pos/restroworks.ts lib/pos/registry.ts tests/pos/restroworks.test.ts tests/fixtures/pos/restroworks-*.json
git commit -m "feat: add Restroworks POS adapter with variation-level pos_item_code

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 4: UrbanPiper Adapter

**Files:**
- Create: `lib/pos/urbanpiper.ts`, `tests/fixtures/pos/urbanpiper-menu.json`, `tests/fixtures/pos/urbanpiper-stock-webhook.json`
- Modify: `lib/pos/registry.ts` (register `urbanpiper`)
- Test: `tests/pos/urbanpiper.test.ts`

**Interfaces:**
- Consumes: Task 2 and Task 1 modules as in Task 3.
- Produces: `export const urbanpiperAdapter: PosAdapter` (`provider: 'urbanpiper'`). UrbanPiper is an omnichannel hub; its menu arrives per location. `pos_item_code` is the hub's `retailer_id` field. One outlet maps to one `restaurant_nodes` row through `pos_credentials.location_id`; a payload whose `location_id` does not match the configured value is rejected with `PosPayloadError`.

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/pos/urbanpiper-menu.json`: `_fixture` block, `"location_id": "UP-LOC-77"`, `"items": [ { "retailer_id": "up-idli-20", "title": "Idli Sambar (2)", "description": "Steamed rice cakes", "price": 90, "veg": true, "prep_time": 8, "category": "South Indian", "available": true, "station": "Pantry", "spice_level": 1 }, { "retailer_id": "up-mutton-21", "title": "Mutton Pepper Fry", "description": "", "price": 420, "veg": false, "prep_time": 22, "category": "Non-Veg", "available": true, "station": "Curry", "spice_level": 3 } ]`.

`tests/fixtures/pos/urbanpiper-stock-webhook.json`: `_fixture` block, `{ "event_type": "item.availability", "location_id": "UP-LOC-77", "retailer_id": "up-idli-20", "available": false }`.

- [ ] **Step 2: Write the failing test**

```ts
// tests/pos/urbanpiper.test.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { urbanpiperAdapter } from '@/lib/pos/urbanpiper';
import { getPosAdapter } from '@/lib/pos/registry';
import { PosPayloadError } from '@/lib/pos/types';

const fixture = (f: string) => readFileSync(path.join(__dirname, '../fixtures/pos', f), 'utf8');
const menu = JSON.parse(fixture('urbanpiper-menu.json'));

test('maps items keyed by retailer_id', () => {
  const rows = urbanpiperAdapter.mapMenu(menu);
  expect(rows.map((r) => r.pos_item_code)).toEqual(['up-idli-20', 'up-mutton-21']);
  expect(rows[0]).toMatchObject({ name: 'Idli Sambar (2)', base_price: 90, station: 'Pantry', category_name: 'South Indian' });
  expect(rows[1]).toMatchObject({ base_price: 420, is_in_stock: true });
  expect(rows[0]).not.toHaveProperty('dietary');
});

test('parses an availability event', () => {
  expect(urbanpiperAdapter.parseWebhook(fixture('urbanpiper-stock-webhook.json')))
    .toEqual({ kind: 'stock', pos_item_code: 'up-idli-20', is_in_stock: false });
});

test('rejects a payload for a different location than the configured one', () => {
  const other = JSON.parse(fixture('urbanpiper-stock-webhook.json'));
  other.location_id = 'UP-LOC-99';
  expect(() => urbanpiperAdapter.parseWebhook(JSON.stringify(other), { expectedLocationId: 'UP-LOC-77' }))
    .toThrow(PosPayloadError);
});

test('verifies an ASSUMED hex HMAC header', () => {
  const raw = fixture('urbanpiper-stock-webhook.json');
  const sig = createHmac('sha256', 'up-secret').update(raw).digest('hex');
  expect(urbanpiperAdapter.verifySignature({ rawBody: raw, headers: { 'x-urbanpiper-signature': sig }, secret: 'up-secret' })).toBe(true);
});

test('registry resolves urbanpiper', () => {
  expect(getPosAdapter('urbanpiper')).toBe(urbanpiperAdapter);
});
```

Note on the test: `parseWebhook` takes a second optional argument `{ expectedLocationId?: string }`. Add it to the Task 2 `PosAdapter` interface as `parseWebhook(rawBody: string, ctx?: { expectedLocationId?: string }): PosEvent;` and update Task 2's interface block to match. Other adapters ignore the second argument.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/pos/urbanpiper.test.ts`
Expected: FAIL, "Cannot find module '@/lib/pos/urbanpiper'".

- [ ] **Step 4: Implement**

- `lib/pos/urbanpiper.ts`: Zod-validate `items[]`. `mapMenu` maps `retailer_id` to `pos_item_code`, `available` to `is_in_stock`, `category` to `category_name`, `station` through `toStation`. `veg` and `spice_level` are not mapped (shared decision 7). `verifySignature`: `ASSUMED` hex HMAC in `x-urbanpiper-signature` (VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: header name and encoding). `parseWebhook`: when `ctx.expectedLocationId` is set and differs from the payload's `location_id`, throw `PosPayloadError`. `item.availability` produces a stock event; `menu.sync` produces a menu event.
- `lib/pos/registry.ts`: add `urbanpiper`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/pos`
Expected: all pass across the three adapter suites.

- [ ] **Step 6: Commit**

```bash
git add lib/pos/urbanpiper.ts lib/pos/registry.ts lib/pos/types.ts tests/pos/urbanpiper.test.ts tests/fixtures/pos/urbanpiper-*.json
git commit -m "feat: add UrbanPiper POS adapter with location check

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Menu Upsert Repository and Integration RLS

**Files:**
- Create: `db/migrations/005_integrations.sql`, `lib/db/integration.ts`, `lib/pos/upsert.ts`, `lib/pos/credentials.ts`, `tests/helpers/db.ts`, `tests/setup/pos-key.ts`
- Modify: `.env.example` (add `POS_CREDENTIALS_KEY=`)
- Test: `tests/pos/upsert.test.ts`, `tests/pos/credentials.test.ts`

Migration `005` runs after `001_init.sql` through `004_auth_ratings_compliance.sql` (lexical order; shared decision 1). It depends on `menu_items.dietary` and `restaurant_nodes.pos_credentials` from Plan 01.

**Interfaces:**
- Consumes: `getPool`, `runMigrations`, `asRole` from `lib/db/client.ts` (Plan 01 Task 4); `MenuItemUpsert` (Task 2).
- Produces:
  - `asIntegration<T>(pool: pg.Pool, restaurantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T>`: one transaction that runs `SET LOCAL ROLE food_app` and `set_config('app.integration_restaurant_id', $1, true)`.
  - `class EmptyMenuError extends Error {}`
  - `upsertMenu(c: pg.PoolClient, restaurantId: string, items: MenuItemUpsert[], opts: { full: boolean }): Promise<{ inserted: number; updated: number; markedOutOfStock: number }>`. When `opts.full` is `true` and `items` is empty, throws `EmptyMenuError` before any write.
  - `setStock(c: pg.PoolClient, restaurantId: string, posItemCode: string, inStock: boolean): Promise<number>` (rows affected).
  - `createRestaurant(pool, opts: { provider: string; credentials: object }): Promise<string>` in `tests/helpers/db.ts`.
  - Migration `005_integrations.sql`: integration-scoped policies (below). It adds no SECURITY DEFINER function. The nightly sync reads `restaurant_nodes` directly as `food_sync` (BYPASSRLS, shared decision 2).
  - `encryptCredentials(obj: Record<string, unknown>, key: Buffer): { iv: string; tag: string; ciphertext: string }` in `lib/pos/credentials.ts`: AES-256-GCM, a fresh 12-byte random IV per write, 16-byte tag, all three values base64 (shared decision 6).
  - `decryptCredentials(stored: unknown, key: Buffer): Record<string, unknown>`: accepts the `{iv, tag, ciphertext}` shape. A stored `{}` (the Plan 01 default for direct restaurants) returns `{}`. Any other unencrypted value throws. Decryption is only called in the server process.
  - `loadPosKey(env?: NodeJS.ProcessEnv): Buffer`: reads `POS_CREDENTIALS_KEY`. Throws if it is unset, or if it does not decode to exactly 32 bytes of base64.

Migration content (fixed logic):

```sql
-- 005_integrations.sql (Plan 06). Policies and one helper only; no new tables.
-- food_sync (BYPASSRLS, created NOLOGIN in 001_init.sql) needs no policy here.
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_nodes ENABLE ROW LEVEL SECURITY;  -- no-op if already enabled

CREATE POLICY menu_items_public_read ON menu_items FOR SELECT USING (true);
CREATE POLICY menu_categories_public_read ON menu_categories FOR SELECT USING (true);

CREATE POLICY menu_items_integration_write ON menu_items FOR ALL
  USING (restaurant_id = NULLIF(current_setting('app.integration_restaurant_id', true), '')::uuid)
  WITH CHECK (restaurant_id = NULLIF(current_setting('app.integration_restaurant_id', true), '')::uuid);
CREATE POLICY menu_categories_integration_write ON menu_categories FOR ALL
  USING (restaurant_id = NULLIF(current_setting('app.integration_restaurant_id', true), '')::uuid)
  WITH CHECK (restaurant_id = NULLIF(current_setting('app.integration_restaurant_id', true), '')::uuid);
CREATE POLICY restaurant_nodes_integration_read ON restaurant_nodes FOR SELECT
  USING (id = NULLIF(current_setting('app.integration_restaurant_id', true), '')::uuid);
```

Note for the implementer: the earlier cross-tenant SECURITY DEFINER function is removed. It returned every restaurant's credentials to request traffic. The nightly sync now reads `restaurant_nodes` as `food_sync`, which bypasses RLS by role attribute, so no function is needed. Task 7 tests this.

Also: the existing Plan 01 policies on `menu_items` (if any) stay in place. If `menu_items` already has a read policy, drop the `menu_items_public_read` line.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/pos/upsert.test.ts
import { getPool, runMigrations } from '@/lib/db/client';
import { asIntegration } from '@/lib/db/integration';
import { upsertMenu, setStock, EmptyMenuError } from '@/lib/pos/upsert';
import { createRestaurant } from '../helpers/db';
import type { MenuItemUpsert } from '@/lib/pos/types';

const pool = getPool();
beforeAll(async () => { await runMigrations(pool); });
afterAll(async () => { await pool.end(); });

const item = (code: string, price = 100, inStock = true): MenuItemUpsert => ({
  pos_item_code: code, name: `Item ${code}`, base_price: price, is_in_stock: inStock,
  category_name: 'Test', station: 'General',
});

const count = async (rid: string) =>
  (await pool.query('SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1', [rid])).rows[0].n;

test('upsert inserts then updates without duplicating rows', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('a'), item('b')], { full: true }));
  const second = await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('a', 120), item('b')], { full: true }));
  expect(second).toMatchObject({ inserted: 0, updated: 2 });
  expect(await count(rid)).toBe(2);
  const { rows } = await pool.query('SELECT base_price::float8 AS p FROM menu_items WHERE restaurant_id = $1 AND pos_item_code = $2', [rid, 'a']);
  expect(rows[0].p).toBe(120);
});

test('full sync marks missing items out of stock and never deletes them (Review Focus 4)', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('a'), item('gone')], { full: true }));
  const r = await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('a')], { full: true }));
  expect(r.markedOutOfStock).toBe(1);
  expect(await count(rid)).toBe(2);
  const { rows } = await pool.query('SELECT is_in_stock FROM menu_items WHERE restaurant_id = $1 AND pos_item_code = $2', [rid, 'gone']);
  expect(rows[0].is_in_stock).toBe(false);
});

test('an empty full sync throws and changes nothing (Review Focus 4)', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('a')], { full: true }));
  await expect(asIntegration(pool, rid, (c) => upsertMenu(c, rid, [], { full: true }))).rejects.toThrow(EmptyMenuError);
  expect(await count(rid)).toBe(1);
  const { rows } = await pool.query('SELECT is_in_stock FROM menu_items WHERE restaurant_id = $1', [rid]);
  expect(rows[0].is_in_stock).toBe(true);
});

test('integration context for restaurant A cannot write restaurant B menu', async () => {
  const a = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  const b = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  await asIntegration(pool, b, (c) => upsertMenu(c, b, [item('x')], { full: true }));
  const changed = await asIntegration(pool, a, (c) => setStock(c, b, 'x', false));
  expect(changed).toBe(0);
  const { rows } = await pool.query('SELECT is_in_stock FROM menu_items WHERE restaurant_id = $1', [b]);
  expect(rows[0].is_in_stock).toBe(true);
});

test('setStock flips one item for the owning restaurant', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('y')], { full: true }));
  expect(await asIntegration(pool, rid, (c) => setStock(c, rid, 'y', false))).toBe(1);
});

test('POS sync never overwrites dietary set by the owner (Decision 7)', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('j')], { full: true }));
  await pool.query(`UPDATE menu_items SET dietary = 'jain' WHERE restaurant_id = $1 AND pos_item_code = 'j'`, [rid]);
  await asIntegration(pool, rid, (c) => upsertMenu(c, rid, [item('j', 120)], { full: true }));
  const { rows } = await pool.query(
    `SELECT dietary, base_price::float8 AS p FROM menu_items WHERE restaurant_id = $1 AND pos_item_code = 'j'`, [rid]);
  expect(rows[0]).toEqual({ dietary: 'jain', p: 120 });
});
```

```ts
// tests/helpers/db.ts
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { encryptCredentials, loadPosKey } from '@/lib/pos/credentials';
// Creates a restaurant_nodes row through the food_admin fixture pool (BYPASSRLS, not superuser). Used only by tests.
// pos_credentials is stored encrypted, as in production.
export async function createRestaurant(pool: pg.Pool, opts: { provider: string; credentials: object }): Promise<string> {
  const stored = encryptCredentials(opts.credentials as Record<string, unknown>, loadPosKey());
  const { rows } = await pool.query(
    `INSERT INTO restaurant_nodes (slug, name, fssai_license_number, gstin, pos_provider, pos_credentials, location)
     VALUES ($1, $1, $2, '29ABCDE1234F1Z5', $3, $4, ST_SetSRID(ST_MakePoint(77.64, 12.97), 4326)) RETURNING id`,
    [`t-${randomUUID().slice(0, 8)}`, String(Math.floor(1e13 + Math.random() * 9e13)), opts.provider, JSON.stringify(stored)]);
  return rows[0].id;
}
```

```ts
// tests/pos/credentials.test.ts (Decision 6)
import { encryptCredentials, decryptCredentials, loadPosKey } from '@/lib/pos/credentials';

const key = Buffer.alloc(32, 7);
const secret = { webhook_secret: 'whsec-plain-1', api_key: 'key-plain-1' };

test('stored value is not plaintext and round-trips', () => {
  const stored = encryptCredentials(secret, key);
  const text = JSON.stringify(stored);
  expect(Object.keys(stored).sort()).toEqual(['ciphertext', 'iv', 'tag']);
  expect(text).not.toContain('whsec-plain-1');
  expect(text).not.toContain('webhook_secret');
  expect(decryptCredentials(stored, key)).toEqual(secret);
});

test('a tampered ciphertext fails authentication', () => {
  const stored = encryptCredentials(secret, key);
  const c = Buffer.from(stored.ciphertext, 'base64');
  c[0] ^= 1;
  expect(() => decryptCredentials({ ...stored, ciphertext: c.toString('base64') }, key)).toThrow();
});

test('loadPosKey rejects a missing key or one that is not 32 bytes of base64', () => {
  expect(() => loadPosKey({})).toThrow(/POS_CREDENTIALS_KEY/);
  expect(() => loadPosKey({ POS_CREDENTIALS_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/32 bytes/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/pos/upsert.test.ts`
Expected: FAIL, "Cannot find module '@/lib/db/integration'". Start the PostGIS container from Plan 01 first.

- [ ] **Step 3: Implement**

- `db/migrations/005_integrations.sql`: as above.
- `lib/pos/credentials.ts`: the three functions in Interfaces. Use `createCipheriv('aes-256-gcm', key, iv)` and `getAuthTag()`. Store `{ iv, tag, ciphertext }` as base64 strings in the JSONB column. This module is imported only by server code (`lib/pos/*`, route handlers, jobs), never by client components.
- `tests/setup/pos-key.ts`: sets `process.env.POS_CREDENTIALS_KEY` to a fixed 32-byte base64 test value when it is unset. Production keys are not in this file.
- `.env.example`: add `POS_CREDENTIALS_KEY=`. Generate a real value with `openssl rand -base64 32`, and keep it only in the server's git-ignored `.env`.
- `lib/db/integration.ts`: `asIntegration` follows the `asRole` pattern from Plan 01, using `SET LOCAL ROLE food_app` and `set_config('app.integration_restaurant_id', $1, true)`.
- `lib/pos/upsert.ts`:
  - Empty-menu guard first. If `opts.full && items.length === 0`, throw `EmptyMenuError` before any SQL runs.
  - For each category name, `ensureCategory`: insert with `WHERE NOT EXISTS` on `(restaurant_id, name)`, otherwise select the existing id. Station comes from the first item of that category.
  - For each item, `INSERT (restaurant_id, pos_item_code, name, base_price, is_in_stock, category_id, dietary) ... ON CONFLICT (restaurant_id, pos_item_code) DO UPDATE SET name, base_price, is_in_stock`. The `DO UPDATE` list never includes `dietary`, `description`, `spice_level`, `preparation_time_minutes`, or `gst_rate` (shared decision 7). On insert, `dietary` is the placeholder `'non_veg'` because the column is `NOT NULL` and a POS payload cannot supply it. The owner must set the real value before the item is marked for guests. Count inserts versus updates with `(xmax = 0) AS inserted` in the `RETURNING` clause.
  - When `opts.full` is `true`: `UPDATE menu_items SET is_in_stock = false WHERE restaurant_id = $1 AND pos_item_code <> ALL($2::text[]) AND is_in_stock = true`, and return the row count as `markedOutOfStock`.
- `lib/pos/upsert.ts` `setStock`: `UPDATE menu_items SET is_in_stock = $3 WHERE restaurant_id = $1 AND pos_item_code = $2`, returning `rowCount`.

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/pos/upsert.test.ts tests/pos/credentials.test.ts`
Expected: upsert 6 passed, credentials 3 passed.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/005_integrations.sql lib/db/integration.ts lib/pos/upsert.ts lib/pos/credentials.ts tests/helpers/db.ts tests/setup/pos-key.ts tests/pos/upsert.test.ts tests/pos/credentials.test.ts .env.example
git commit -m "feat: add idempotent menu upsert keyed by pos_item_code with integration RLS

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 6: POS Webhook Route

**Files:**
- Create: `app/api/pos/[provider]/[restaurantId]/route.ts`
- Test: `tests/api/pos-webhook.test.ts`

**Interfaces:**
- Consumes: `getPosAdapter` (Task 2, 3, 4); `getPool` (Plan 01); `asIntegration`, `upsertMenu`, `setStock`, `decryptCredentials`, `loadPosKey` (Task 5); `PosPayloadError` (Task 2); `createRestaurant` (Task 5 helper).
- Produces: `POST /api/pos/[provider]/[restaurantId]` with the response contract:
  - `404 {"error":"not_found"}`: unknown provider, malformed UUID, unknown restaurant, or provider mismatch with `restaurant_nodes.pos_provider`.
  - `401 {"error":"unauthorized"}`: missing secret or failed signature. No write.
  - `400 {"error":"invalid_payload"}`: signature valid but parse failed.
  - `200 {"ok":true,"result":"menu"|"stock"|"ignored", ...counts}`.
- Ordering (fixed): read restaurant → verify signature → parse → write, all in one `asIntegration` transaction, so a failure rolls back.

Route handler (fixed logic):

```ts
export async function POST(req: Request, ctx: { params: Promise<{ provider: string; restaurantId: string }> }) {
  const { provider, restaurantId } = await ctx.params;
  const adapter = getPosAdapter(provider);
  if (!adapter || !z.string().uuid().safeParse(restaurantId).success) return json(404, { error: 'not_found' });

  const rawBody = await req.text();
  const headers = Object.fromEntries(req.headers.entries());

  try {
    const body = await asIntegration(getPool(), restaurantId, async (c) => {
      const { rows } = await c.query(
        `SELECT pos_provider, pos_credentials FROM restaurant_nodes WHERE id = $1`, [restaurantId]);
      if (rows.length === 0 || rows[0].pos_provider !== provider) return { status: 404, body: { error: 'not_found' } };
      // Decrypt only after the provider check, and only in this server process (shared decision 6).
      const creds = decryptCredentials(rows[0].pos_credentials, loadPosKey());
      const secret = typeof creds.webhook_secret === 'string' ? creds.webhook_secret : '';
      if (!adapter.verifySignature({ rawBody, headers, secret })) {
        return { status: 401, body: { error: 'unauthorized' } };
      }
      const event = adapter.parseWebhook(rawBody, {
        expectedLocationId: typeof creds.location_id === 'string' ? creds.location_id : undefined,
      });
      if (event.kind === 'menu') await upsertMenu(c, restaurantId, event.items, { full: event.full });
      if (event.kind === 'stock') await setStock(c, restaurantId, event.pos_item_code, event.is_in_stock);
      return { status: 200, body: { ok: true, result: event.kind } };
    });
    return json(body.status, body.body);
  } catch (e) {
    if (e instanceof PosPayloadError) return json(400, { error: 'invalid_payload' });
    throw e;
  }
}
```

The `menu` event from a partial push uses `full: false`; a `menu.sync` event sets `full: true`. Add `full: boolean` to the `{ kind: 'menu' }` variant in `PosEvent` in Task 2's types, with each adapter setting it from the event name. Update Task 2 interface block accordingly: `{ kind: 'menu'; items: MenuItemUpsert[]; full: boolean }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/api/pos-webhook.test.ts
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getPool, runMigrations } from '@/lib/db/client';
import { POST } from '@/app/api/pos/[provider]/[restaurantId]/route';
import { createRestaurant } from '../helpers/db';

const pool = getPool();
beforeAll(async () => { await runMigrations(pool); });
afterAll(async () => { await pool.end(); });

const raw = (f: string) => readFileSync(path.join(__dirname, '../fixtures/pos', f), 'utf8');
const menuBody = raw('petpooja-menu.json');
const stockBody = raw('petpooja-stock-webhook.json');

function call(provider: string, rid: string, body: string, sig?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sig !== undefined) headers['x-petpooja-signature'] = sig;
  const req = new Request(`http://localhost:3000/api/pos/${provider}/${rid}`, { method: 'POST', headers, body });
  return POST(req, { params: Promise.resolve({ provider, restaurantId: rid }) });
}

const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('hex');

test('valid signed menu sync upserts rows and returns 200', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: { webhook_secret: 's1' } });
  const res = await call('petpooja', rid, menuBody, sign(menuBody, 's1'));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, result: 'menu' });
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1', [rid]);
  expect(rows[0].n).toBe(4);
});

test('forged signature returns 401 and changes no rows (Review Focus 1)', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: { webhook_secret: 's1' } });
  await call('petpooja', rid, menuBody, sign(menuBody, 's1'));
  const before = await pool.query('SELECT is_in_stock FROM menu_items WHERE restaurant_id = $1 ORDER BY pos_item_code', [rid]);
  const res = await call('petpooja', rid, stockBody, sign(stockBody, 'attacker'));
  expect(res.status).toBe(401);
  const after = await pool.query('SELECT is_in_stock FROM menu_items WHERE restaurant_id = $1 ORDER BY pos_item_code', [rid]);
  expect(after.rows).toEqual(before.rows);
});

test('missing signature returns 401 even for a restaurant with no secret configured', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: {} });
  expect((await call('petpooja', rid, stockBody)).status).toBe(401);
});

test('unknown restaurant or provider mismatch returns 404', async () => {
  const rid = await createRestaurant(pool, { provider: 'restroworks', credentials: { webhook_secret: 's1' } });
  expect((await call('petpooja', rid, stockBody, sign(stockBody, 's1'))).status).toBe(404);
  expect((await call('petpooja', '00000000-0000-0000-0000-000000000000', stockBody, sign(stockBody, 's1'))).status).toBe(404);
  expect((await call('petpooja', 'not-a-uuid', stockBody, sign(stockBody, 's1'))).status).toBe(404);
});

test('valid signature with a malformed payload returns 400', async () => {
  const rid = await createRestaurant(pool, { provider: 'petpooja', credentials: { webhook_secret: 's1' } });
  const bad = '{"event":"menu.sync"}';
  expect((await call('petpooja', rid, bad, sign(bad, 's1'))).status).toBe(400);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/api/pos-webhook.test.ts`
Expected: FAIL, "Cannot find module '@/app/api/pos/[provider]/[restaurantId]/route'".

- [ ] **Step 4 note:** Step 3 (implementation) is the fixed logic block above plus `json()` helper. Apply the `full` flag change to Task 2's `PosEvent` type and to each adapter's `menu` event (`item.stock` and inline menu events in Tasks 2–4 are unchanged apart from carrying `full`).

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/api tests/pos`
Expected: all pass, including the 401 test that proves no row changed.

- [ ] **Step 5: Commit**

```bash
git add app/api/pos tests/api/pos-webhook.test.ts lib/pos
git commit -m "feat: add POS webhook route that verifies signatures before any write

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Nightly Full Menu Sync and systemd Timer

**Files:**
- Create: `lib/pos/nightly-sync.ts`, `lib/db/sync.ts`, `scripts/pos-nightly-sync.ts`, `deploy/systemd/food-pos-sync.service`, `deploy/systemd/food-pos-sync.timer`
- Modify: `tsconfig.scripts.json` (add `lib/pos/**`, `lib/db/**`, and `lib/webhooks/**` to `include`)
- Test: `tests/pos/nightly-sync.test.ts`

**Interfaces:**
- Consumes: `getPosAdapter` (Task 2–4); `upsertMenu`, `EmptyMenuError` (Task 5); `decryptCredentials`, `loadPosKey` (Task 5); role `food_sync` (created NOLOGIN, BYPASSRLS, in `001_init.sql`; Plan 01 grants it table privileges).
- Produces (`lib/db/sync.ts`):
  - `getSyncPool(): pg.Pool`: a pool built from `SYNC_DATABASE_URL`. Throws if it is unset. Nothing in this plan calls `getPool()` for the nightly job.
  - `withSyncTx<T>(pool: pg.Pool, restaurantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T>`: one transaction. First it asserts `SELECT current_user = 'food_sync'` and throws `Error('sync writes require the food_sync role')` otherwise. It does not switch roles, because `food_sync` already bypasses RLS. The explicit `restaurant_id` filter in each write keeps tenants apart.
- Produces:
  - `export type MenuFetcher = (r: { id: string; pos_provider: PosProvider; pos_credentials: Record<string, unknown> }) => Promise<unknown>`
  - `export function httpMenuFetcher(opts: { fetchImpl?: typeof fetch }): MenuFetcher`. Calls `${pos_credentials.api_base_url}/menu` with `Authorization: Bearer ${pos_credentials.api_key}`. Tests inject `fetchImpl`. Production uses the global `fetch` default.
  - `export async function runNightlyMenuSync(pool: pg.Pool, fetcher: MenuFetcher, now?: Date): Promise<{ synced: number; failed: { restaurantId: string; error: string }[] }>`. Each restaurant runs in its own transaction; one failure does not stop the others.
  - Script `scripts/pos-nightly-sync.ts`: calls `runNightlyMenuSync(getSyncPool(), httpMenuFetcher({}))`, prints the summary as JSON, exits `1` if `failed.length > 0`. It never calls `getPool()`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/pos/nightly-sync.test.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getPool, runMigrations } from '@/lib/db/client';
import { runNightlyMenuSync, httpMenuFetcher } from '@/lib/pos/nightly-sync';
import { getSyncPool, withSyncTx } from '@/lib/db/sync';
import { createRestaurant } from '../helpers/db';

const owner = getPool();    // food_admin (BYPASSRLS, not superuser): migrations, seed rows, and fixtures only
const pool = getSyncPool(); // food_sync: the only pool the nightly sync uses
beforeAll(async () => {
  await runMigrations(owner);
  await owner.query(`ALTER ROLE food_sync LOGIN PASSWORD 'test-sync-only'`); // test database only
});
afterAll(async () => { await pool.end(); await owner.end(); });

const menu = readFileSync(path.join(__dirname, '../fixtures/pos/petpooja-menu.json'), 'utf8');
const ok = (body: string) => (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

test('syncs every pos-connected restaurant and skips direct ones', async () => {
  const a = await createRestaurant(owner, { provider: 'petpooja', credentials: { api_base_url: 'https://pp.test', api_key: 'k' } });
  const direct = await createRestaurant(owner, { provider: 'direct', credentials: {} });
  const fetched: string[] = [];
  const fetcher = httpMenuFetcher({ fetchImpl: (async (url: string) => { fetched.push(String(url)); return new Response(menu); }) as unknown as typeof fetch });
  const summary = await runNightlyMenuSync(pool, fetcher);
  expect(summary.failed.filter((f) => f.restaurantId === direct)).toEqual([]);
  expect(fetched.some((u) => u.startsWith('https://pp.test/menu'))).toBe(true);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1', [a]);
  expect(rows[0].n).toBe(4);
  const direct_rows = await pool.query('SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1', [direct]);
  expect(direct_rows.rows[0].n).toBe(0);
});

test('one failing restaurant is reported and does not stop the others', async () => {
  const bad = await createRestaurant(owner, { provider: 'petpooja', credentials: { api_base_url: 'https://bad.test', api_key: 'k' } });
  const good = await createRestaurant(owner, { provider: 'petpooja', credentials: { api_base_url: 'https://good.test', api_key: 'k' } });
  const fetcher = httpMenuFetcher({ fetchImpl: (async (url: string) => {
    if (String(url).includes('bad.test')) return new Response('boom', { status: 500 });
    return new Response(menu);
  }) as unknown as typeof fetch });
  const summary = await runNightlyMenuSync(pool, fetcher);
  expect(summary.failed.map((f) => f.restaurantId)).toContain(bad);
  expect(summary.failed.map((f) => f.restaurantId)).not.toContain(good);
});

test('an empty provider menu fails that restaurant and writes nothing (Review Focus 4)', async () => {
  const empty = await createRestaurant(owner, { provider: 'petpooja', credentials: { api_base_url: 'https://empty.test', api_key: 'k' } });
  await runNightlyMenuSync(pool, httpMenuFetcher({ fetchImpl: (async () => new Response(menu)) as unknown as typeof fetch }));
  const before = await pool.query('SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1', [empty]);
  const summary = await runNightlyMenuSync(pool, httpMenuFetcher({ fetchImpl: (async () => new Response(JSON.stringify({ restID: 'x', categories: [] }))) as unknown as typeof fetch }));
  expect(summary.failed.map((f) => f.restaurantId)).toContain(empty);
  const after = await pool.query('SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1', [empty]);
  expect(after.rows[0].n).toBe(before.rows[0].n);
});

test('the sync runs as food_sync (BYPASSRLS) and refuses any other role (Decision 2)', async () => {
  const { rows } = await pool.query(
    `SELECT current_user AS u, (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'food_sync') AS bypass`);
  expect(rows[0]).toEqual({ u: 'food_sync', bypass: true });
  await expect(withSyncTx(owner, '00000000-0000-0000-0000-000000000000', async () => 1))
    .rejects.toThrow(/food_sync/);
});
```

Note for the implementer: the third test's first call syncs the empty restaurant with a valid menu so it has rows; the second call uses an empty menu. Adjust the first call's fetcher so it returns the valid menu only for `empty.test` if the other restaurants also need it, or accept that all restaurants get the empty menu on the second call. The assertions above hold either way.

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/pos/nightly-sync.test.ts`
Expected: FAIL, "Cannot find module '@/lib/pos/nightly-sync'".

- [ ] **Step 3: Implement**

- `lib/db/sync.ts`: `getSyncPool` and `withSyncTx` as in Interfaces. `getSyncPool` reads `SYNC_DATABASE_URL` and does not fall back to `DATABASE_URL`.
- `lib/pos/nightly-sync.ts`: `runNightlyMenuSync` runs `SELECT id, pos_provider, pos_credentials FROM restaurant_nodes WHERE pos_provider <> 'direct'` through the `food_sync` pool. For each row: `decryptCredentials(row.pos_credentials, loadPosKey())` (server process only), `getPosAdapter(pos_provider)`, `fetcher({ ...row, pos_credentials: decrypted })`, `adapter.mapMenu(body)`, then `withSyncTx(pool, id, c => upsertMenu(c, id, items, { full: true }))` in its own transaction. Catch per restaurant; record `{ restaurantId, error: message }`. Never include decrypted credentials in the error. A `PosPayloadError` or `EmptyMenuError` counts as a failure.
- `httpMenuFetcher`: `fetchImpl(url, { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15_000) })`. Non-2xx throws. Returns `res.json()`.
- `scripts/pos-nightly-sync.ts`: thin wrapper as described in Interfaces.
- `deploy/systemd/food-pos-sync.service`:

```ini
[Unit]
Description=Food OS nightly POS menu sync
Wants=docker.service
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/home/ubuntu/docker
ExecStart=/usr/bin/docker compose exec -T app node dist-scripts/scripts/pos-nightly-sync.js
```

- `deploy/systemd/food-pos-sync.timer`:

```ini
[Unit]
Description=Run Food OS POS menu sync nightly at 03:30 IST

[Timer]
OnCalendar=*-*-* 03:30:00 Asia/Kolkata
Persistent=true
Unit=food-pos-sync.service

[Install]
WantedBy=timers.target
```

- Install on EC2 (operator steps, recorded in the plan only): `sudo cp deploy/systemd/food-pos-sync.* /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now food-pos-sync.timer`.
- Before the first run (operator steps, Plan 07 ops): set a password for `food_sync` from the secret store (`ALTER ROLE food_sync LOGIN PASSWORD '<secret>'`). Put `SYNC_DATABASE_URL=postgres://food_sync:<secret>@db:5432/food_os` in the server's git-ignored `.env`, then restart the `app` container. The unit file holds no secret. Also set `POS_CREDENTIALS_KEY` in `.env`. The key is required to read stored credentials.

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL=postgres://food:change-me@localhost:5432/food_os npx vitest run tests/pos/nightly-sync.test.ts && systemd-analyze calendar "*-*-* 03:30:00 Asia/Kolkata" && systemd-analyze verify deploy/systemd/food-pos-sync.service deploy/systemd/food-pos-sync.timer`
Expected: 4 tests pass. `systemd-analyze calendar` prints the next elapse time. `systemd-analyze verify` exits 0 (run on a host with systemd; skip with a note on macOS or CI without systemd).

- [ ] **Step 5: Commit**

```bash
git add lib/pos/nightly-sync.ts lib/db/sync.ts scripts/pos-nightly-sync.ts deploy/systemd tsconfig.scripts.json tests/pos/nightly-sync.test.ts
git commit -m "feat: add nightly full POS menu sync and systemd timer for EC2

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 8: ESC/POS Renderer

**Files:**
- Create: `lib/printing/escpos.ts`
- Test: `tests/printing/escpos.test.ts`

**Interfaces:**
- Consumes: none (pure).
- Produces:

```ts
export interface PrintableOrder {
  orderNumber: string;
  station: string;
  tableNumber?: string;
  placedAt: string;                       // ISO 8601, rendered as HH:MM in Asia/Kolkata
  items: { name: string; quantity: number; modifiers: string[] }[];
  notes?: string;
}
export const ESC_POS: { INIT: Buffer; BOLD_ON: Buffer; BOLD_OFF: Buffer; ALIGN_LEFT: Buffer; ALIGN_CENTER: Buffer; FEED_3: Buffer; CUT_PARTIAL: Buffer };
export function renderOrderTicket(order: PrintableOrder): Buffer;
```

Command bytes (fixed logic):

```ts
export const ESC_POS = {
  INIT: Buffer.from([0x1b, 0x40]),          // ESC @
  BOLD_ON: Buffer.from([0x1b, 0x45, 0x01]), // ESC E 1
  BOLD_OFF: Buffer.from([0x1b, 0x45, 0x00]),
  ALIGN_LEFT: Buffer.from([0x1b, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([0x1b, 0x61, 0x01]),
  FEED_3: Buffer.from([0x1b, 0x64, 0x03]),  // ESC d 3
  CUT_PARTIAL: Buffer.from([0x1d, 0x56, 0x42, 0x00]), // GS V 66 0
};
```

Text is encoded as ASCII. Any character above `0x7e` (and any control character other than LF) is replaced with `?`. Lines are terminated with LF (`0x0a`). The output is always: INIT, header block (center, bold "KITCHEN TICKET"), order number bold, table and station, time, item lines (`"<qty> x <name>"`, modifiers indented with two spaces), optional notes, FEED_3, CUT_PARTIAL.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/printing/escpos.test.ts
import { renderOrderTicket, ESC_POS, type PrintableOrder } from '@/lib/printing/escpos';

const order: PrintableOrder = {
  orderNumber: 'K-1042', station: 'Tandoor', tableNumber: 'T7', placedAt: '2026-11-03T12:30:00+05:30',
  items: [{ name: 'Butter Naan', quantity: 2, modifiers: ['extra butter'] }, { name: 'Dal Tadka', quantity: 1, modifiers: [] }],
  notes: 'less oil',
};

test('starts with INIT and ends with partial cut and feed', () => {
  const out = renderOrderTicket(order);
  expect(out.subarray(0, 2).equals(ESC_POS.INIT)).toBe(true);
  expect(out.subarray(out.length - 4).equals(ESC_POS.CUT_PARTIAL)).toBe(true);
  expect(out.indexOf(ESC_POS.FEED_3)).toBeGreaterThan(0);
});

test('emits bold on and off around the order number', () => {
  const out = renderOrderTicket(order);
  const at = out.indexOf(Buffer.from('K-1042'));
  expect(at).toBeGreaterThan(0);
  expect(out.subarray(0, at).lastIndexOf(ESC_POS.BOLD_ON)).toBeGreaterThan(-1);
  expect(out.subarray(at).indexOf(ESC_POS.BOLD_OFF)).toBeGreaterThan(0);
});

test('item lines, modifiers, table, station, and notes appear as text', () => {
  const text = renderOrderTicket(order).toString('latin1');
  expect(text).toContain('2 x Butter Naan\n');
  expect(text).toContain('  extra butter\n');
  expect(text).toContain('1 x Dal Tadka\n');
  expect(text).toContain('Table T7');
  expect(text).toContain('Tandoor');
  expect(text).toContain('less oil');
  expect(text).toContain('12:30');
});

test('replaces non-ASCII characters with ? and keeps the output deterministic', () => {
  const o = { ...order, items: [{ name: 'Paneer ₹ Tikka é', quantity: 1, modifiers: [] }] };
  const a = renderOrderTicket(o);
  expect(a.toString('latin1')).toContain('1 x Paneer ? Tikka ?');
  expect(a.equals(renderOrderTicket(o))).toBe(true);
});

test('omits the table line for delivery tickets', () => {
  const text = renderOrderTicket({ ...order, tableNumber: undefined }).toString('latin1');
  expect(text).not.toContain('Table');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/printing/escpos.test.ts`
Expected: FAIL, "Cannot find module '@/lib/printing/escpos'".

- [ ] **Step 3: Implement**

`lib/printing/escpos.ts` builds an array of `Buffer` chunks: `ESC_POS.INIT`, then `ALIGN_CENTER`, `BOLD_ON`, text `KITCHEN TICKET` line, `BOLD_OFF`, `ALIGN_LEFT`. Then bold order number. Then table line only when `tableNumber` is set, station line, time line. Then item lines and modifiers. Then notes if present. Then `FEED_3` and `CUT_PARTIAL`. `sanitize(s)` maps each char code `> 0x7e` or control (except none) to `?`. Time: `new Date(placedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })`. Use `Buffer.concat`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/printing/escpos.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/printing/escpos.ts tests/printing/escpos.test.ts
git commit -m "feat: add pure ESC/POS kitchen ticket renderer

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 9: TCP Printer Sender (Port 9100)

**Files:**
- Create: `lib/printing/sender.ts`
- Test: `tests/printing/sender.test.ts`

**Interfaces:**
- Consumes: `renderOrderTicket` output (Task 8) as `bytes: Buffer`.
- Produces:

```ts
export class PrinterTimeoutError extends Error {}
export class PrinterUnreachableError extends Error {}
export function sendToPrinter(opts: { host: string; port?: number; bytes: Buffer; timeoutMs?: number }): Promise<void>;
// port defaults to 9100; timeoutMs defaults to 3000; covers connect plus full write flush.
```

Validation: `host` must be a non-empty string without whitespace; throw `TypeError` otherwise. Port must be an integer 1–65535.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/printing/sender.test.ts
import net from 'node:net';
import { sendToPrinter, PrinterTimeoutError, PrinterUnreachableError } from '@/lib/printing/sender';

function listen(onConn: (s: net.Socket) => void): Promise<{ srv: net.Server; port: number }> {
  return new Promise((resolve) => {
    const srv = net.createServer(onConn).listen(0, '127.0.0.1', () =>
      resolve({ srv, port: (srv.address() as net.AddressInfo).port }));
  });
}

test('writes the exact bytes to the printer port and resolves', async () => {
  const received: Buffer[] = [];
  const { srv, port } = await listen((s) => s.on('data', (d) => received.push(d)));
  const bytes = Buffer.from([0x1b, 0x40, 0x41, 0x0a, 0x1d, 0x56, 0x42, 0x00]);
  await sendToPrinter({ host: '127.0.0.1', port, bytes, timeoutMs: 2000 });
  await new Promise((r) => setTimeout(r, 50));
  srv.close();
  expect(Buffer.concat(received).equals(bytes)).toBe(true);
});

test('rejects with PrinterTimeoutError when the printer stops reading', async () => {
  const { srv, port } = await listen((s) => s.pause());
  const bytes = Buffer.alloc(64 * 1024 * 1024, 0x41);
  await expect(sendToPrinter({ host: '127.0.0.1', port, bytes, timeoutMs: 300 })).rejects.toThrow(PrinterTimeoutError);
  srv.close();
});

test('rejects with PrinterUnreachableError when nothing listens on the port', async () => {
  const probe = await listen(() => {});
  const closedPort = probe.port;
  await new Promise<void>((r) => probe.srv.close(() => r()));
  await expect(sendToPrinter({ host: '127.0.0.1', port: closedPort, bytes: Buffer.from('x'), timeoutMs: 1000 }))
    .rejects.toThrow(PrinterUnreachableError);
});

test('rejects invalid host and port without opening a socket', async () => {
  await expect(sendToPrinter({ host: '', bytes: Buffer.from('x') })).rejects.toThrow(TypeError);
  await expect(sendToPrinter({ host: '127.0.0.1', port: 70000, bytes: Buffer.from('x') })).rejects.toThrow(TypeError);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/printing/sender.test.ts`
Expected: FAIL, "Cannot find module '@/lib/printing/sender'".

- [ ] **Step 3: Implement**

`lib/printing/sender.ts`: validate args. Create `net.createConnection({ host, port })`. Start one timer for `timeoutMs`; on fire, `socket.destroy()` and reject `PrinterTimeoutError`. On `error` before connect, reject `PrinterUnreachableError` with the original message. On `connect`, call `socket.end(bytes, cb)`; resolve when the callback fires with no error. Clear the timer on every settle path. Settle once (guard with a `done` flag). Never retry inside the sender; the caller (Plan 03) decides retries.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/printing/sender.test.ts`
Expected: 4 passed. The timeout test takes about 300 ms.

- [ ] **Step 5: Commit**

```bash
git add lib/printing/sender.ts tests/printing/sender.test.ts
git commit -m "feat: add ESC/POS TCP sender for port 9100 with timeout

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 10: ONDC Beckn Parser (on_search and on_select)

**Files:**
- Create: `lib/ondc/beckn.ts`, `tests/fixtures/ondc/on-search.json`, `tests/fixtures/ondc/on-select.json`
- Test: `tests/ondc/beckn.test.ts`

**Interfaces:**
- Consumes: `round2` from `lib/pricing.ts`; `LatLng` from `types/food-os.ts`.
- Produces:

```ts
export interface BecknContext { domain: string; action: string; transaction_id: string; message_id: string; bap_id?: string; bpp_id?: string; bpp_uri?: string; timestamp: string }
export interface CatalogItem { externalId: string; name: string; priceInr: number; available: boolean }
export interface CatalogProvider { source: 'ondc'; bppId: string; providerId: string; providerName: string; items: CatalogItem[] }
export interface BundleQuote { source: 'ondc'; bppId: string; providerId: string; totalPriceInr: number; currency: 'INR'; fulfillmentId: string | null; etaMinutes: number | null }
export class BecknParseError extends Error {}
export function parseOnSearch(envelope: unknown): CatalogProvider[];   // throws BecknParseError
export function parseOnSelect(envelope: unknown): BundleQuote;          // throws BecknParseError
```

Rules: `context.action` must be `on_search` or `on_select` respectively, else `BecknParseError`. Currency must be `INR`. Prices are Beckn strings (`"350.00"`) parsed with `Number` then `round2`; non-positive or non-finite prices throw. `bpp_id` comes from `context.bpp_id`.

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/ondc/on-search.json` (synthetic, shaped from public ONDC/Beckn documentation, paraphrased):

```json
{
  "_fixture": { "synthetic": true, "shaped_from": "public ONDC/Beckn documentation, paraphrased", "replace_with": "recorded sandbox response after ONDC sandbox onboarding" },
  "context": { "domain": "ONDC:RET10", "action": "on_search", "country": "IND", "city": "std:080", "core_version": "1.2.0", "bap_id": "bap.test.invalid", "bap_uri": "https://bap.test.invalid", "bpp_id": "bpp.test.invalid", "bpp_uri": "https://bpp.test.invalid", "transaction_id": "txn-1", "message_id": "msg-1", "timestamp": "2026-11-03T12:00:00.000Z" },
  "message": { "catalog": { "bpp/descriptor": { "name": "Test Kitchens" }, "bpp/providers": [
    { "id": "prov-blr-1", "descriptor": { "name": "Nagarjuna Koramangala" }, "items": [
      { "id": "item-biryani", "descriptor": { "name": "Chicken Biryani" }, "price": { "currency": "INR", "value": "349.00" }, "quantity": { "available": { "count": "12" } } },
      { "id": "item-raita", "descriptor": { "name": "Raita" }, "price": { "currency": "INR", "value": "60.50" }, "quantity": { "available": { "count": "0" } } }
    ] }
  ] } }
}
```

`tests/fixtures/ondc/on-select.json`: same `_fixture`; `context.action = "on_select"`, `bpp_id = "bpp.test.invalid"`; `message.order = { "provider": { "id": "prov-blr-1" }, "items": [ { "id": "item-biryani", "quantity": { "count": 2 } } ], "fulfillments": [ { "id": "ful-1", "tracking": false, "state": { "descriptor": { "code": "Serviceable" } }, "tags": [ { "code": "ETA", "list": [ { "code": "MINUTES", "value": "28" } ] } ] } ], "quote": { "price": { "currency": "INR", "value": "698.00" }, "breakup": [] } }`.

- [ ] **Step 2: Write the failing test**

```ts
// tests/ondc/beckn.test.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseOnSearch, parseOnSelect, BecknParseError } from '@/lib/ondc/beckn';

const load = (f: string) => JSON.parse(readFileSync(path.join(__dirname, '../fixtures/ondc', f), 'utf8'));
const search = load('on-search.json');
const select = load('on-select.json');

test('parseOnSearch returns providers with items priced in INR', () => {
  const [p] = parseOnSearch(search);
  expect(p).toMatchObject({ source: 'ondc', bppId: 'bpp.test.invalid', providerId: 'prov-blr-1', providerName: 'Nagarjuna Koramangala' });
  expect(p.items).toEqual([
    { externalId: 'item-biryani', name: 'Chicken Biryani', priceInr: 349, available: true },
    { externalId: 'item-raita', name: 'Raita', priceInr: 60.5, available: false },
  ]);
});

test('parseOnSelect returns the bundle quote in the internal shape', () => {
  expect(parseOnSelect(select)).toEqual({
    source: 'ondc', bppId: 'bpp.test.invalid', providerId: 'prov-blr-1',
    totalPriceInr: 698, currency: 'INR', fulfillmentId: 'ful-1', etaMinutes: 28,
  });
});

test('rejects an envelope whose action does not match the parser', () => {
  expect(() => parseOnSelect(search)).toThrow(BecknParseError);
  expect(() => parseOnSearch(select)).toThrow(BecknParseError);
});

test('rejects non-INR currency and non-positive prices', () => {
  const usd = structuredClone(select);
  usd.message.order.quote.price.currency = 'USD';
  expect(() => parseOnSelect(usd)).toThrow(BecknParseError);
  const zero = structuredClone(search);
  zero.message.catalog['bpp/providers'][0].items[0].price.value = '0';
  expect(() => parseOnSearch(zero)).toThrow(BecknParseError);
});

test('rejects a malformed envelope', () => {
  expect(() => parseOnSearch({})).toThrow(BecknParseError);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/ondc/beckn.test.ts`
Expected: FAIL, "Cannot find module '@/lib/ondc/beckn'".

- [ ] **Step 4: Implement**

`lib/ondc/beckn.ts`: Zod schemas for the envelope (`context` and `message`) with `.passthrough()` so unknown Beckn fields are ignored. `parseOnSearch` walks `message.catalog['bpp/providers']`. Availability is `quantity.available.count` greater than 0. `parseOnSelect` reads `message.order.quote.price`, `fulfillments[0]`, and the ETA tag (`tags[].list[]` where code is `MINUTES` inside tag `ETA`). A missing ETA gives `etaMinutes: null`. All Zod failures and money failures are rethrown as `BecknParseError`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/ondc/beckn.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/ondc/beckn.ts tests/ondc tests/fixtures/ondc
git commit -m "feat: add ONDC Beckn on_search and on_select parser from recorded fixtures

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 11: BAP Client Stub (Build Only)

**Files:**
- Create: `lib/ondc/bap-client.ts`
- Test: `tests/ondc/bap-client.test.ts`

**Interfaces:**
- Consumes: `BecknContext` (Task 10).
- Produces:

```ts
export interface BapConfig {
  bapId: string; bapUri: string; gatewayUrl: string;
  domain: 'ONDC:RET10'; country: 'IND'; city: 'std:080'; coreVersion: '1.2.0';
  liveSend: boolean;                       // default false; only Plan 07 ops may set true
}
export interface BecknEnvelope { context: BecknContext & Record<string, unknown>; message: Record<string, unknown> }
export function buildSearchRequest(cfg: BapConfig, p: { transactionId: string; messageId: string; timestamp: string; query: string; lat: number; lng: number }): BecknEnvelope;
export function buildSelectRequest(cfg: BapConfig, p: { transactionId: string; messageId: string; timestamp: string; bppId: string; providerId: string; items: { id: string; count: number }[]; lat: number; lng: number }): BecknEnvelope;
export class BapClient {
  constructor(cfg: BapConfig, fetchImpl?: typeof fetch);
  buildSearch(...): BecknEnvelope;           // same args as buildSearchRequest without cfg
  buildSelect(...): BecknEnvelope;
  send(envelope: BecknEnvelope): Promise<unknown>;   // throws NotEnabledError unless cfg.liveSend
}
export class NotEnabledError extends Error {}
```

Context fields: `domain`, `country`, `city`, `action` (`search` or `select`), `core_version`, `bap_id`, `bap_uri`, `transaction_id`, `message_id`, `timestamp`. Search intent: `message.intent.item.descriptor.name = query` and `message.intent.fulfillment.end.location.gps = "<lat>,<lng>"` (Beckn GPS string format, latitude first). Select: `message.order.provider.id`, `message.order.items`, and `message.order.fulfillments[0].end.location.gps`; `context.bpp_id` is set to `bppId`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ondc/bap-client.test.ts
import { BapClient, NotEnabledError, type BapConfig } from '@/lib/ondc/bap-client';

const cfg: BapConfig = {
  bapId: 'bap.food.test', bapUri: 'https://bap.food.test', gatewayUrl: 'https://gateway.ondc.test',
  domain: 'ONDC:RET10', country: 'IND', city: 'std:080', coreVersion: '1.2.0', liveSend: false,
};
const common = { transactionId: 't1', messageId: 'm1', timestamp: '2026-11-03T12:00:00.000Z' };

test('buildSearch produces a Beckn search envelope with GPS as lat,lng', () => {
  const fetchSpy = vi.fn();
  const client = new BapClient(cfg, fetchSpy as unknown as typeof fetch);
  const env = client.buildSearch({ ...common, query: 'biryani', lat: 12.9352, lng: 77.6245 });
  expect(env.context).toMatchObject({ domain: 'ONDC:RET10', action: 'search', core_version: '1.2.0', bap_id: 'bap.food.test', transaction_id: 't1' });
  expect((env.message as any).intent.item.descriptor.name).toBe('biryani');
  expect((env.message as any).intent.fulfillment.end.location.gps).toBe('12.9352,77.6245');
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('buildSelect carries provider, items, and bpp_id', () => {
  const env = new BapClient(cfg).buildSelect({ ...common, bppId: 'bpp.test', providerId: 'prov-1', items: [{ id: 'item-1', count: 2 }], lat: 12.93, lng: 77.62 });
  expect(env.context.bpp_id).toBe('bpp.test');
  expect((env.message as any).order.items).toEqual([{ id: 'item-1', quantity: { count: 2 } }]);
  expect((env.message as any).order.provider.id).toBe('prov-1');
});

test('send is refused and never touches the network while liveSend is false', async () => {
  const fetchSpy = vi.fn();
  const client = new BapClient(cfg, fetchSpy as unknown as typeof fetch);
  const env = client.buildSearch({ ...common, query: 'x', lat: 12.9, lng: 77.6 });
  await expect(client.send(env)).rejects.toThrow(NotEnabledError);
  expect(fetchSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ondc/bap-client.test.ts`
Expected: FAIL, "Cannot find module '@/lib/ondc/bap-client'".

- [ ] **Step 3: Implement**

`lib/ondc/bap-client.ts`: pure builders plus `BapClient`. `send` checks `cfg.liveSend` first and throws `NotEnabledError('ONDC live send is disabled until onboarding')`. When enabled, it POSTs JSON to `${gatewayUrl}/${action}` through the injected `fetchImpl`, with a 15-second `AbortSignal.timeout`. Tests never enable it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/ondc/bap-client.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/ondc/bap-client.ts tests/ondc/bap-client.test.ts
git commit -m "feat: add ONDC BAP request builders with live send disabled

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 12: 3PL Dispatch Interface, Fake, and Sandbox Adapters

**Files:**
- Create: `lib/dispatch/types.ts`, `lib/dispatch/http.ts`, `lib/dispatch/fake.ts`, `lib/dispatch/providers/shadowfax.ts`, `lib/dispatch/providers/rapido.ts`, `lib/dispatch/providers/dunzo.ts`, `lib/dispatch/factory.ts`
- Create: `tests/fixtures/3pl/shadowfax-create-task.json`, `tests/fixtures/3pl/rapido-create-task.json`, `tests/fixtures/3pl/dunzo-create-task.json`
- Test: `tests/dispatch/adapters.test.ts`

**Interfaces:**
- Consumes: `LatLng` from `types/food-os.ts`.
- Produces (this plan defines the shared 3PL interface, `DispatchAdapter`, per shared decision 5; Plan 02 must adopt it, see the Dependency note):

```ts
// lib/dispatch/types.ts
export type ThreePlProvider = 'shadowfax' | 'rapido' | 'dunzo';
export type DispatchStatus = 'created' | 'assigned' | 'picked_up' | 'delivered' | 'cancelled' | 'failed';
export interface DispatchPoint extends LatLng { address: string }
export interface DispatchTaskRequest { deliveryId: string; pickup: DispatchPoint; dropoff: DispatchPoint; readyAt: string; orderValueInr: number }
export interface DispatchTask { provider: ThreePlProvider; providerTaskId: string; status: DispatchStatus; etaMinutes: number | null }
export interface DispatchAdapter {
  readonly provider: ThreePlProvider;
  createTask(req: DispatchTaskRequest): Promise<DispatchTask>;
  getTask(providerTaskId: string): Promise<DispatchTask>;
  cancelTask(providerTaskId: string): Promise<void>;
}
export interface SandboxConfig { mode: 'sandbox' | 'live'; baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }

// lib/dispatch/fake.ts
export class FakeDispatchAdapter implements DispatchAdapter { constructor(provider: ThreePlProvider); failNextCreate(err?: Error): void; /* in-memory tasks */ }

// lib/dispatch/factory.ts
export function createDispatchAdapter(provider: ThreePlProvider, cfg: SandboxConfig): DispatchAdapter;
// throws Error('live dispatch is not enabled in Plan 06') when cfg.mode === 'live'
```

Provider adapters: `class ShadowfaxAdapter`, `class RapidoAdapter`, `class DunzoAdapter`, each with constructor `(cfg: SandboxConfig)` and exported pure functions `toCreateTaskBody(req)` and `fromCreateTaskResponse(json)`. All three call the same `fetchImpl` (default: global `fetch`) against `${baseUrl}` with `authorization: Bearer ${apiKey}`. `ASSUMED` endpoints: `POST /v1/tasks`, `GET /v1/tasks/{id}`, `POST /v1/tasks/{id}/cancel` (VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING, for each provider).

- [ ] **Step 1: Write the fixtures**

Each `tests/fixtures/3pl/<provider>-create-task.json` has the `_fixture` block and a response body shaped like `{ "id": "<provider>-task-001", "state": "ASSIGNED", "eta_minutes": 14 }` (Rapido: `"task_id"` and `"status": "assigned"`; Dunzo: `"task": { "id": "...", "state": "ASSIGNED", "eta": 14 }`). The three shapes differ on purpose so each adapter's mapping is tested separately.

- [ ] **Step 2: Write the failing test**

```ts
// tests/dispatch/adapters.test.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ShadowfaxAdapter, toCreateTaskBody as sfBody } from '@/lib/dispatch/providers/shadowfax';
import { RapidoAdapter } from '@/lib/dispatch/providers/rapido';
import { DunzoAdapter } from '@/lib/dispatch/providers/dunzo';
import { createDispatchAdapter } from '@/lib/dispatch/factory';
import { FakeDispatchAdapter } from '@/lib/dispatch/fake';
import type { DispatchTaskRequest } from '@/lib/dispatch/types';

const fx = (p: string) => JSON.parse(readFileSync(path.join(__dirname, '../fixtures/3pl', `${p}-create-task.json`), 'utf8'));
const req: DispatchTaskRequest = {
  deliveryId: 'd-1',
  pickup: { lat: 12.9352, lng: 77.6245, address: 'Koramangala 5th Block' },
  dropoff: { lat: 12.9116, lng: 77.6389, address: 'HSR Sector 2' },
  readyAt: '2026-11-03T12:20:00.000Z', orderValueInr: 698,
};

function fakeFetch(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status: 200 }); }) as unknown as typeof fetch;
  return { f, calls };
}
const sandbox = (f: typeof fetch) => ({ mode: 'sandbox' as const, baseUrl: 'https://sandbox.shadowfax.test', apiKey: 'k', fetchImpl: f });

test('shadowfax maps the request body and the response into DispatchTask', async () => {
  const { f, calls } = fakeFetch(fx('shadowfax'));
  const task = await new ShadowfaxAdapter(sandbox(f)).createTask(req);
  expect(task).toEqual({ provider: 'shadowfax', providerTaskId: 'shadowfax-task-001', status: 'assigned', etaMinutes: 14 });
  expect(calls[0].url).toBe('https://sandbox.shadowfax.test/v1/tasks');
  expect(JSON.parse(String(calls[0].init.body))).toEqual(sfBody(req));
  expect(sfBody(req).pickup).toMatchObject({ latitude: 12.9352, longitude: 77.6245 });
});

test('rapido maps its different response shape', async () => {
  const { f } = fakeFetch(fx('rapido'));
  const task = await new RapidoAdapter({ ...sandbox(f), baseUrl: 'https://sandbox.rapido.test' }).createTask(req);
  expect(task).toMatchObject({ provider: 'rapido', providerTaskId: 'rapido-task-001', status: 'assigned', etaMinutes: 14 });
});

test('dunzo maps its nested response shape', async () => {
  const { f } = fakeFetch(fx('dunzo'));
  const task = await new DunzoAdapter({ ...sandbox(f), baseUrl: 'https://sandbox.dunzo.test' }).createTask(req);
  expect(task).toMatchObject({ provider: 'dunzo', providerTaskId: 'dunzo-task-001', status: 'assigned', etaMinutes: 14 });
});

test('live mode is refused in this plan', () => {
  expect(() => createDispatchAdapter('shadowfax', { mode: 'live', baseUrl: 'https://x.test', apiKey: 'k' }))
    .toThrow(/not enabled in Plan 06/);
});

test('fake adapter round-trips a task and can simulate a failed create', async () => {
  const fake = new FakeDispatchAdapter('rapido');
  const t = await fake.createTask(req);
  expect(await fake.getTask(t.providerTaskId)).toMatchObject({ status: 'created' });
  await fake.cancelTask(t.providerTaskId);
  expect((await fake.getTask(t.providerTaskId)).status).toBe('cancelled');
  fake.failNextCreate(new Error('3pl down'));
  await expect(fake.createTask(req)).rejects.toThrow('3pl down');
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/dispatch/adapters.test.ts`
Expected: FAIL, "Cannot find module '@/lib/dispatch/providers/shadowfax'".

- [ ] **Step 4: Implement**

- `lib/dispatch/types.ts`: as in Interfaces.
- Each provider file: `toCreateTaskBody(req)` returns the provider-shaped body (Shadowfax: `pickup`/`drop` with `latitude`/`longitude`, `order_value`; Rapido and Dunzo use their own field names, documented in the file as `ASSUMED`; VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING). `fromCreateTaskResponse(json)` maps the provider's status vocabulary to `DispatchStatus`, with unknown states mapped to `created`. Each adapter's `createTask`, `getTask`, `cancelTask` go through a shared `request()` helper in `lib/dispatch/http.ts` that adds the bearer header and throws on non-2xx.
- `lib/dispatch/fake.ts`: a `Map` of tasks, sequential ids `fake-<provider>-<n>`, `failNextCreate` throws once.
- `lib/dispatch/factory.ts`: rejects `mode: 'live'`, otherwise constructs the matching adapter.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/dispatch/adapters.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/dispatch tests/dispatch tests/fixtures/3pl
git commit -m "feat: add 3PL dispatch interface with Shadowfax, Rapido, Dunzo sandbox adapters

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Payment Provider Interface, Razorpay and Cashfree Adapters

**Files:**
- Create: `lib/payments/types.ts`, `lib/payments/upi.ts`, `lib/payments/razorpay.ts`, `lib/payments/cashfree.ts`
- Create: `tests/fixtures/payments/razorpay-order.json`, `tests/fixtures/payments/razorpay-payment-captured.json`, `tests/fixtures/payments/cashfree-order.json`, `tests/fixtures/payments/cashfree-payment-success.json`
- Test: `tests/payments/providers.test.ts`

**Interfaces:**
- Consumes: `round2` from `lib/pricing.ts`; `verifyHmac` from `lib/webhooks/hmac.ts`.
- Settlement boundary (shared decision 8): this task produces provider adapters only. It adds no HTTP route and writes no `order_refs` row and no `settled_at`. Plan 05 owns the payment webhook route and the settlement write. Plan 05's verifier path calls `verifyWebhook` before any state change, and that path is the only writer of `settled_at`.
- Produces:

```ts
// lib/payments/types.ts
export type PaymentProviderName = 'razorpay' | 'cashfree';
export interface UpiIntentRequest { orderRef: string; amountInr: number; description: string }
export interface UpiIntent { provider: PaymentProviderName; providerOrderId: string; amountInr: number; upiIntentUrl: string }
export interface VerifiedPaymentEvent {
  provider: PaymentProviderName; providerEventId: string;
  eventType: 'payment.captured' | 'payment.failed' | 'ignored';
  providerOrderId: string; amountInr: number;
}
export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createUpiIntent(req: UpiIntentRequest): Promise<UpiIntent>;          // throws on any create failure
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>, nowMs?: number): VerifiedPaymentEvent; // throws WebhookSignatureError before parsing
}
export class WebhookSignatureError extends Error {}
export class PaymentCreateError extends Error {}

// lib/payments/upi.ts
export function buildUpiIntentUrl(p: { vpa: string; payeeName: string; amountInr: number; note: string; txnRef: string }): string;
// returns upi://pay?pa=...&pn=...&am=350.00&tn=...&tr=...&cu=INR (all values encodeURIComponent)

// lib/payments/razorpay.ts
export class RazorpayProvider implements PaymentProvider { constructor(cfg: { keyId: string; keySecret: string; webhookSecret: string; merchantVpa: string; payeeName: string; fetchImpl?: typeof fetch; baseUrl?: string }) }
// baseUrl defaults to https://api.razorpay.com (VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING); tests always inject fetchImpl

// lib/payments/cashfree.ts
export class CashfreeProvider implements PaymentProvider { constructor(cfg: { clientId: string; clientSecret: string; webhookSecret: string; merchantVpa: string; payeeName: string; fetchImpl?: typeof fetch; baseUrl?: string }) }
// baseUrl defaults to https://sandbox.cashfree.com (sandbox until ops flips it) (VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING)
```

Provider details (`ASSUMED` shapes, flagged in code):
- Razorpay create: `POST {baseUrl}/v1/orders` (VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: endpoint path), basic auth `keyId:keySecret`, body `{ amount: Math.round(amountInr*100), currency: 'INR', receipt: orderRef }`. Response `id` becomes `providerOrderId`. Webhook: header `x-razorpay-signature` (VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: header name) is hex HMAC-SHA256 over the raw body with `webhookSecret`. Event id from header `x-razorpay-event-id` (VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: header name). `event: "payment.captured"` maps to `payment.captured` with `amountInr = payload.payment.entity.amount / 100` and `providerOrderId = payload.payment.entity.order_id`. `payment.failed` maps to `payment.failed`; other events map to `ignored`.
- Cashfree create: `POST {baseUrl}/pg/orders`, headers `x-client-id`, `x-client-secret`, `x-api-version: 2023-08-01` (VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: endpoint path and API version), body `{ order_id: orderRef, order_amount: round2(amountInr), order_currency: 'INR', customer_details: { customer_id: orderRef, customer_phone: '9999999999' } }`. Response `order_id` becomes `providerOrderId`. The phone value is a placeholder and must be replaced with the diner's verified phone in Plan 05. Webhook: header `x-webhook-signature` is base64 HMAC-SHA256 over `x-webhook-timestamp` concatenated with the raw body, using `webhookSecret` (VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING: both header names and the signed-string format). Timestamp unit: epoch milliseconds, compared to `nowMs` without conversion (code fixed in d411f82; this plan text previously said seconds). The production value is NOT VERIFIED until a live webhook is checked. Reject when `|nowMs - timestamp| > 300000` (5 minutes). `type: "PAYMENT_SUCCESS_WEBHOOK"` maps to `payment.captured`; `PAYMENT_FAILED_WEBHOOK` maps to `payment.failed`; others to `ignored`. Event id is `data.payment.cf_payment_id`.

`verifyWebhook` order: check signature (and timestamp for Cashfree) first; only then `JSON.parse` and map. A failed check throws `WebhookSignatureError` and the body is never parsed.

- [ ] **Step 1: Write the fixtures**

Each fixture has the `_fixture` block. `razorpay-order.json`: `{ "id": "order_TEST0001", "amount": 69800, "currency": "INR", "receipt": "ord-1" }`. `razorpay-payment-captured.json`: `{ "event": "payment.captured", "payload": { "payment": { "entity": { "id": "pay_TEST0001", "order_id": "order_TEST0001", "amount": 69800, "status": "captured" } } } }`. `cashfree-order.json`: `{ "order_id": "ord-1", "order_amount": 698.00, "order_currency": "INR", "payment_session_id": "session_TEST" }`. `cashfree-payment-success.json`: `{ "type": "PAYMENT_SUCCESS_WEBHOOK", "data": { "order": { "order_id": "ord-1", "order_amount": 698.00 }, "payment": { "cf_payment_id": 555001, "payment_status": "SUCCESS" } } }`.

- [ ] **Step 2: Write the failing test**

```ts
// tests/payments/providers.test.ts
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RazorpayProvider } from '@/lib/payments/razorpay';
import { CashfreeProvider } from '@/lib/payments/cashfree';
import { WebhookSignatureError } from '@/lib/payments/types';
import { buildUpiIntentUrl } from '@/lib/payments/upi';

const fx = (f: string) => readFileSync(path.join(__dirname, '../fixtures/payments', f), 'utf8');
const rzCfg = { keyId: 'rzp_test_1', keySecret: 'sec', webhookSecret: 'rzwh', merchantVpa: 'food@hdfc', payeeName: 'Food OS' };
const cfCfg = { clientId: 'cf_1', clientSecret: 'sec', webhookSecret: 'cfwh', merchantVpa: 'food@icici', payeeName: 'Food OS' };

test('upi intent url encodes the amount with two decimals and the txn reference', () => {
  const url = buildUpiIntentUrl({ vpa: 'food@hdfc', payeeName: 'Food OS', amountInr: 698, note: 'Order 1', txnRef: 'order_TEST0001' });
  expect(url.startsWith('upi://pay?')).toBe(true);
  expect(url).toContain('am=698.00');
  expect(url).toContain('tr=order_TEST0001');
  expect(url).toContain('cu=INR');
});

test('razorpay creates an order in paise and returns a UPI intent', async () => {
  const calls: { url: string; body: any }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), body: JSON.parse(String(init.body)) }); return new Response(fx('razorpay-order.json')); }) as unknown as typeof fetch;
  const intent = await new RazorpayProvider({ ...rzCfg, fetchImpl: f }).createUpiIntent({ orderRef: 'ord-1', amountInr: 698, description: 'Order' });
  expect(calls[0].url).toBe('https://api.razorpay.com/v1/orders');
  expect(calls[0].body).toMatchObject({ amount: 69800, currency: 'INR', receipt: 'ord-1' });
  expect(intent).toMatchObject({ provider: 'razorpay', providerOrderId: 'order_TEST0001', amountInr: 698 });
});

test('razorpay verifies a valid captured webhook', () => {
  const raw = fx('razorpay-payment-captured.json');
  const sig = createHmac('sha256', 'rzwh').update(raw).digest('hex');
  const ev = new RazorpayProvider(rzCfg).verifyWebhook(raw, { 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'evt_1' });
  expect(ev).toEqual({ provider: 'razorpay', providerEventId: 'evt_1', eventType: 'payment.captured', providerOrderId: 'order_TEST0001', amountInr: 698 });
});

test('razorpay rejects a forged webhook before parsing it (Review Focus 2)', () => {
  const raw = fx('razorpay-payment-captured.json');
  const parse = vi.spyOn(JSON, 'parse');
  expect(() => new RazorpayProvider(rzCfg).verifyWebhook(raw, { 'x-razorpay-signature': 'deadbeef', 'x-razorpay-event-id': 'evt_1' }))
    .toThrow(WebhookSignatureError);
  expect(parse).not.toHaveBeenCalled();
  parse.mockRestore();
});

test('cashfree creates an order in rupees and returns a UPI intent', async () => {
  const calls: { url: string; body: any; headers: any }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), body: JSON.parse(String(init.body)), headers: init.headers }); return new Response(fx('cashfree-order.json')); }) as unknown as typeof fetch;
  const intent = await new CashfreeProvider({ ...cfCfg, fetchImpl: f }).createUpiIntent({ orderRef: 'ord-1', amountInr: 698, description: 'Order' });
  expect(calls[0].url).toBe('https://sandbox.cashfree.com/pg/orders');
  expect(calls[0].body).toMatchObject({ order_id: 'ord-1', order_amount: 698, order_currency: 'INR' });
  expect(intent).toMatchObject({ provider: 'cashfree', providerOrderId: 'ord-1', amountInr: 698 });
});

test('cashfree verifies a fresh signed webhook over timestamp plus body', () => {
  const raw = fx('cashfree-payment-success.json');
  const ts = String(Date.now());
  const sig = createHmac('sha256', 'cfwh').update(ts + raw).digest('base64');
  const ev = new CashfreeProvider(cfCfg).verifyWebhook(raw, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts });
  expect(ev).toMatchObject({ provider: 'cashfree', providerEventId: '555001', eventType: 'payment.captured', providerOrderId: 'ord-1', amountInr: 698 });
});

test('cashfree rejects a stale timestamp even with a valid signature (Review Focus 2)', () => {
  const raw = fx('cashfree-payment-success.json');
  const ts = '1700000000';
  const sig = createHmac('sha256', 'cfwh').update(ts + raw).digest('base64');
  expect(() => new CashfreeProvider(cfCfg).verifyWebhook(raw, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts }, Date.now()))
    .toThrow(WebhookSignatureError);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/payments/providers.test.ts`
Expected: FAIL, "Cannot find module '@/lib/payments/upi'".

- [ ] **Step 4: Implement**

- `lib/payments/types.ts`, `lib/payments/upi.ts`, `lib/payments/razorpay.ts`, `lib/payments/cashfree.ts` as in Interfaces and provider details.
- Shared rule: `verifyWebhook` computes the signature check first and throws `WebhookSignatureError` before `JSON.parse`. Cashfree's timestamp window check happens before the HMAC comparison.
- Secrets are read from config only; error messages include the provider name and status code, never the key or response body.
- `createUpiIntent` throws `PaymentCreateError` on non-2xx or a response without an id.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/payments/providers.test.ts`
Expected: 7 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/payments tests/payments tests/fixtures/payments
git commit -m "feat: add Razorpay and Cashfree UPI intent adapters with HMAC-first webhook verification

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Razorpay Primary with Cashfree Fallback

**Files:**
- Create: `lib/payments/router.ts`
- Test: `tests/payments/router.test.ts`

**Interfaces:**
- Consumes: `PaymentProvider`, `UpiIntent`, `UpiIntentRequest`, `PaymentCreateError` (Task 13).
- Produces:

```ts
export interface RoutedIntent extends UpiIntent { attempted: PaymentProviderName[] }
export function createUpiIntentWithFallback(primary: PaymentProvider, fallback: PaymentProvider, req: UpiIntentRequest, log?: (msg: string, meta: Record<string, unknown>) => void): Promise<RoutedIntent>;
// Calls primary.createUpiIntent once. Only on a thrown error (or a result with no providerOrderId) calls fallback.createUpiIntent once.
// If both throw, rejects with PaymentCreateError whose message names both providers and does not include secrets.
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/payments/router.test.ts
import { createUpiIntentWithFallback } from '@/lib/payments/router';
import { PaymentCreateError, type PaymentProvider, type UpiIntentRequest } from '@/lib/payments/types';

const req: UpiIntentRequest = { orderRef: 'ord-9', amountInr: 500, description: 'Order' };

function stub(name: 'razorpay' | 'cashfree', behavior: 'ok' | 'throw' | 'empty'): PaymentProvider & { create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => {
    if (behavior === 'throw') throw new Error(`${name} 502`);
    if (behavior === 'empty') return { provider: name, providerOrderId: '', amountInr: 500, upiIntentUrl: 'upi://x' };
    return { provider: name, providerOrderId: `${name}-order`, amountInr: 500, upiIntentUrl: 'upi://x' };
  });
  return { name, create, createUpiIntent: create, verifyWebhook: vi.fn() } as any;
}

test('uses Razorpay and never calls Cashfree when Razorpay succeeds (Review Focus 5)', async () => {
  const rz = stub('razorpay', 'ok');
  const cf = stub('cashfree', 'ok');
  const out = await createUpiIntentWithFallback(rz, cf, req);
  expect(out).toMatchObject({ provider: 'razorpay', attempted: ['razorpay'] });
  expect(rz.create).toHaveBeenCalledTimes(1);
  expect(cf.create).not.toHaveBeenCalled();
});

test('falls back to Cashfree exactly once when the Razorpay create call throws', async () => {
  const rz = stub('razorpay', 'throw');
  const cf = stub('cashfree', 'ok');
  const out = await createUpiIntentWithFallback(rz, cf, req);
  expect(out).toMatchObject({ provider: 'cashfree', attempted: ['razorpay', 'cashfree'] });
  expect(rz.create).toHaveBeenCalledTimes(1);
  expect(cf.create).toHaveBeenCalledTimes(1);
});

test('treats a Razorpay response without an order id as a failed create', async () => {
  const out = await createUpiIntentWithFallback(stub('razorpay', 'empty'), stub('cashfree', 'ok'), req);
  expect(out.provider).toBe('cashfree');
});

test('rejects with PaymentCreateError when both providers fail, without secrets in the message', async () => {
  const err = await createUpiIntentWithFallback(stub('razorpay', 'throw'), stub('cashfree', 'throw'), req).catch((e) => e);
  expect(err).toBeInstanceOf(PaymentCreateError);
  expect(err.message).toMatch(/razorpay.*cashfree|cashfree.*razorpay/s);
});

test('logs the fallback with the provider name only', async () => {
  const log = vi.fn();
  await createUpiIntentWithFallback(stub('razorpay', 'throw'), stub('cashfree', 'ok'), req, log);
  expect(log).toHaveBeenCalledWith('payment_fallback', expect.objectContaining({ from: 'razorpay', to: 'cashfree' }));
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|key/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/payments/router.test.ts`
Expected: FAIL, "Cannot find module '@/lib/payments/router'".

- [ ] **Step 3: Implement**

`lib/payments/router.ts`: `attempted` starts as `[primary.name]`. Wrap `primary.createUpiIntent(req)` in try/catch. A result with an empty `providerOrderId` counts as a failure. On failure, call `log('payment_fallback', { from, to, reason: message })` where the reason is the error's message, which the adapters keep free of secrets (Task 13). Push `fallback.name` to `attempted` and call `fallback.createUpiIntent(req)`. If that also fails, throw `new PaymentCreateError(`both providers failed: ${primary.name} (${e1.message}); ${fallback.name} (${e2.message})`)`. Return `{ ...intent, attempted }`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/payments`
Expected: all payment tests pass (providers 7, router 5).

- [ ] **Step 5: Commit**

```bash
git add lib/payments/router.ts tests/payments/router.test.ts
git commit -m "feat: route UPI intent creation to Razorpay with one-shot Cashfree fallback

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

## Acceptance for Plan 06

- `npm test` passes all suites added in Tasks 1–14, with `DATABASE_URL` pointing at the PostGIS container from Plan 01. The no-network guard is active for every suite.
- A POS webhook with a forged signature returns `401` and changes no `menu_items` row (`tests/api/pos-webhook.test.ts`).
- A nightly sync run, connecting as `food_sync`, upserts each POS-connected restaurant's menu keyed by `pos_item_code`, never deletes rows, and refuses an empty menu (`tests/pos/nightly-sync.test.ts`, `tests/pos/upsert.test.ts`).
- POS sync never writes `menu_items.dietary` (`tests/pos/upsert.test.ts`). Stored `pos_credentials` are AES-256-GCM ciphertext and round-trip (`tests/pos/credentials.test.ts`).
- A fixture order renders to an ESC/POS byte stream with init, bold, and cut bytes, and a local TCP server receives those exact bytes on the port 9100 sender path (`tests/printing/`).
- ONDC `on_search` and `on_select` fixtures parse into the internal shapes; the BAP client builds requests and `send` is refused while `liveSend` is false.
- Shadowfax, Rapido, and Dunzo sandbox adapters map their requests and responses; `live` mode throws.
- A forged Razorpay or Cashfree webhook throws before any parse; a Cashfree event older than 300 seconds is rejected (adapter level; Plan 05 owns the route and the settlement write); a Razorpay create failure falls back to Cashfree exactly once.
- Every fixture under `tests/fixtures/` has `"_fixture": { "synthetic": true, ... }`.
- `systemd-analyze verify deploy/systemd/food-pos-sync.service deploy/systemd/food-pos-sync.timer` exits 0 on the EC2 host, and `food-pos-sync.timer` is enabled there.

## Open Gaps (carry forward)

- Plan 02 (`2026-11-03-02-delivery-mesh.md`) defines its own `DispatchAdapter` in `lib/dispatch/adapter.ts`, with a different shape. Shared decision 5 requires Plan 02 to adopt Task 12's interface. Not yet done in Plan 02.
- Every fixture is synthetic. POS and 3PL signature header names and algorithms are `ASSUMED`, and each is marked VERIFY AGAINST CURRENT DOCS BEFORE IMPLEMENTING in its task. Replace fixtures with real captures after signing.
- The payment webhook HTTP route and the `order_refs.settled_at` write belong to Plan 05. This plan supplies only the provider adapters and `verifyWebhook`.
- Dietary is owner-only (shared decision 7). A new POS item is inserted with the placeholder `non_veg` until the owner sets it. Open product question: should unclassified items be hidden from guests until the owner sets dietary? The plan does not decide this.
- The POS sync no longer sets `spice_level`, `preparation_time_minutes`, or `description` (shared decision 7 lists only name, price, pos_item_code, and in-stock). Schema defaults apply. Owner should confirm this is acceptable for KDS prep timers.
- `pos_credentials` is encrypted with AES-256-GCM (Task 5). `POS_CREDENTIALS_KEY` must be provisioned on EC2 and kept out of git. Losing it makes stored credentials unreadable.
- The `food_sync` login is created NOLOGIN by Plan 01. Ops must set its password and `SYNC_DATABASE_URL` (Task 7). The Task 7 test checks BYPASSRLS.
- Migration numbering follows shared decision 1: `002_mesh_auction.sql` (Plan 02), `003_dine_in.sql` (Plan 03), `004_auth_ratings_compliance.sql` (Plan 05), and `005_integrations.sql` (this plan).
- Printer host and station-to-printer mapping are not in the Plan 01 schema. The convention in this plan is `pos_credentials.printers[]`; Plan 03 owns the UI for it.
- Cashfree's customer phone in create calls is a placeholder; Plan 05 must supply the verified diner phone.
- Live ONDC send, live 3PL dispatch, and live payment settlement are disabled by configuration until onboarding.

## Addendum: POS provider allow-list (2026-11-04)

- `POS_PROVIDERS_ENABLED` (comma-separated provider names) gates POS traffic. Unset or empty means no POS provider is enabled.
- Webhook `POST /api/pos/[provider]/[restaurantId]` returns `404 not_found` for a provider not in the list, before the body is read, the signature is checked, or the database is touched.
- The nightly sync skips providers not in the list and reports them in `skipped` with reason `provider_not_enabled`. Their credentials are not decrypted.
- Parsing is pure (`lib/pos/allowlist.ts`). Test suites set the list in `tests/setup/pos-key.ts`; production keeps it empty until the owner approves a provider.
