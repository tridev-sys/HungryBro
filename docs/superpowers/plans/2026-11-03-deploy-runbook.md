# Deploy runbook: hungrybro.pacewisdom.in

Date: 2026-11-04. Status: prepared on branch `feat/deploy-cloudflare-eip`, not merged, not deployed.

Legend: **OWNER** = a step only the owner does (needs console, DNS, secrets or a credential). **ENGINEER** = a step the engineer runs. Secret values are never written in this file, in commits, in logs or in chat. Placeholders: `<EIP>` is the AWS Elastic IP (owner console), `<SHA>` is the 40-character commit to deploy.

Fixed decisions (owner, 2026-11-04):
- Domain `hungrybro.pacewisdom.in`, DNS in Cloudflare, proxy ON (orange cloud).
- Cloudflare SSL/TLS mode **Full (strict)**.
- TLS on the origin is the Cloudflare Origin CA certificate at `/etc/caddy/origin/cert.pem` and `/etc/caddy/origin/key.pem` (host paths, mounted read-only into `proxy-caddy`). No Let's Encrypt.
- Host: AWS EC2 `c7i.xlarge`, `ap-south-1`, Elastic IP `<EIP>`.
- Security group: port 22 from the owner's IP only; 80 and 443 from anywhere. Nothing else.

Engineering decisions recorded here (not owner-facing):
- GitHub holds only the deploy identity and the pinned host key: variables `EC2_HOST`, `DOMAIN`; secrets `EC2_USER`, `EC2_SSH_KEY`, `EC2_HOST_KEY`.
- Production runtime secrets (database, app, POS key, LLM keys, `GHCR_TOKEN`) live only in the host file `/home/ubuntu/docker/.env` (mode 600). `deploy/deploy.sh` and `docker-compose.prod.yml` read them from there, so they are not copied into GitHub.
- The `GHCR_TOKEN` read-only token is therefore set in the host `.env`, not as a GitHub secret. The workflow does not use a GitHub copy of it.

---

## Go-live deviations (2026-11-09, owner decisions)

These decisions override the "Fixed decisions" above where they differ. Review dates are proposed by engineering; the owner confirms them.

1. **Cloudflare SSL/TLS mode is Flexible** (not Full (strict)). Reason: set by the owner's boss; the owner may not change Cloudflare settings. Consequence: Cloudflare connects to the origin over plain HTTP on port 80. `proxy_server/Caddyfile` serves HTTP only for `hungrybro.pacewisdom.in` with no redirect to HTTPS (this removes the redirect loop). Visitor-to-Cloudflare traffic stays HTTPS. Cloudflare-to-origin traffic is unencrypted. The Origin CA certificate (A1, A3) is NOT used. Accepted risk, to review. Review date: 2026-11-23 (proposed).
   - Note: the Flexible-mode Caddyfile is an uncommitted change in `/home/ubuntu/docker` (`M proxy_server/Caddyfile`). The committed version on `dev` still has the Full (strict) HTTPS block. Commit or revert it deliberately; do not deploy either version by accident.
   - Note: section F2 (HTTP redirects to HTTPS) does not apply under Flexible mode. The HTTP site answers directly.
