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
  - Data volume: 100 GiB, mounted on the host at `/mnt/pgdata`. Postgres data lives in `/mnt/pgdata/postgres`, which the `db` container mounts as `/var/lib/postgresql/data`. The folder is owned by UID 999 (the Postgres image user). Postgres data for the pilot is expected to stay under 10 GiB; the rest is headroom. Snapshot this volume weekly.
  - Backup scratch space: `pg_dump` output is written to `/mnt/pgdata/backup-scratch` before upload to S3, so keep at least 20 GiB free on the data volume.
- Docker Compose runs `app`, `db`, and `redis`. Caddy terminates TLS with automatic certificates.
- Persistent data on a separate EBS gp3 volume.
- Deploys: a GitHub Actions workflow builds the image, pushes it to GHCR, and SSHes to the instance to pull and restart. Rollback: redeploy the previous image tag.
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
