#!/usr/bin/env bash
# Logging rule (tech decisions, binding): every service keeps a bounded json-file log (10m x 3).
# The awslogs driver is NOT used, because it cannot be combined with the json-file caps. The CloudWatch
# agent on the host ships the Docker json logs. The CloudWatch retention and alarm are host/AWS steps (NOT RUN here).
set -euo pipefail
cd "$(dirname "$0")/../.."
export IMAGE_TAG=sha-0000000000000000000000000000000000000000 GHCR_OWNER=example DOMAIN=test.example.com \
  ACME_EMAIL=ops@example.com POSTGRES_PASSWORD=change-me APP_DB_PASSWORD=change-me \
  ADMIN_DATABASE_URL=postgres://food:change-me@db:5432/food_os
cfg=$(docker compose -f docker-compose.yml -f docker-compose.prod.yml config --format json)
pcfg=$(docker compose -f proxy_server/docker-compose.yml config --format json)
(echo "$cfg"; echo "$pcfg") | jq -e -s '
  [ .[].services | to_entries[] | .value.logging ] as $l
  | ([.[].services | keys[]] | length) == ($l | length)
    and all($l[]; .driver == "json-file" and .options["max-size"] == "10m" and .options["max-file"] == "3")' >/dev/null \
  || { echo "FAIL: a service is missing the bounded json-file log" >&2; exit 1; }
(echo "$cfg"; echo "$pcfg") | jq -e -s '[.[].services[] | .logging.driver] | any(. == "awslogs") | not' >/dev/null \
  || { echo "FAIL: awslogs driver found" >&2; exit 1; }
echo "logging OK"
