# Tech Decisions (final)

**Status:** Decided by the engineering side. The owner has delegated all technical choices. Business, pricing, look-and-feel, and feature decisions remain with the owner. Plans follow this file; they do not re-ask these questions.

## Carried over from the roadmap (now final)

| Topic | Decision | Reason |
|---|---|---|
| Rating default | `rating_aggregate = 0.00`, shown as "No ratings yet" | A 5.00 default would show fake ratings and break the verified-reviews rule. |
| Margin floor | Kitchen net after the 3.5% fee ≥ 95% of list price; gateway fee is charged to the diner | Matches the build prompt and avoids netting a payment cost from the kitchen. |
| KDS timers | Colors per the build prompt (green < 5 min, yellow < 8 min, red overdue); overdue means past the PDF SLA (8 min dine-in, 12 min delivery) | Uses both sources without conflict. |
| Auction timing | 90 s total lifetime; 18 s bid window inside it | Both numbers come from the spec and cover different things. |
| Search radius | 6 km `ST_DWithin` on geography (18 min at 20 km/h) | Simple and testable now; a routing isochrone can replace it later without changing callers. |
| Pilot seed areas | Indiranagar and HSR (both pilot clusters) | Covers both sources. |

## Project location (binding, owner decision)

- Everything the project needs lives under `/home/ubuntu/docker` or its subfolders: source, plans, proxy (`proxy_server/`), compose files, deploy scripts, backups, and Postgres data in the named Docker volume `food-os-pgdata` on the root disk (storage decision 2026-11-04).
- Nothing project-related goes in `/opt`, `/mnt`, `/srv`, or other system folders.
- **The host runs Docker only.** No Node.js, npm, or other language runtime is installed on the host, except the temporary Node exception recorded in CLAUDE.md (`/home/ubuntu/.local/node`, to be removed once tests run in containers). Every install, build, test, and run command executes inside a container, for example `docker run --rm -v /home/ubuntu/docker:/app -w /app node:22-alpine npm test`, or a compose service. Only Docker and OS packages are installed on the host.

## Owner-set business values (2026-11-04)

Source for every row: owner, 2026-11-04. These are binding. Code and plans must use these values exactly. "Code constant" is the name in the repo at d3bc907 (see the consistency check in the docs/owner-business-values branch report). "Not in code" means no constant exists yet.

| Value | Owner setting | Code constant (file) |
|---|---|---|
| Platform take-rate (mesh fee) | Flat 3.5% infrastructure fee on GMV, `0.035` | `MESH_PROTOCOL_FEE_RATE` (`lib/pricing.ts`) |
| Restaurant tabletop SaaS fee | 499 INR per month per physical outlet. DECIDED BY OWNER 2026-11-04 | `OUTLET_SAAS_FEE_INR`, `monthlySaasCharge` (`lib/finance/ledger.ts`); table `outlet_subscriptions` (migration 010) |
| Statutory GST | 5% non-ITC GST, split 2.5% CGST and 2.5% SGST, `0.05` | `STATUTORY_GST_RATE` (`lib/pricing.ts`); split via `splitGst` (`lib/pricing.ts`) |
| Delivery logistics | Direct pass-through at cost (about 50 INR baseline 3PL). DECIDED BY OWNER 2026-11-04 | `DISPATCH_BASELINE_COST_INR` (config default only), `withPassThrough` (`lib/finance/ledger.ts`); table `delivery_pass_through_costs` (migration 010) |
| Operational floor margin | 5% (`0.05`) minimum kitchen margin | `DEFAULT_FLOOR_MARGIN` (`lib/pricing.ts`); DB default `operational_floor_margin` (`db/migrations/001_init.sql`) |
| Line backpressure threshold | Maximum 85% (`0.85`) active KDS load to participate in reverse auctions under 30 minutes. INCLUSIVE: load exactly 0.85 is eligible, above 0.85 is not. DECIDED BY OWNER 2026-11-04 | `AUCTION_MAX_LOAD` (`lib/auction/engine.ts`, SQL `active_kds_load <= $4` in `lib/auction/kitchen-repository.ts`); KDS warning above 0.85 (`lib/kds/load.ts`) |
| Reverse auction bid window | 18 seconds | `BID_WINDOW_MS` (`lib/auction/engine.ts`); SQL `INTERVAL '18 seconds'` (`lib/auction/auction-repository.ts`) |
| Visual identity | Keep the current neutral design system for now | Tailwind neutral palette and `app/theme.css` tokens |

