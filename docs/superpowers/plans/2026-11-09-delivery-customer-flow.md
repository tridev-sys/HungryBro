# Delivery customer flow (2026-11-09)

**Branch:** `feat/delivery-customer-flow` (from `dev` 6a17622). Not merged, not pushed.
**Goal:** a signed-in diner browses restaurants, opens a menu, builds a cart, checks out, pays,
tracks the order, and rates it after delivery.

## Read-first findings (existing code)

- `app/page.tsx` is a placeholder headline. No sign-out route exists (`app/api/auth/*` has only TOTP routes).
- `lib/payments/router.ts` `createUpiIntentWithFallback(primary, fallback, req)` already implements
  Razorpay-first, Cashfree-on-throw-or-no-order-id. `lib/payments/razorpay.ts` and `cashfree.ts` are
  adapters (`PaymentProvider`). `lib/payments/index.ts` only returns the dine-in fake adapter.
- `app/api/webhooks/razorpay/route.ts` verifies the HMAC, records the event id in `webhook_events`,
  and changes no state ("Plan 06 attaches payment-state changes here").
- `app/api/delivery/intent/route.ts` creates a mesh auction (`mesh_food_auctions`) for the signed-in
  diner. It needs `transcript`, `intent` (budget, SLA, `client_coordinates`), and runs sandbox kitchens.
- `app/api/ratings/route.ts` + `lib/ratings/submit.ts` insert `verified_customer_ratings` for an
  `order_refs` row. Rule: `order_refs.status = 'completed'`, `settled_at` set, insert within 2000 ms of
  `settled_at` (app check plus migration 004/008 policy). Not weakened here.
- Migration 008 revokes INSERT/UPDATE on `order_refs` from `food_app` and a trigger allows
  `status = 'completed'` only for `food_admin`/`food`. Settlement must go through a SECURITY DEFINER
  function owned by `food_admin` (same pattern as `app_apply_settlement_state`).
- `lib/ui/format.ts` `formatINR` already uses `Intl` `en-IN` (gives `₹1,22,500.00`).
- Theme tokens (`app/theme.css`): `bg`, `surface`, `surface-2`, `text`, `text-muted`, `accent`,
  `accent-ink`, `sla-*`; radii `card`, `pill`.
- `.env.local` has no `RAZORPAY_*` or `CASHFREE_*` keys. Live checkout therefore returns 503
  "payments not configured" until the owner supplies keys. Tests use stand-in providers only.

## Screens and routes

| Step | Screen / route | Method | Reads / writes |
|---|---|---|---|
| 1 | `/order` (restaurant list, server component) | GET page | `restaurant_nodes` (public read), `is_accepting_delivery` |
| 2 | `/order/[restaurantId]` (menu page + client `MenuCart`) | GET page | `restaurant_nodes`, `menu_items`, `menu_categories` |
| 3 | `/order/cart` (client; cart in `localStorage` key `fos-cart-v1`) | client only | none; server revalidates at checkout |
| 4 | `/order/checkout` (client) then `POST /api/orders` | POST | `delivery_orders`, `delivery_order_lines` (new, 015); `menu_items` for prices; `mesh_food_auctions` id from `POST /api/delivery/intent` |
| 4 | `POST /api/delivery/intent` (existing) | POST | `mesh_food_auctions` |
| 5 | `POST /api/webhooks/razorpay` (extended) | POST | `webhook_events`, `delivery_orders` via `app_apply_payment_event` (015) |
| 6 | `/order/[orderId]` (client poll every 5 s) + `GET /api/orders/[orderId]` | GET | `delivery_orders` (diner RLS) |
| 7 | rating panel on `/order/[orderId]` + existing `POST /api/ratings` | POST | `verified_customer_ratings`, `order_refs` |
| 8 | `/` signed-in home and signed-out home; `POST /api/auth/sign-out` | GET/POST | `users` via `resolveActor` |
| 8 | `/profile/settings` (existing) | GET | existing |

Delivered-state transition: `app_mark_delivery_delivered(order_id)` (015), callable by
`restaurant_staff`, `kitchen_lead`, `delivery_agent` of that restaurant, or `platform_admin`. It
creates the `order_refs` row (status `completed`, `settled_at = now()`) and links it to the order.
There is no staff UI for this in this branch. It is covered by DB tests and the e2e helper.

## Tables used

- Existing: `restaurant_nodes`, `menu_items`, `menu_categories`, `users`, `order_refs`,
  `verified_customer_ratings`, `webhook_events`, `mesh_food_auctions`.
- New (migration 015): `delivery_orders`, `delivery_order_lines`.

