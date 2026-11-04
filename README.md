# Autonomous Food OS

Autonomous Food OS is a phone-first food ordering system. It covers delivery through a mesh auction between nearby kitchens, dine-in with a kitchen display (KDS), voice input, verified diner ratings, and integrations for POS, payments and OTP. The app is built with Next.js and runs entirely in Docker containers.

## Status

Verified as of 2026-11-04:

- Full test suite: 113 files, 587 tests passing on the last full run.
- Journey end-to-end tests: 11 of 11 passing on a fresh seed.
- Layout spec: 3 of 3 passing against the production entry (`node server.js`).

Not yet run or verified:

- Plan 06 and Plan 07 real-host steps are NOT RUN.
- Deepgram streaming endpoint and encoding parameters are not verified live.
- Cartesia live authentication and version are not verified live.
- The Cashfree webhook timestamp is not verified in production.
- The payment webhook path needs a provider sandbox to test end to end.
- POS providers are fail-closed and not enabled in production.

## Architecture

- **Web app:** Next.js 15 App Router, React 19, TypeScript in strict mode. Styling uses Tailwind v4. Colours and radii come only from the tokens in `app/theme.css`.
- **Validation:** Zod.
- **Data:** PostgreSQL 16 with PostGIS for geography, and Redis 7 for short-lived state.
- **Container layout:** one shared Caddy reverse proxy is the only publisher of host ports 80 and 443. Each app joins the external Docker network `shared` and uses `expose` only. Databases and Redis sit on a private `backend` network and publish nothing in production.
- **Key rules:**
  - Money is INR, stored as `NUMERIC(10,2)`, rounded with `round2` (half-up), and shown with Indian grouping (`₹1,22,500.00`).
  - Ratings default to `0.00` ("No ratings yet"). A rating is accepted only for a completed order, within 2 seconds of settlement. The database enforces this (migration 008).
  - Auctions last 90 seconds in total, with an 18-second bid window. Kitchens are eligible only below 0.85 load, within a 6 km radius.
  - KDS colours: green under 5 minutes, yellow from 5 minutes up to the SLA, red after the SLA. The SLA is 8 minutes for dine-in and 12 minutes for delivery.
  - POS credentials are encrypted with AES-256-GCM, using a key from `POS_CREDENTIALS_KEY`.
  - The LLM is Claude (`claude-haiku-5-5`) or Gemini (`gemini-2.5-flash`), chosen by which API key is present. Tests never call paid APIs.

## Repository layout

- `app/`: Next.js routes (`api/`, `delivery/`, `dine/`, `ops/`, `profile/`, `auth/`) and `theme.css`.
- `components/`, `lib/`: UI components and domain logic (auction, KDS, mesh, payments, POS, voice).
- `db/migrations/`: SQL migrations `001_init` to `009_security_hardening_fixes`. Next is `010`.
- `db/bootstrap/`: one-time role setup (`002_app_login.sql`, `003_backup_roles.sql`).
- `scripts/`: migration CLI, seeds, nightly POS sync, backup and verification scripts. `scripts/tests/` holds shell tests and `run-isolated.sh`.
- `tests/`: Vitest suites, grouped by area, and `tests/e2e/` for Playwright.
- `deploy/`: `deploy.sh` (host deploy and rollback) and `systemd/` units.
- `proxy_server/`: shared Caddy proxy and `create-shared-network.sh`.
- `docs/superpowers/plans/`: roadmap, technical decisions and one plan per area.

## Getting started

Node is not needed on the host. Everything runs in containers. You need Docker with Compose v2.

1. Create the host environment file. Copy `.env.example` to `.env` and fill in the values on the host. Never commit it.
   - Names in `.env.example`: `POSTGRES_PASSWORD`, `ADMIN_DATABASE_URL`, `APP_DB_PASSWORD`, `POS_CREDENTIALS_KEY`, `ALLOW_DEV_DINER`, `BACKUP_DB_PASSWORD`, `FOOD_ADMIN_DB_PASSWORD`.
2. Create the shared network (safe to re-run):
   ```sh
   bash proxy_server/create-shared-network.sh
   ```
3. Start the database and Redis, then run migrations:
   ```sh
   docker compose up -d db redis
   docker compose run --rm migrate
   ```
4. Create the runtime login role once (after migrations 001 to 006). Pass the password from the host `.env` as a shell variable, not on the command line:
   ```sh
   docker exec -i food-os-db psql -U food -d food_os -v ON_ERROR_STOP=1 \
     -v app_password="$APP_DB_PASSWORD" < db/bootstrap/002_app_login.sql
   ```
5. Start the app:
   ```sh
   docker compose up -d --build app
   ```

In development the app publishes no host port. Its `/api/health` endpoint is reached through the shared network or the proxy. The database and Redis bind to `127.0.0.1` only, so host-side tools can connect.

## Running tests

