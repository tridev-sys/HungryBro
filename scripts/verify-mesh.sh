#!/usr/bin/env bash
# scripts/verify-mesh.sh
set -euo pipefail
export DATABASE_URL="postgres://food:${POSTGRES_PASSWORD}@localhost:5432/food_os"
export REDIS_URL="redis://localhost:6379"
export ALLOW_DEV_DINER=1
export SANDBOX_BID_DELAY_MS=0
docker compose up -d --build --wait
npx tsx scripts/seed-mesh-dev.ts
npx vitest run
body='{"transcript":"Biryani & Kebab under 800 in 30 min","intent":{"modality":"DELIVERY","budget_ceiling_inr":800,"sla_max_minutes":30,"headcount":3,"target_dietary_profiles":[],"items_requested":[{"query":"biryani","serving_target":2},{"query":"kebab","serving_target":1}],"client_coordinates":{"lat":12.9719,"lng":77.6408}}}'
out=$(mktemp)
trap 'rm -f "$out"' EXIT
code=$(curl -s -o "$out" -w '%{http_code}' -H 'content-type: application/json' -d "$body" http://localhost:3000/api/delivery/intent)
test "$code" = "201"
grep -q '"bundles"' "$out"
echo "mesh OK"