## Migration 015 (new, append-only)

File: `db/migrations/015_delivery_orders.sql`. Runs as food_admin.

- `delivery_orders`: `id`, `restaurant_id`, `diner_user_id`, `auction_id NULL` (FK to
  `mesh_food_auctions`), `status` CHECK in (`pending_payment`, `paid`, `in_kitchen`, `delivered`,
  `cancelled`), `subtotal NUMERIC(10,2)`, `gst NUMERIC(10,2)`, `total NUMERIC(10,2)`,
  `payment_provider` CHECK in (`razorpay`, `cashfree`), `provider_order_id UNIQUE NULL`,
  `order_ref_id NULL` (FK `order_refs`), `created_at`, `paid_at`, `delivered_at`.
  Check: `total = subtotal + gst`, all amounts >= 0.
- `delivery_order_lines`: `id`, `order_id`, `menu_item_id`, `name_snapshot`, `unit_price
  NUMERIC(10,2)`, `quantity INT CHECK 1..20`, `line_total NUMERIC(10,2)`.
- RLS: diner reads own rows (`diner_user_id = app_current_user_id()`); diner inserts own rows with
  `status = 'pending_payment'` only; staff of the restaurant read that restaurant's orders. No
  direct UPDATE for `food_app`.
- Trigger on lines (BEFORE INSERT, when `current_user = 'food_app'`): `unit_price` and `line_total`
  are overwritten from `menu_items.base_price`, so a client price can never be stored.
- `app_apply_payment_event(provider, event_id, event_type, provider_order_id, amount)` (SECURITY
  DEFINER): one transaction that inserts into `webhook_events` (ON CONFLICT DO NOTHING) and, only
  when new, marks the order `paid` if the amount equals `total` and the status is `pending_payment`.
  Returns `DUPLICATE`, `PAID`, `IGNORED`, or `AMOUNT_MISMATCH`. Called after the HMAC check.
- `app_mark_delivery_delivered(order_id)` and the `order_refs` insert (above).
- `app_move_to_kitchen(order_id)`: `paid` to `in_kitchen` (called from the webhook path after PAID).

## Build steps (TDD: red, green, commit each)

1. Restaurant list page (`/order`). Pure helper + DB-backed test for active restaurants only.
2. Menu page. `formatINR` amount tests (`₹1,22,500.00`), quantity add/remove component test.
3. Cart. Pure `cart.ts` (add, remove, totals with round2); server `priceCart(pool, restaurantId, lines)`
   reads prices from the DB and rejects unknown or out-of-stock items.
4. Checkout. Migration 015. `POST /api/orders` with stand-in providers injected. Razorpay primary,
   Cashfree fallback through `createUpiIntentWithFallback`. No live API call.
5. Webhook path. `app_apply_payment_event` after HMAC. Tests: bad signature → no state change;
   duplicate event → no second change; amount mismatch → no `paid`.
6. Order status page and `GET /api/orders/[id]`. Diner-only via RLS (another diner gets 404).
7. Rating after delivery. Rating panel only when `status = delivered` and `order_ref_id` set.
   The existing 2-second window is kept as is.
8. Home page (signed-in vs signed-out) and sign-out route (clears `fos_session`).

## Known gaps and decisions (for the owner)

- **Rating window:** the 2-second rule (migration 004/008, binding in CLAUDE.md) starts at the
  delivered event. A diner almost never rates within 2 seconds. The UI shows "rating window closed"
  after that. This is not changed here. Owner decision needed on the window.
- **Payments:** Razorpay and Cashfree keys are absent, so live checkout returns 503. Stand-ins in tests.
- **Delivery coordinates:** checkout asks the browser for location (`navigator.geolocation`) because
  the existing intent route requires `client_coordinates`. Denied location blocks checkout with a message.
- **Kitchen and delivery operations UI** are out of scope. The status moves `paid` to `in_kitchen` to
  `delivered` through DB functions only.
- **Business values** (ranking weights, counter-bid discount, pilot coordinates, logo, colours) are
  not used and not invented.

## Verification

- Suite: `scripts/tests/run-isolated.sh /home/ubuntu/worktrees/delivery-flow` (baseline 137 files, 735 tests).
- `npx tsc --noEmit` and `npm run build` in `node:22-alpine`, as the host user.
- Browser: throwaway stack only (fresh postgis:16-3.4 + redis:7-alpine on a private network, database
  `food_os_e2e_<random>`, migrations applied, app built from this branch, `ENABLE_DEV_PREVIEW=1` at run
  time). Playwright image matched to `@playwright/test` version. All throwaway resources removed after.