- **Full suite (isolated):** runs Vitest in a `node:22-alpine` container against a per-run database `food_os_test_<runid>`. It runs migrations into that database and drops it afterwards. Tests never write to the shared `food_os` database.
  ```sh
  bash scripts/tests/run-isolated.sh /path/to/repo-or-worktree
  ```
  The script reads the host secrets file `.env.local`. The file is never printed or committed.
- **Typecheck:**
  ```sh
  docker run --rm -v "$PWD:/app" -w /app node:22-alpine npx tsc --noEmit
  ```
- **Journey end-to-end (`tests/e2e/journeys`):** run against a production build. Re-seed before each run. The CI pattern is in `.github/workflows/deploy.yml`.
- **Layout spec (`tests/e2e/layout.spec.ts`):** runs in the official Playwright image that matches the `@playwright/test` version. Set `ENABLE_DEV_PREVIEW=1` for that run only. The preview page is off by default.

## Database and migrations

- Migrations are applied in order by the one-shot `migrate` service. Applied migrations are never edited. A change is a new numbered file.
- The app container never receives the owner login (`ADMIN_DATABASE_URL`).
- Row-level security is enabled in the migrations (for example `users` and `restaurant_nodes`). `food_app_login` is not a superuser, so it does not bypass it.

## Security notes

Database roles:

- `food_app`: request traffic. Row-level security is enforced.
- `food_app_login`: the runtime login. It is a member of `food_app`.
- `food_sync`: the nightly menu sync only.
- `food_admin`: migrations, seeds and test fixtures.
- `food_backup`: read-only backups.

The app never connects as a superuser or table owner at runtime.

Secrets:

- Secrets live in host `.env` files (and `.env.local` for test runs). These files are never committed. `.gitignore` excludes `.env*`.
- Do not paste secrets into logs, reports, issues or commands. Pass them as variables.
- Security findings from test work are reported first. Fixes go on their own branch and are reviewed before merging.

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`:

1. **test:** typecheck and `npm test` against Postgres and Redis service containers.
2. **e2e:** starts the stack, migrates, creates the app login, seeds, and runs Playwright against `http://food-os-app:3000`.
3. **build:** builds the image and pushes it to GHCR with the tag `sha-<commit>`.
4. **deploy:** runs `/home/ubuntu/docker/deploy.sh sha-<commit>` over SSH on the host. The script is installed from `deploy/deploy.sh`. It pulls the image, runs migrations, starts the app, and checks health. On failure it rolls back to the previous tag.
5. **public health check:** requests the public `/api/health` endpoint.

Production uses `docker-compose.yml` with `docker-compose.prod.yml`. In production, no service publishes a host port. Postgres data is the named volume `food-os-pgdata` on the root disk (no separate data disk; storage decision 2026-11-04). Redis uses `food-os-redisdata`, and Caddy's data volume is also backed up. Backup scratch is `backups-scratch/` on the root disk and needs at least 20 GB free. Every service has CPU, memory and PID limits and bounded JSON logs.

No IP address is committed to this repository. The EC2 instance has an Elastic IP (region `ap-south-1`), so the address is stable across stop/start. It is stored only in the GitHub variable `EC2_HOST` and in the Cloudflare DNS record for the domain (proxied). The deploy reads `EC2_HOST` and `DOMAIN` from GitHub variables, and `EC2_USER`, `EC2_SSH_KEY` and `EC2_HOST_KEY` from GitHub secrets. `tests/config/no-hardcoded-ip.test.ts` fails if an IPv4 address other than loopback or an RFC 5737 documentation address is committed. Edge TLS: Cloudflare proxy (Full (strict)) to Caddy, which uses the Cloudflare Origin CA certificate at `/etc/caddy/origin`. See `docs/superpowers/plans/2026-11-03-deploy-runbook.md`.

## Plans and decisions

- `docs/superpowers/plans/2026-11-03-00-roadmap.md`: the roadmap and build order (01 to 08).
- `docs/superpowers/plans/2026-11-03-tech-decisions.md`: binding technical decisions.
- `docs/superpowers/plans/2026-11-03-provider-verification.md`: provider endpoints and checks still marked VERIFY.
- One plan per area, `2026-11-03-01-foundation.md` through `2026-11-03-08-frontend-foundation.md`.

## Open items

Owner:

- Domain name.
- Container registry read token.
- Production SSH host.
- Production `food_sync` password.
- EC2 security group rules: port 22 from the owner's IP only, ports 80 and 443 public.
- Mesh business values: ranking weights, counter-bid discount rule, pilot coordinates.
- The "₹180 saved" figure.
- Logo, final colours, and the neutral colour decision on some screens.

Vendor:

- Cashfree API version.
- MSG91 v5 endpoint and error shape.
- POS webhook signatures for Petpooja, Restroworks and UrbanPiper.

## Contributing

- Each plan is built in its own git worktree from `dev`. Merge into `dev` only after the full suite passes in a container.
- Do not push directly to `main`.
- Commit messages end with this trailer:
  `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`
- Do not commit `.env*` files, keys or secrets.
- Do not modify plan files during a build unless the plan is wrong. If it is wrong, record the deviation in the report and in `manifest.json`.