Decided (owner, 2026-11-04): the 85% load threshold is INCLUSIVE. A kitchen at exactly 0.85 is eligible; above 0.85 is not. The SaaS fee (499 INR per outlet per month) and the delivery pass-through at cost (about 50 INR baseline) are decided and built into the ledger (see the section 2026-11-04 business logic).

## Cross-plan rules (added in reconciliation)

- **Migration order:** `001_init.sql` (Plan 01), `002_mesh_auction.sql` (Plan 02), `003_dine_in.sql` (Plan 03), `004_auth_ratings_compliance.sql` (Plan 05), `005_integrations.sql` (Plan 06). Plan 07 adds none.
- **Database roles:** `food_app` (row-level security enforced; all request traffic), `food_sync` (bypasses row-level security; only the nightly menu sync), and `food_admin` (bypasses row-level security, not superuser; only the migration runner, seed scripts, and test fixtures). Sign-in lookup is a SECURITY DEFINER function owned by `food_admin`. No superuser or table-owner connections in app code at runtime.
- **Rating window:** 2 seconds from settlement, enforced in the database by migration 004.
- **Kitchen load writes:** through `food_app`, under a policy that limits updates to that restaurant's own staff.
- **POS credentials:** encrypted at rest with AES-256-GCM; key in `POS_CREDENTIALS_KEY` (32 bytes, base64).
- **3PL interface:** `DispatchAdapter`, defined in Plan 06, used by Plan 02.
- **Dietary tags:** set by the owner per item; POS sync never overwrites them.
- **External APIs:** every provider endpoint, header, and timestamp unit is marked for verification against current docs before implementation.

## New technical decisions

**Application**
- Runtime: Node.js 22 LTS. Language: TypeScript, `strict: true`.
- Framework: Next.js 15 App Router. Styling: Tailwind CSS v4. Icons: Lucide. Animation: Framer Motion.
- Mobile: installable PWA first. A native wrapper (Capacitor) comes in Plan 07, not before.
- Live updates (KDS board, auction countdown, order status): Server-Sent Events from Next.js route handlers, fed by Redis Pub/Sub. **Socket.io is not used in v1.** It adds a second server process and sticky-session setup that this scale does not need.

**Data**
- PostgreSQL 16 + PostGIS 3.4, run as a container on the app's EC2 host in v1. A managed database is not needed at pilot volume. Revisit when a single node is no longer enough.
- Backups: nightly `pg_dump` to S3 with 14-day retention, and a restore test each month.
- Redis 7 (Alpine) for Pub/Sub and short-lived auction state. Auction state is ephemeral; the database holds the record.
- Tenant isolation through Postgres RLS. Each request sets `app.user_id` and `app.session_token` in its transaction.

**Auth**
- Supabase is not used. Phone-first `+91` sign-in with a 6-digit OTP through MSG91. In development the OTP is a fixed test code.
- Session: a signed, `HttpOnly`, `Secure` cookie (JWT, HS256, 30-day expiry for diners; 12-hour for staff).
- Staff and admin accounts use the same OTP flow plus an admin-assigned role.

**Voice and AI**
- Audio transport: LiveKit Cloud, region `ap-south-1`.
- Voice activity detection: Silero VAD (WASM) in the browser.
- Speech-to-text: Deepgram Nova-3. Indic and Hinglish translation: Sarvam AI. Text-to-speech: Cartesia Sonic.
- LLM orchestrator: either Claude or Gemini, whichever key the owner supplies. Both are behind one adapter interface, `LlmProvider`, with a fake for tests, so tests never call paid APIs.
  - Claude adapter: model `claude-haiku-5-5`.
  - Gemini adapter: model `gemini-2.5-flash`.
  - Provider selection: `LLM_PROVIDER=claude|gemini` in the environment. If unset, use Claude when `ANTHROPIC_API_KEY` is present, otherwise Gemini when `GEMINI_API_KEY` is present. If neither is set, the app starts with the fake provider and logs a warning.
  - Both run with `temperature: 0.1`. Every tool call is validated with Zod before any state change.
  - Keys live only in `.env` on the server and in local `.env.local`. Both files are git-ignored. Keys are never committed, logged, or sent to the browser.