2. **Header trust: port 443 is open to all.** Reason: the owner declined Cloudflare Authenticated Origin Pulls. Consequence: any client that reaches the origin directly can send a forged `CF-Connecting-IP`, which the app trusts for the client address. Review option: host UFW allowing 443 (and 80) only from Cloudflare IP ranges. Needs owner approval. Review date: 2026-11-23 (proposed).
3. **Dev and prod share one environment and one database.** Reason: owner decision. Database `food_os` in container `food-os-db` holds both test and production data. Consequence: test data lives alongside production data. The test runner still uses a per-run database (`food_os_test_<runid>`) and never writes to `food_os`. Review date: 2026-11-23 (proposed).
4. **Image is built locally** as `food-os-app:go-live`, not pulled from GHCR, for the first launch. Reason: first-launch decision. Consequence: `deploy.sh` and the GHCR pull path in E3 are not used for this launch. Review date: 2026-11-16 (proposed).
5. **Sign-in codes use email OTP** (`OTP_PROVIDER=email`) through Brevo SMTP (free tier, about 300 emails a day). `SMTP_FROM` is the owner's verified address (tridev.g@pacewisdom.com) until a company domain sender is verified. Reason: owner decision. Consequence: daily sign-in volume is capped at about 300 emails; the sender is a personal address. Review date: 2026-11-16 (proposed).
6. **AI key: `GEMINI_API_KEY` is used** (Gemini `gemini-2.5-flash`). Reason: owner decision. The Claude key is not set. Consequence: the LLM path is Gemini only until a Claude key is added. Review date: 2026-12-07 (proposed).
7. **Backup login role `food_backup` does not exist yet.** Consequence: backups are not set up. The E1 bootstrap step for `003_backup_roles.sql` must be checked before relying on it. Review date: before real traffic.
8. **Migrations present now go to 013** (`013_verified_email_claim.sql`), not 009 as listed in the project notes. This runbook is updated; `CLAUDE.md` is not changed by this section.
9. **Internal secrets in the server `.env` were generated on 2026-11-09** by engineering with owner approval. Values are not recorded anywhere in this repo or in this file. Names only: `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `BACKUP_DB_PASSWORD`, `FOOD_ADMIN_DB_PASSWORD`, `POS_CREDENTIALS_KEY`, `AUTH_JWT_SECRET`, `OTP_HMAC_KEY`, `TOTP_ENCRYPTION_KEY`, `GEMINI_API_KEY`, `SMTP_*`, `OTP_PROVIDER`.

### Before real traffic (checklist)

- [ ] Header trust decision recorded by the owner (deviation 2): accept as is, or approve host UFW limited to Cloudflare ranges.
- [ ] Flexible-mode risk reviewed (deviation 1): owner accepts unencrypted Cloudflare-to-origin traffic, or Cloudflare mode is changed by whoever controls it.
- [ ] Company domain sender verified for `SMTP_FROM` (deviation 5). Until then, the sender is the owner's personal address.
- [ ] Backup role `food_backup` created and tested (deviation 7).
- [ ] Off-host backup decision made. Backups currently stay on the root disk (`/home/ubuntu/docker/backups-scratch`), which is not off-host.

---

## Phase A. Certificate and network (OWNER)

### A1. OWNER: create the origin certificate (Cloudflare dashboard)
1. Cloudflare, zone `pacewisdom.in`: SSL/TLS, Origin Server, Create Certificate. Hostnames: `hungrybro.pacewisdom.in`. Key type RSA (2048), validity 15 years.
2. Save the certificate and private key into a password manager. Do not paste the key into chat, tickets or files in the repo.
3. SSL/TLS, Overview: set the mode to **Full (strict)**.
4. DNS: record `A hungrybro` → `<EIP>`, proxy status **Proxied** (orange cloud).

### A2. OWNER: security group (AWS console, region ap-south-1)
1. Inbound rules: `TCP 22` from the owner's IP only (`/32`); `TCP 80` from `0.0.0.0/0`; `TCP 443` from `0.0.0.0/0`. Remove any other inbound rule.
2. Confirm the Elastic IP `<EIP>` is associated with the instance.

### A3. OWNER: place the certificate on the server
Run on the server over SSH. Paste the files from the password manager into temporary files in your home folder, then move them:
```sh
sudo install -d -o root -g root -m 755 /etc/caddy/origin
sudo install -o root -g root -m 644 ~/origin-cert.pem /etc/caddy/origin/cert.pem
sudo install -o root -g root -m 600 ~/origin-key.pem  /etc/caddy/origin/key.pem
shred -u ~/origin-cert.pem ~/origin-key.pem
```
Check (prints names, modes and the certificate's subject and expiry only, never the key):
```sh
sudo ls -l /etc/caddy/origin
sudo openssl x509 -in /etc/caddy/origin/cert.pem -noout -subject -enddate
```
Expected: `key.pem` is `-rw-------` owned by root, subject contains `hungrybro.pacewisdom.in`.

---

## Phase B. GitHub variables and secrets (OWNER)

Settings, Secrets and variables, Actions. Names only; values are entered by the owner.

### B1. OWNER: variables (Variables tab, repository or `production` environment)
- `EC2_HOST` = `<EIP>`
- `DOMAIN` = `hungrybro.pacewisdom.in`

### B2. OWNER: secrets (Secrets tab, repository or `production` environment)
- `EC2_USER` = the SSH login user on the server (`ubuntu`).
- `EC2_SSH_KEY` = the private key of a deploy key pair (ed25519). Its public half goes into `/home/ubuntu/.ssh/authorized_keys` on the server. Generate it on the owner's laptop, never on the server.
- `EC2_HOST_KEY` = the server's SSH host public key line, captured once in B3.

### B3. OWNER + ENGINEER: capture and verify the SSH host key
1. OWNER, on the laptop: `ssh-keyscan -t ed25519 <EIP> > ~/hostkey-scan.txt`. The file holds one line that starts with `<EIP> ssh-ed25519 ...`.
2. OWNER, on the EC2 serial console or EC2 Instance Connect (not over the scanned connection): `sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`. Note the fingerprint `SHA256:...`.
3. ENGINEER or OWNER, on the laptop: `ssh-keygen -lf ~/hostkey-scan.txt`. The fingerprint must equal the step 2 fingerprint. If it does not match, stop and do not set the secret.
4. OWNER: paste the single line from `~/hostkey-scan.txt` into the secret `EC2_HOST_KEY`. Delete the scan file.

### B4. OWNER: production runtime values (host file, not GitHub)
On the server, create `/home/ubuntu/docker/.env` from `.env.example` with mode 600 (`install -m 600 /dev/null /home/ubuntu/docker/.env`, then edit). Enter real values for: `POSTGRES_PASSWORD`, `ADMIN_DATABASE_URL`, `APP_DB_PASSWORD`, `BACKUP_DB_PASSWORD`, `FOOD_ADMIN_DB_PASSWORD`, `POS_CREDENTIALS_KEY`, `AUTH_JWT_SECRET`, the LLM API key(s) for the chosen provider, `GHCR_OWNER` (lowercase GitHub owner), `GHCR_TOKEN` (new fine-grained token, **read packages only**), `GHCR_USER` (optional), `IMAGE_TAG` (set by deploy.sh). Keep `PILOT_SEED_ENABLED=0` and `PILOT_SEED_ALLOW_PROD=0`.
Do not copy `.env.local`. It is a test-only file.

---

## Phase C. Server preparation (ENGINEER, with OWNER SSH access)

### C1. ENGINEER: put the merged code on the host
Prerequisite: this branch is merged into `dev` and then `main` with owner approval (not done by this task). On the host:
```sh
cd /home/ubuntu/docker
git fetch origin
git status --short          # must show no tracked changes
git checkout main && git pull --ff-only origin main
git rev-parse HEAD          # record the commit; it becomes <SHA> for the deploy
```
Then confirm the proxy files are present: `ls proxy_server/Caddyfile proxy_server/docker-compose.yml`.

### C2. ENGINEER: create the shared network (safe to re-run)
```sh
cd /home/ubuntu/docker
bash proxy_server/create-shared-network.sh
```
Expected output: `shared network ready`.

### C3. ENGINEER: check the proxy config before starting it
```sh
cd /home/ubuntu/docker/proxy_server
docker compose -f docker-compose.yml config --format json | jq '[.services.caddy.ports[].published]'
```
Expected: `["80","443"]`. Stop here if the list differs.

---

## Phase D. Start the proxy (ENGINEER)

### D1. ENGINEER: start the proxy
```sh
cd /home/ubuntu/docker/proxy_server
docker compose -f docker-compose.yml up -d
docker ps --format '{{.Names}}\t{{.Ports}}' | grep proxy-caddy
```
Expected: `proxy-caddy` publishes only `0.0.0.0:80->80` and `0.0.0.0:443->443`. Nothing else on the host is published.

### D2. ENGINEER: check the proxy logs (no secrets are logged)
```sh
docker logs --tail 50 proxy-caddy
```
Expected: no `obtaining certificate` lines, no `error`. A `502` at this point is normal until the app is up (step E).

---

## Phase E. Deploy the app (ENGINEER; OWNER approves the SHA)

### E1. ENGINEER: first-time database setup (only if the database is new)
The compose stack must have Postgres running. Start the database, run migrations, then create the runtime roles once:
```sh
cd /home/ubuntu/docker
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d db redis
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env run --rm migrate
docker exec -i food-os-db psql -U food -d food_os -v ON_ERROR_STOP=1 \
  -v app_password="$(grep '^APP_DB_PASSWORD=' .env | cut -d= -f2-)" < db/bootstrap/002_app_login.sql
