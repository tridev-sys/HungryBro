#!/usr/bin/env bash
# scripts/tests/prod-compose.test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export IMAGE_TAG=sha-0000000000000000000000000000000000000000 GHCR_OWNER=example DOMAIN=test.example.com \
  ACME_EMAIL=ops@example.com POSTGRES_PASSWORD=change-me APP_DB_PASSWORD=change-me \
  ADMIN_DATABASE_URL=postgres://food:change-me@db:5432/food_os
cfg=$(docker compose -f docker-compose.yml -f docker-compose.prod.yml config --format json)
pcfg=$(docker compose -f proxy_server/docker-compose.yml config --format json)
j() { echo "$cfg" | jq -e "$1" >/dev/null || { echo "FAIL: $1" >&2; exit 1; }; }
p() { echo "$pcfg" | jq -e "$1" >/dev/null || { echo "FAIL (proxy): $1" >&2; exit 1; }; }

# Review Focus 4: across the whole stack, exactly 80 and 443 are published, both by proxy-caddy
p '.services.caddy.container_name == "proxy-caddy" and .services.caddy.image == "caddy:2-alpine"'
p '[.services.caddy.ports[].published | tonumber] | sort == [80, 443]'
all=$( (echo "$cfg"; echo "$pcfg") | jq -cs '[.[].services[] | (.ports // [])[] | .published | tonumber] | sort')
[ "$all" = "[80,443]" ] || { echo "FAIL: published ports across the stack are $all" >&2; exit 1; }
j '([.services.app.ports // []] | flatten | length) == 0'
j '([.services.db.ports // []] | flatten | length) == 0'
j '([.services.redis.ports // []] | flatten | length) == 0'

# CPU and memory caps (tech decisions, "Container resource limits")
j '(.services.app.cpus | tonumber) == 1.5 and (.services.app.mem_limit | tonumber) == 1073741824'
j '(.services.db.cpus | tonumber) == 2.0 and (.services.db.mem_limit | tonumber) == 2147483648'
j '(.services.redis.cpus | tonumber) == 0.5 and (.services.redis.mem_limit | tonumber) == 335544320'
p '(.services.caddy.cpus | tonumber) == 0.5 and (.services.caddy.mem_limit | tonumber) == 134217728'

# Storage decision 2026-11-04: production Postgres is the named volume food-os-pgdata on the root disk.
# The 100 GB data disk is detached and no production file may depend on /home/ubuntu/docker/data.
j '[.services.db.volumes[] | select(.target == "/var/lib/postgresql/data") | .type, .source] == ["volume", "pgdata"]'
j '.volumes.pgdata.name == "food-os-pgdata"'
j '(.volumes.pgdata.labels.app == "food-os") and (.volumes.pgdata.labels.purpose == "postgres-data")'
if grep -rn --exclude-dir=tests -e '/home/ubuntu/docker/data' -e 'PGDATA_DIR' \
    docker-compose.yml docker-compose.prod.yml .env.example README.md deploy scripts proxy_server >&2; then
  echo "FAIL: production files still reference the data disk or PGDATA_DIR (listed above)" >&2
  exit 1
fi

# Backup scratch lives on the root disk inside the repo and refuses to run below the free-space floor.
grep -q 'SCRATCH_ROOT="${BACKUP_SCRATCH:-$PWD/backups-scratch}"' scripts/backup-pg.sh \
  || { echo "FAIL: backup-pg.sh default scratch is not backups-scratch" >&2; exit 1; }
scratch_t=$(mktemp -d)
set +e
out=$(BACKUP_TARGET="file://$scratch_t/target" BACKUP_DB_PASSWORD=change-me BACKUP_SCRATCH="$scratch_t/scratch" \
  MIN_FREE_GIB=999999 bash scripts/backup-pg.sh 2>&1)
rc=$?
set -e
rm -rf "$scratch_t"
[ "$rc" -ne 0 ] && echo "$out" | grep -q 'need 999999' \
  || { echo "FAIL: backup-pg.sh did not refuse below the free-space threshold: $out" >&2; exit 1; }

# Redis cap and eviction
j '(.services.redis.command | if type == "array" then join(" ") else . end) | contains("--maxmemory 256mb") and contains("--maxmemory-policy allkeys-lru")'

# Network isolation: app is on shared and backend; db and redis only on backend; proxy only on shared
j '(.services.app.networks | keys | sort) == ["backend", "shared"]'
j '.networks.shared.external == true'
j '(.services.db.networks | keys) == ["backend"]'
j '(.services.redis.networks | keys) == ["backend"]'
p '(.services.caddy.networks | keys) == ["shared"]'

# Migrations run in the one-shot migrate service only. The app container never holds the owner login.
j '(.services.app | tostring | contains("ADMIN_DATABASE_URL")) | not'
j '(.services.app.environment // {} | has("ADMIN_DATABASE_URL")) | not'
j '(.services.migrate.environment | has("ADMIN_DATABASE_URL"))'
j '.services.app.depends_on.migrate.condition == "service_completed_successfully"'
j '(.services.migrate.ports // []) | length == 0'
j '(.services.migrate.networks | keys) == ["backend"]'

echo "prod compose OK"
