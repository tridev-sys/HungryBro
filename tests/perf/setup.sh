#!/bin/sh
# Brings up the perf stack: perf-net, perf-db (Postgres/PostGIS), perf-redis, migrations, the
# app login bootstrap, the mesh seed, and perf-app on 127.0.0.1:3302. Never touches food-os-*.
set -eu
. "$(dirname "$0")/env.sh"

docker network inspect "$PERF_NET" >/dev/null 2>&1 || docker network create "$PERF_NET" >/dev/null

if ! docker inspect perf-db >/dev/null 2>&1; then
  docker run -d --name perf-db --network "$PERF_NET" --cpus 2 --memory 2g --memory-reservation 1g \
    --pids-limit 256 --shm-size 256m -e POSTGRES_USER=food -e POSTGRES_DB=food_os \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" --tmpfs /var/lib/postgresql/data:rw,size=2g \
    postgis/postgis:16-3.4 >/dev/null
fi
if ! docker inspect perf-redis >/dev/null 2>&1; then
  docker run -d --name perf-redis --network "$PERF_NET" --cpus 0.5 --memory 320m --memory-reservation 128m \
    --pids-limit 128 redis:7-alpine redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru >/dev/null
fi
for _ in $(seq 1 60); do docker exec perf-db pg_isready -U food -d food_os >/dev/null 2>&1 && break; sleep 1; done
docker exec perf-redis redis-cli ping >/dev/null

# Build once (deps and Next build run inside node:22-alpine).
docker run --rm -v "$PERF_WT":/app -w /app node:22-alpine sh -c 'npm ci --no-audit --no-fund && npm run build' >/tmp/perf-build.log 2>&1 \
  || { echo "build failed, see /tmp/perf-build.log" >&2; exit 1; }

perf_node npx tsx scripts/migrate-cli.ts >/dev/null
docker exec -i perf-db psql -U food -d food_os -v ON_ERROR_STOP=1 -q -v app_password="$APP_DB_PASSWORD" < "$PERF_WT/db/bootstrap/002_app_login.sql" >/dev/null
perf_node npx tsx scripts/seed-mesh-dev.ts >/dev/null
echo "database migrated, login role bootstrapped, mesh seed applied"
sh "$(dirname "$0")/start-app.sh" "${1:-}"
