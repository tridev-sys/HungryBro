#!/usr/bin/env bash
# scripts/verify-stack.sh
set -euo pipefail
docker compose config --quiet
docker network inspect shared >/dev/null 2>&1 || docker network create shared
docker compose up -d --build --wait
docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health | grep -q '"ok":true'
EXT=$(docker compose exec -T db psql -U food -d food_os -tAc "SELECT extname FROM pg_extension")
for e in postgis pgcrypto uuid-ossp; do echo "$EXT" | grep -qx "$e"; done
docker compose exec -T redis redis-cli ping | grep -q PONG
echo "stack OK"
