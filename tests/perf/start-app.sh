#!/bin/sh
# (Re)starts the perf app instance: perf-app, 127.0.0.1:3302, caps match docker-compose.yml (app 1.5 CPU / 1 GB).
# Usage: sh tests/perf/start-app.sh [SANDBOX_BID_DELAY_MS]   (default: unset, so the app default 4000 applies)
set -eu
. "$(dirname "$0")/env.sh"
docker rm -f perf-app >/dev/null 2>&1 || true
DELAY_ARG=""
if [ "${1:-}" != "" ]; then DELAY_ARG="-e SANDBOX_BID_DELAY_MS=$1"; fi
# shellcheck disable=SC2086
docker run -d --name perf-app --network "$PERF_NET" -p 127.0.0.1:3302:3000 \
  --cpus 1.5 --memory 1g --memory-reservation 512m --pids-limit 512 \
  -v "$PERF_WT":/app -w /app $DELAY_ARG \
  -e NODE_ENV=production -e HOSTNAME=0.0.0.0 \
  -e AUTH_JWT_SECRET -e OTP_HMAC_KEY -e APP_DATABASE_URL -e REDIS_URL \
  node:22-alpine sh -c 'npm run start -- -H 0.0.0.0 -p 3000' >/dev/null
for _ in $(seq 1 60); do
  if curl -fs -o /dev/null http://127.0.0.1:3302/api/health; then echo "perf-app up on 127.0.0.1:3302"; exit 0; fi
  sleep 1
done
echo "perf-app did not become healthy" >&2
exit 1