docker exec -i food-os-db psql -U food -d postgres -v ON_ERROR_STOP=1 \
  -v backup_pw="$(grep '^BACKUP_DB_PASSWORD=' .env | cut -d= -f2-)" \
  -v admin_pw="$(grep '^FOOD_ADMIN_DB_PASSWORD=' .env | cut -d= -f2-)" < db/bootstrap/003_backup_roles.sql
```
Passwords are read from `.env` inside the shell and are not printed. Skip this step if the roles already exist (`food_app_login`, `food_backup`, `food_admin`).

### E2. OWNER: approve the commit
OWNER confirms the `<SHA>` from C1 is the one to deploy.

### E3. ENGINEER: deploy by SHA
Preferred: merge to `main` so the workflow `.github/workflows/deploy.yml` runs (build, test, e2e, then deploy). Manual equivalent on the host, with the image already in GHCR:
```sh
/home/ubuntu/docker/deploy.sh sha-<SHA>
```
Expected: `deployed sha-<SHA>`. On failure the script rolls back and prints `rolled back to ...` or `ROLLBACK FAILED; manual action required`. Stop and report in the second case.

---

## Phase F. Smoke test (ENGINEER; OWNER may repeat from any network)

### F1. Health through Cloudflare
```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://hungrybro.pacewisdom.in/api/health
```
Expected: `200`. Owner's check: `curl -I https://hungrybro.pacewisdom.in/api/health` should return `HTTP/2 200`. If the `-I` (HEAD) request returns `405` while the GET above returns `200`, the route does not answer HEAD; the GET result is the pass criterion.

