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
- Monitoring: `/api/health` checked every minute by an external uptime check; container logs to CloudWatch.
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
