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

- Everything the project needs lives under `/home/ubuntu/docker` or its subfolders: source, plans, proxy (`proxy_server/`), compose files, deploy scripts, backups, and the database data disk (`data/`, mounted from the attached 100 GB volume).
- Nothing project-related goes in `/opt`, `/mnt`, `/srv`, or other system folders.
- **The host runs Docker only.** No Node.js, npm, or other language runtime is installed on the host, except the temporary Node exception recorded in CLAUDE.md (`/home/ubuntu/.local/node`, to be removed once tests run in containers). Every install, build, test, and run command executes inside a container, for example `docker run --rm -v /home/ubuntu/docker:/app -w /app node:22-alpine npm test`, or a compose service. Only Docker and OS packages are installed on the host.

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
  - Data volume: 100 GiB, mounted on the host at `/home/ubuntu/docker/data`. Postgres data lives in `/home/ubuntu/docker/data/postgres`, which the `db` container mounts as `/var/lib/postgresql/data`. The folder is owned by UID 999 (the Postgres image user). Postgres data for the pilot is expected to stay under 10 GiB; the rest is headroom. Snapshot this volume weekly.
  - Backup scratch space: `pg_dump` output is written to `/home/ubuntu/docker/data/backup-scratch` before upload to S3, so keep at least 20 GiB free on the data volume.
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
  - Production replaces the Postgres named volume with a bind mount to `/home/ubuntu/docker/data/postgres` (decision on storage above).
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