**Integrations**
- POS: direct ESC/POS over TCP port 9100 for printing. Petpooja, Restroworks, UrbanPiper through webhooks plus a nightly full menu sync.
- ONDC: Beckn-protocol schemas, tested against recorded fixtures. Live ONDC onboarding happens later, when the business is ready.
- Payments: Razorpay as the primary gateway, Cashfree as fallback. Webhook signatures verified with HMAC before any state change.

**Deployment and operations**
- Deploy to this one EC2 instance only. No other hosts are used. Instance type `c4.xlarge` (4 vCPU, 7.5 GiB RAM), region `ap-south-1`, Ubuntu LTS.
  - Memory budget (7.5 GiB): Postgres about 2 GiB, Redis 256 MiB cap, app and migrations about 1 GiB, OS and Docker the rest. Redis is capped with `maxmemory 256mb`.
  - Note: c4 is a previous-generation instance family. Resizing to c7i (current generation) is planned by the owner. A `c7i.xlarge` has 4 vCPU and 8 GiB RAM, so the memory budget above still holds.
- Storage (EBS gp3 for all volumes):
  - Root volume: 60 GiB. Ubuntu, Docker, the three images, and build cache. Prune unused images and build cache monthly.
  - Data volume: none. The 100 GiB data disk is being detached and is not used (storage decision 2026-11-04). Postgres data is in the named volume `food-os-pgdata` on the root disk.
  - Backup scratch space: `pg_dump` output is written to `backups-scratch/` in the repo on the root disk before upload to S3. `scripts/backup-pg.sh` refuses to run with less than 20 GiB free there (storage decision 2026-11-04).
- **Shared reverse proxy (owner decision):**
  - Folder `~/docker/proxy_server/` holds one Caddy 2 proxy (`caddy:2-alpine`) with its own `docker-compose.yml`, `Caddyfile`, and `create-shared-network.sh`. Caddy obtains and renews Let's Encrypt certificates automatically for `DOMAIN`, with `ACME_EMAIL` for expiry notices.
  - The proxy is the only container that publishes host ports, and only `80` and `443`. HTTP redirects to HTTPS. Nothing else on the host is reachable from outside.
  - Every app joins one external Docker network named `shared`, created once with `proxy_server/create-shared-network.sh`. The proxy and all apps share it.
  - An app's compose file uses `expose` only (no `ports`) and joins `shared`. The app container has a fixed `container_name` (for the food app, `food-os-app`). The proxy's `Caddyfile` routes each app's domain to that name and port. Adding an app means adding one site block to the Caddyfile.
  - Databases and Redis join a private `backend` network that the proxy cannot reach. Local development may bind `127.0.0.1` ports for tests; production publishes none.
  - Firewall (UFW) and the EC2 security group allow only `22` (SSH), `80`, and `443`.
- **Container resource limits (binding, every app compose file):**
  - Each service sets hard `cpus`, `mem_limit`, `mem_reservation`, and `pids_limit`, and a bounded json-file log (`max-size` 10m, `max-file` 3).
  - Current caps: `app` 1.5 CPU / 1 GB; `db` 2.0 CPU / 2 GB (shm 256 MB); `redis` 0.5 CPU / 320 MB, with Redis `maxmemory 256mb` and `allkeys-lru`; `proxy-caddy` 0.5 CPU / 128 MB. Total 4.5 CPUs of caps on a 4-vCPU host; the caps are ceilings, not reservations.
  - Every service that can hold state has `restart: unless-stopped`.