Also confirm the body: `curl -sS https://hungrybro.pacewisdom.in/api/health` contains `"ok":true`.

### F2. HTTP redirects to HTTPS
```sh
curl -sI http://hungrybro.pacewisdom.in/ | grep -i '^location'
```
Expected: `location: https://hungrybro.pacewisdom.in/`.

### F3. Cloudflare is in front and the origin cert is trusted
```sh
curl -sI https://hungrybro.pacewisdom.in/api/health | grep -i '^server'
```
Expected: `server: cloudflare`. A `526` or `525` means Full (strict) is failing: check the origin certificate files (A3) and the SSL/TLS mode (A1).

---

## Phase G. Pilot seeder: NOT in production (OWNER decision and engineering rule)

### G1. ENGINEER: confirm the seeder is off
The seeder (`scripts/seed-pilot-geo.ts`) must not run against production. Confirm in the host `.env`: `PILOT_SEED_ENABLED=0` and `PILOT_SEED_ALLOW_PROD=0`. Do not run `scripts/seed.ts` or `scripts/seed-pilot-geo.ts` on the production database. The mock restaurants are created only by a manual run in a test or staging database.

---

## Rollback

- App: `/home/ubuntu/docker/deploy.sh sha-<previous>` (or the value in `/home/ubuntu/docker/state/previous_tag`).
- Proxy: revert the Caddyfile to the previous commit, then `cd /home/ubuntu/docker/proxy_server && docker compose -f docker-compose.yml up -d`. Volumes `proxy-caddy-data` and `proxy-caddy-config` are never removed by `down`.
- Never remove the `food-os-pgdata` volume or run `docker compose down -v`.
