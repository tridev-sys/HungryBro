#!/bin/sh
# Runs the vitest suite in node:22-alpine against a per-run database (food_os_test_<runid>).
# The shared food_os database is never migrated, written, or truncated by this script.
#
# Flow: record food_os counts, run vitest (tests/setup/test-database.ts creates the per-run
# database, migrates it, and drops it at teardown), drop the per-run database if a crash left
# it behind, record food_os counts again, and fail if the per-run database still exists.
#
# Usage: scripts/tests/run-isolated.sh <worktree-path> [vitest args...]
# Secrets come from /home/ubuntu/docker/.env.local, loaded in the shell. Never printed.
set -eu

WT="$1"; shift
set -a; . /home/ubuntu/docker/.env.local; set +a

RUN_ID="$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')"
DB_NAME="food_os_test_${RUN_ID}"
PG_IMAGE=postgis/postgis:16-3.4
PG_HOST=127.0.0.1

# Read-only or per-run-only psql through a throwaway container on the host network.
psql_q() {
  docker run --rm --network host -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_IMAGE" \
    psql -h "$PG_HOST" -U food -d "$1" -Atc "$2"
}

food_os_counts() {
  psql_q food_os "select 'users='||count(*) from users; select 'ratings='||count(*) from verified_customer_ratings; select 'auctions='||count(*) from mesh_food_auctions;" | tr '\n' ' '
}

cleanup() {
  # Belt and braces: drop only this run's database, only if teardown did not already.
  case "$DB_NAME" in food_os_test_[a-z0-9]*) ;; *) return 0 ;; esac
  psql_q postgres "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "run_id=$RUN_ID database=$DB_NAME"
echo "food_os before: $(food_os_counts)"

LOG_DIR="$WT/test-results"
LOG_FILE="$LOG_DIR/isolated-$RUN_ID.log"
mkdir -p "$LOG_DIR"

# The full vitest output goes to test-results/ (git-ignored) inside the worktree. The console gets
# only the summary and the first error block of each failed file (scripts/tests/vitest-summary.sh).
set +e
docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$WT":/app -w /app \
  -e TEST_DB_RUN_ID="$RUN_ID" \
  -e VITEST_LOG="/app/test-results/isolated-$RUN_ID.log" \
  -e ADMIN_DATABASE_URL="postgres://food:${POSTGRES_PASSWORD}@127.0.0.1:5432/food_os" \
  -e APP_DATABASE_URL="postgres://food_app_login:${APP_DB_PASSWORD}@127.0.0.1:5432/food_os" \
  -e SYNC_DATABASE_URL="postgres://food_sync:test-sync-only@127.0.0.1:5432/food_os" \
  -e DATABASE_URL="postgres://food_app_login:${APP_DB_PASSWORD}@127.0.0.1:5432/food_os" \
  -e REDIS_URL=redis://127.0.0.1:6379 \
  -e AUTH_JWT_SECRET=test-only-secret-not-for-production \
  node:22-alpine sh -c 'npx vitest run "$@" > "$VITEST_LOG" 2>&1; exit $?' sh "$@"
RC=$?
set -e

echo "----- vitest summary (full log: $LOG_FILE) -----"
if [ -f "$LOG_FILE" ]; then
  "$(dirname "$0")/vitest-summary.sh" "$LOG_FILE" || true
else
  echo "no vitest log was written to $LOG_FILE"
fi

LEFT="$(psql_q postgres "select count(*) from pg_database where datname = '$DB_NAME'")"
echo "per-run database remaining after run: $LEFT"
echo "food_os after: $(food_os_counts)"

echo "full vitest log: $LOG_FILE"

if [ "$LEFT" != "0" ]; then
  echo "FAIL: per-run database $DB_NAME was not dropped" >&2
  exit 1
fi
exit "$RC"