- **Docker volumes (binding):**
  - Named volumes have fixed names and labels (`app=food-os`, a `purpose` label): `food-os-pgdata` (Postgres data), `food-os-redisdata` (Redis append-only file), `proxy caddy_data` (Let's Encrypt certificates and account keys; losing it forces re-issuance, so it is backed up).
  - Production uses the same Postgres named volume `food-os-pgdata` as the base file (storage decision 2026-11-04; the earlier bind-mount plan is withdrawn).
  - Volumes are never removed by `docker compose down`; removal needs `-v` and an explicit operator step. Backups run before any volume-affecting change.
- Docker Compose runs `app`, `db`, and `redis`.
- Persistent data on a separate EBS gp3 volume.
- Deploys: a GitHub Actions workflow builds the image, pushes it to GHCR, and SSHes to the instance to pull and restart. Rollback: redeploy the previous image tag.
- **Logging (binding):** containers keep bounded `json-file` logs (10 MB × 3 per service). The `awslogs` driver is not used, because it cannot be combined with the json-file caps. The CloudWatch agent on the host reads the Docker json logs and ships them to CloudWatch.
- Monitoring: `/api/health` checked every 5 minutes by an external uptime check (free monitors do not offer 1-minute checks), with a CloudWatch `StatusCheckFailed` alarm as the backup; container logs to CloudWatch.
- Rate limiting: token-bucket middleware in the app. A WAF is added in front (Cloudflare) once there is a domain; the app does not depend on it.

**Testing**
- Vitest for unit and integration tests. Playwright for end-to-end tests (Plan 07).
- Real PostGIS and Redis in integration tests, via Compose. No mocks for the database.

## Questions the owner still decides (business and product)

These do not block engineering, and the plans will use the values below until changed:
- Pricing: 3.5% mesh fee, ₹499/month SaaS per outlet, from the PDF.
- Pilot cities and clusters: Indiranagar, Koramangala, HSR, Bengaluru.
- Visual design: none is specified yet; the plans will use a neutral Tailwind design until you provide direction.
- Feature priority: the PDF roadmap order (Plan 03 dine-in before Plan 02 delivery is an option if you want the dine-in pilot first).

## Decisions taken on the owner's behalf (2026-11-03)

- **Leftover Docker volumes `docker_pgdata` and `docker_redisdata`:** KEPT. They hold real data (about 109 MB Postgres, a Redis dump) and deleting is irreversible. Remove only on an explicit owner request.
- **Browser (Playwright) tests:** run inside the official Playwright container image (for example `mcr.microsoft.com/playwright`, version matched to the installed `@playwright/test`). Chromium is never installed on the host, so no sudo is needed and the host stays Docker-only.

## Engineering decisions while owner items are blocked (2026-11-04)

These decisions let the build continue while vendor answers and owner items are open. Engineering owns the technical choices here. Each entry has a status, the reason, and the trigger that would change it. Evidence paths are relative to the repo root. No code was changed for this section.

**Payments**
- **Cashfree `x-api-version`: keep `2023-08-01`.** Status: DECIDED, pending vendor. Reason: no Cashfree source confirms that `2026-01-01` is backward compatible for `POST /pg/orders` and `PAYMENT_SUCCESS_WEBHOOK`, and the migration page lists breaking changes in the 2023-08-01 line. Evidence: `lib/payments/cashfree.ts:53`. Trigger: Cashfree confirms in writing that `2026-01-01` is compatible for both calls, including the `cf_payment_id` type and the response fields we read. Question to send: "Is `x-api-version: 2023-08-01` still accepted for POST /pg/orders and PAYMENT_SUCCESS_WEBHOOK, and is 2026-01-01 backward compatible for those two?"
- **Cashfree webhook timestamp unit: milliseconds (stale finding closed).** Status: DECIDED, in code (fixed in d411f82). The Round 1 "mismatch 1" is out of date. `lib/payments/cashfree.ts:92-93` and `lib/payments/webhooks.ts:37` both compare `x-webhook-timestamp` in epoch milliseconds, with a 5-minute window. Plan 06 said seconds; its text is now corrected to milliseconds. The production value is still NOT VERIFIED until a live Cashfree webhook is checked.
- **Razorpay:** no change. Event names `payment.captured` and `payment.failed` are confirmed in Round 2.

**Auth (MSG91)**
- **Host and header: keep `https://control.msg91.com/api/v5/otp` and the `authkey` header.** Status: UNVERIFIED. Reason: the official v5 page was not reachable, and a search snippet names a different host (`api.msg91.com/api/v5/otp`). Evidence: `lib/auth/otp-providers.ts:20` (URL) and `:38` (header). Trigger: MSG91 support or the dashboard docs confirm the host, path, auth method and body fields, or the first sandbox send shows a different result.
- **Response check: NOT IMPLEMENTED (open engineering item).** Status: OPEN, no code change in this task. `Msg91OtpProvider.send()` at `lib/auth/otp-providers.ts:44-47` treats a send as successful when `res.ok` is true, and never reads the body. It does not check for `type: "error"`, so an HTTP 200 error response would be treated as sent. Action: parse the JSON body and throw when `type` is `"error"`, with a test, before the first live OTP send. The send is not yet live, so the risk is latent.

**POS (Petpooja, Restroworks, UrbanPiper)**
- **Signature checks stay fail-closed.** Status: DECIDED. Reason: the header names and algorithms are ASSUMED and no vendor spec is confirmed. Evidence: `lib/pos/petpooja.ts:48-51`, `lib/pos/restroworks.ts:49-52`, `lib/pos/urbanpiper.ts:43-46`. A missing secret or signature returns false (`lib/webhooks/hmac.ts:11`), and the route returns 401 on a failed check (`app/api/pos/[provider]/[restaurantId]/route.ts:49-50`).
- **Do not enable any POS provider in production until its vendor spec is confirmed.** Status: DECIDED, owner-visible rule for ops. Reason: there is no env flag. Enablement today happens only through data. `lib/pos/registry.ts:6-10` always registers all three adapters. The route accepts a request when the restaurant's `pos_provider` equals the URL provider (`route.ts:38`). The nightly sync picks up every restaurant with `pos_provider <> 'direct'` (`lib/pos/nightly-sync.ts:43`). So a provider is live for a restaurant as soon as its `pos_provider` and `webhook_secret` are stored. Rule until the spec is confirmed: keep `pos_provider = 'direct'` in production and store no POS `webhook_secret`. Open engineering item (not implemented): add an explicit allow-list flag (for example `POS_PROVIDERS_ENABLED`) that the registry checks, so enablement is not only a data change.
- **Petpooja note.** Third-party material describes a shared-secret check, not an HMAC. If that is right, the HMAC code rejects every real webhook (fail-closed, so no false accept). Resolve with the vendor before enabling.
- **Freshness.** The route checks event age only when the provider supplies a timestamp (`route.ts:56`). Restroworks and UrbanPiper have no confirmed timestamp rule.

**Voice and speech**
- **Deepgram: streaming WebSocket, `nova-3`.** Status: DECIDED in code, live path UNVERIFIED. Reason: Plan 04 specifies streaming. Evidence: `lib/voice/providers/deepgram.ts:6` (`wss://api.deepgram.com/v1/listen`), `:11-17` (query: `model=nova-3`, `encoding=linear16`, `sample_rate=16000`), `:20` (Token auth). The streaming Content-Type `audio/l16` is not used, and its need is UNVERIFIED. Trigger for first live use: a sandbox call with a short PCM clip returns a final transcript, and the WebSocket query parameters are confirmed on the Deepgram listen-streaming reference.
- **Deepgram enablement is key-only.** Status: OPEN. `lib/voice/providers/select.ts:22-24` enables the live STT adapter whenever `DEEPGRAM_API_KEY` is non-empty. Setting that key in production therefore turns on the unverified live path. Action: keep `DEEPGRAM_API_KEY` unset in production until the sandbox check passes, or add the same explicit flag as for POS.
- **Cartesia: bearer auth and `Cartesia-Version: 2026-08-14`.** Status: DECIDED and applied (Round 2). Evidence: `lib/voice/providers/cartesia.ts:7` (version), `:22` (`Authorization: Bearer`), `:27` (`model_id: 'sonic-3'`, which is in the current enum). Live check still needed: the first real call must succeed before this is marked verified. Trigger for change: a 4xx from `tts/bytes` naming the header or version.
- **Cartesia voice: placeholder.** `lib/voice/providers/cartesia.ts:9` sets `REPLACE_WITH_CARTESIA_VOICE_ID`, so calls fail visibly until a voice is chosen. Choosing the voice is a product decision for the owner.
- **Speech-to-text interface: one-shot `transcribe()`.** Status: DECIDED. Evidence: `lib/voice/types.ts:23`. The Deepgram adapter returns final results only (`deepgram.ts`, `is_final` filter), and partial results are not exposed to callers. Trigger: a screen needs live captions or partial text. The streaming partial callback is then added to the interface as a new method, without changing `transcribe()`.

**Owner decisions (not engineering)**
- Look and feel and the neutral colour set, business values (ranking weights, counter-bid rule, "₹180 saved" figure, pilot coordinates), domain name, EC2 security group, SSH host, GHCR access, and the `food_sync` production secret are owner decisions. Engineering does not set them.

## Evidence notes (2026-11-04)

- The Round 1 "mismatch 1" (Cashfree timestamp unit) and the Round 1 Deepgram "REST in repo" note are stale. The code now uses milliseconds for Cashfree and streaming for Deepgram. The verification doc's Round 2 status records the fix (d411f82); the production value stays NOT VERIFIED until a live webhook is checked.

## Storage decision 2026-11-04 (owner, binding)

- Postgres runs on the root EBS disk. Production and dev both use the named Docker volume `food-os-pgdata` (labels `app=food-os`, `purpose=postgres-data`), stored under `/var/lib/docker`. The production compose file declares the same volume and does not use a bind mount.
- The 100 GB data disk is being detached and is not used. No file may depend on `/home/ubuntu/docker/data`. `PGDATA_DIR` is removed. `scripts/ec2-bootstrap.sh` no longer mounts a data disk. `scripts/verify-host.sh` checks the named volume and the root free space instead.
- Backup scratch space is `backups-scratch/` in the repo on the root disk (git-ignored). `scripts/backup-pg.sh` checks free space before writing and refuses to run with less than 20 GiB free (`MIN_FREE_GIB`, default 20, the owner's rule).
- Moving Postgres data to another disk later requires a verified backup first, then a restore check on the new location.

## Auth and voice decisions 2026-11-04 (owner, binding)

- **Sign-in codes by email, no paid SMS or WhatsApp.** Status: DECIDED. OTP provider selection is `OTP_PROVIDER` = `email` | `msg91` | `dev`. Unset: `dev` in development and test; `email` in production when `SMTP_HOST` is set; otherwise production fails at selection. MSG91 is chosen only when `OTP_PROVIDER=msg91` is set. `dev` is refused in production. Evidence: `lib/auth/otp-providers.ts` (`selectOtpProvider`, `EmailOtpProvider`), `tests/auth/otp-selection.test.ts`.
- **SMTP library: nodemailer 7.0.13.** Status: DECIDED. Free, widely used. Licence: the package LICENSE file is MIT; the package.json field reads MIT-0 (also permissive). No live SMTP call is made in tests.
- **Phone sign-in cannot yet deliver by email.** Status: OPEN, owner decision needed. The sign-in data model (`users`, `otp_challenges`) is keyed by phone and has no email column. With SMTP configured in production, `EmailOtpProvider.send` refuses a phone number and phone sign-in returns "could not send". Options: add a verified email capture step with a new users.email column in a later migration, or keep phone sign-in on MSG91 once the owner accepts that gateway. Not changed in this task.
- **2FA: RFC 6238 TOTP.** Status: DECIDED. Library: `otpauth` 9.6.0, MIT, pure JavaScript. QR code: existing `qrcode` 1.5.4, MIT. SHA-1, 6 digits, 30-second step, one step either side. Each code is accepted once (`user_totp.last_used_step`).
- **TOTP secret encrypted at rest with the POS helper.** Status: DECIDED. Reuses `encryptCredentials`/`decryptCredentials` (AES-256-GCM, `lib/pos/credentials.ts`) with the key from `TOTP_ENCRYPTION_KEY` (`loadTotpKey` in `lib/auth/totp.ts`). The secret is never logged.
- **Recovery codes.** Status: DECIDED. Ten codes, 8 characters each shown as `XXXX-XXXX`, from an alphabet without 0, O, 1, I. Stored as HMAC-SHA256 digests keyed by `TOTP_ENCRYPTION_KEY`. Each is spent atomically (`used_at`).
- **Sign-in with 2FA.** Status: DECIDED. After the email code, a user with 2FA enabled gets a 5-minute pending token (`purpose: totp-pending`, in an httpOnly cookie). The token is not a session: `verifySession` rejects any token with a `purpose` claim. Enrolment is at `POST /api/auth/totp/enrol` and `POST /api/auth/totp/activate`. No enrolment page yet.
- **Migration 011_totp_2fa.sql.** Status: DECIDED. Creates `user_totp` and `totp_recovery_codes`, both RLS with FORCE and the self-manage policy (same shape as `user_vpas`). food_app gets SELECT, INSERT, UPDATE only. food_sync gets nothing. Migration 010 belongs to another agent and is not created here.
- **Voice: Cartesia voices.** Status: DECIDED. Primary `7ea5e9c2-b719-4dc3-b870-5ba5f14d31d8` (env `CARTESIA_VOICE_ID`); fallback `f8f5f1b2-f02d-4d8e-a40d-fd850a487b3d` (env `CARTESIA_VOICE_ID_FALLBACK`). The fallback is used once on an HTTP 404 from the primary. Other errors are not retried.
- **Cartesia model: sonic-3 kept.** Status: DECIDED. The Cartesia models page (checked 2026-11-04) names no cheaper or free model, so there is no silent switch.

## Business logic decisions 2026-11-04 (owner decisions, engineering implementation)

Binding for the business logic build (branch `feat/business-logic`, migration `010_business_ledger.sql`).

- **Load threshold is inclusive.** Eligible when `active_kds_load <= 0.85`. Excluded above 0.85. Applied in `evaluateCounterBids`, `matchKitchenNodes`, and the SQL `active_kds_load <= $4`. The KDS warning stays "above 0.85" (`backpressureWarning`).
- **Restaurant SaaS fee.** 499 INR per physical outlet per month. Table `outlet_subscriptions` (restaurant_id, outlet_label, monthly_fee_inr NUMERIC(10,2) default 499.00, status active/paused/cancelled, period_start, period_end). RLS: staff read their own restaurant only (`app_current_staff_restaurant_id()`, same pattern as 004 and 008). `food_app` has SELECT only. Writes are by `food_admin` (billing ops). `monthlySaasCharge(outlets)` is pure and rounds half-up with `round2`.
- **Delivery logistics pass-through.** Table `delivery_pass_through_costs` (restaurant_id, delivery_id unique, provider shadowfax/rapido/dunzo, cost_inr NUMERIC(10,2) >= 0). No DB default cost: the cost is the dispatch adapter's value per order. `DISPATCH_BASELINE_COST_INR = 50` is a config constant only. `withPassThrough(orderTotal, dispatchCost)` adds the cost at cost (no markup), rounded half-up. `food_app` has SELECT only.
- **30 minute SLA as an eligibility constraint.** A kitchen is eligible only when `prep + transit + buffer <= MAX_SLA_MINUTES`. `MAX_SLA_MINUTES = 30` (owner, "under 30 minutes", configurable). `SLA_BUFFER_MINUTES = 3` (engineering default). Boundary inclusive: 15 + 12 + 3 = 30 is eligible; 16 is not. Applied in the SQL (`restaurant_nodes.prep_time_minutes <= maxPrepMinutes`), in `matchKitchenNodes`, and to each counter bid's `estimatedPrepMinutes` in `evaluateCounterBids`.
- **Prep time source.** Migration 010 adds `restaurant_nodes.prep_time_minutes INTEGER NOT NULL DEFAULT 12` (1 to 120). It is not granted to `food_app` (ops sets it as `food_admin`). 12 minutes is the existing estimate used by the sandbox kitchens (`lib/auction/sandbox-kitchens.ts`).
- **Transit source.** No transit time is stored before dispatch. `TRANSIT_ESTIMATE_MINUTES = 12` reuses the existing estimate (the sandbox dispatch ETA in `lib/dispatch/sandbox.ts`). A distance-based transit model is a later change and needs a rule from the owner.
- **Not wired yet.** The dispatch adapters do not return a cost, so no live code path writes `delivery_pass_through_costs` yet. This is a follow-up, not a gap in the calculation.

**Amendment 2026-11-04 (owner decision, supersedes the Let's Encrypt wording in the shared reverse proxy bullet above)**
- Domain `hungrybro.pacewisdom.in`, proxied by Cloudflare (orange cloud), SSL/TLS mode Full (strict).
- Caddy terminates TLS with the Cloudflare Origin CA certificate: `tls /etc/caddy/origin/cert.pem /etc/caddy/origin/key.pem`, mounted read-only from the host folder `/etc/caddy/origin` (key mode 600). No ACME or Let's Encrypt for this site, because HTTP challenges fail behind the Cloudflare proxy. `ACME_EMAIL` is removed.
- Host: Elastic IP in `ap-south-1`. The address lives only in GitHub variable `EC2_HOST` and the Cloudflare DNS record, never in the repo.
- Client IP: Caddy sets `X-Real-IP` from `CF-Connecting-IP` (the one place the X-Real-IP contract changes).

## Email sign-in identifier 2026-11-04 (owner decision, engineering design)

Owner: sign-in and OTP work with an email address as well as a phone number. Phone stays supported. Branch `feat/user-email`, migration `012_user_email.sql`.

- **Identifier model.** Status: DECIDED. `users.phone_number` becomes nullable and `users.email` is added. A user has at least one identifier (`users_has_identifier`). Phone is unique (001). Email has a unique index on `lower(email)`. Email is stored normalised (trimmed, lowercase, `users_email_normalised`). Existing rows keep their phone. Evidence: `db/migrations/012_user_email.sql`, `tests/db/migration-012.test.ts`.
- **No automatic linking.** Status: DECIDED. An email account and a phone account are separate users. Linking them needs a proof of both identifiers and is out of scope. Evidence: `tests/auth/email-identifier-otp.test.ts`.
- **OTP challenges.** Status: DECIDED. `otp_challenges.phone_e164` becomes nullable and `otp_challenges.email` is added. Exactly one identifier per challenge (`otp_challenges_one_identifier`). The phone functions from 004 are unchanged. Email has `app_issue_otp_challenge_email` (3 per address per hour, its own advisory-lock key), `app_lookup_user_by_email` and `app_create_user_after_email_otp` (both SECURITY DEFINER, owned by food_admin, fixed search_path). Grants: `food_app` executes only; no new table grants.
- **Parsing.** Status: DECIDED. Input with an `@` is an email, otherwise a phone (`lib/auth/identifier.ts`). An email is never parsed as a phone number.
- **Delivery.** Status: DECIDED. An email identifier goes through the provider only when it can send email (`email` or `dev`). An email is never handed to `msg91`; that returns `SEND_FAILED` before any challenge row is written. Phone identifiers use the existing provider path, unchanged. The HMAC input is the normalised identifier, so existing phone codes still verify.
- **Owner decision 2026-11-04: email OTP is the active sign-in code method now (free). Keep the MSG91 SMS path available behind `OTP_PROVIDER=msg91`; the SMS-or-not decision is deferred.** Phone-only accounts still cannot sign in in production until that decision is made.
- **OPEN (owner decision): phone sign-in with SMTP only.** With `OTP_PROVIDER=email` in production, a phone-only account still cannot receive a code, because the email provider refuses a phone destination and the account has no email on file. Email sign-in works. Options for the owner: keep MSG91 for phone sign-in, or add an email to the phone account through a verified step (a later migration and flow). Not changed in this task.

## Verified email for phone-only accounts 2026-11-04 (engineering decision, branch `feat/verified-email`, migration `013_verified_email_claim.sql`)

Owner: phone-only accounts should get a verified email link or email OTP. Engineering chose the method below.

- **Phone sign-in with SMTP only.** Status: DECIDED. With `OTP_PROVIDER=email`, a phone identifier is refused before any challenge row is written (`PHONE_UNAVAILABLE`). The MSG91 path is unchanged and is used only when `OTP_PROVIDER=msg91` is set. The dev provider is unchanged.
- **Adding an email is a signed-in action only.** Status: DECIDED. The "add email" form lives in profile settings and needs a session. Step 1 sends a 6-digit code to the typed address. The challenge is tagged `purpose = 'attach_email'` and bound to the session user (`claim_user_id`). Step 2 verifies the code (`verifyOtp`) and calls `app_attach_verified_email`.
- **The database checks the claim.** Status: DECIDED. `app_attach_verified_email` sets `users.email` only when all of these hold: the caller (`app.user_id`) is set; a challenge with `purpose = 'attach_email'`, `claim_user_id` = caller and this email was consumed in the last 10 minutes; and `users.email` is NULL. A duplicate address hits `users_email_lower_key` and is reported as `EMAIL_TAKEN`. Sign-in challenges cannot attach.
- **Why a phone number alone cannot add an email.** Status: DECIDED. A session for a phone account exists only after a phone code was really delivered by MSG91. With SMS off no phone session can be issued, so no phone-only account can add an email. Typing a phone number never reaches the attach step.
- **Same row.** Status: DECIDED. Attaching sets `users.email` on the existing row. Nothing is copied or merged. One account, one verified email (case-insensitive unique index from 012).
- **Existing phone-only accounts while SMS is off.** Status: DECIDED. No automatic or admin path. An admin-set email would attach an address nobody proved, so it is refused. These accounts cannot sign in and must register with an email, which creates a separate row. The old row is left unchanged: no merge, no data moved, no invented data. When the owner turns SMS on (`OTP_PROVIDER=msg91`), these accounts sign in by phone and add the email on the same row. The owner should know that order history stays on the old row until then.
- **Evidence.** Tests: `tests/auth/verified-email-claim.test.ts`, `tests/db/migration-013.test.ts`.
