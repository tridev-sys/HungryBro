#!/usr/bin/env bash
# Nightly logical backup of food_os. Dump and row counts come from ONE exported snapshot, so the
# manifest matches the dump exactly even while the app is writing.
# Env: BACKUP_TARGET (s3://bucket/prefix, or file:///dir for tests only), BACKUP_DB_PASSWORD,
#      BACKUP_SCRATCH (default $REPO/backups-scratch on the root disk), MIN_FREE_GIB (default 20).
#      The script refuses to run when less than MIN_FREE_GIB GiB is free in BACKUP_SCRATCH.
# Runs from the repository root, using the compose project in scope (COMPOSE_PROJECT_NAME / COMPOSE_FILE).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${BACKUP_TARGET:?set BACKUP_TARGET (s3://bucket/prefix)}"
: "${BACKUP_DB_PASSWORD:?set BACKUP_DB_PASSWORD}"
MIN_FREE_GIB="${MIN_FREE_GIB:-20}"
SCRATCH_ROOT="${BACKUP_SCRATCH:-$PWD/backups-scratch}"
COUNT_TABLES=(restaurant_nodes menu_items menu_categories dining_tables tabletop_sessions kds_tickets mesh_food_auctions verified_customer_ratings)

if [ "${NODE_ENV:-}" = production ] && [[ "$BACKUP_TARGET" == file://* ]]; then
  echo "refusing file:// backup target in production" >&2
  exit 1
fi

mkdir -p "$SCRATCH_ROOT"
# POSIX df: available KiB in column 4 of the data line, converted to GiB.
free_gib=$(df -Pk "$SCRATCH_ROOT" | awk 'NR==2 {print int($4 / 1048576)}')
if [ "$free_gib" -lt "$MIN_FREE_GIB" ]; then
  echo "only ${free_gib} GiB free in $SCRATCH_ROOT; need $MIN_FREE_GIB" >&2
  exit 1
fi

work=$(mktemp -d "$SCRATCH_ROOT/backup.XXXXXX")
ctl="$work/ctl.fifo"
out="$work/snapshot.out"
psql_pid=""
cleanup() {
  exec 9>&- 2>/dev/null || true
  if [ -n "$psql_pid" ]; then kill "$psql_pid" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

# Session A holds a REPEATABLE READ transaction open and exports its snapshot. It stays open
# until the counts are read, which keeps the snapshot valid for pg_dump.
mkfifo "$ctl"
docker compose exec -T -e PGPASSWORD="$BACKUP_DB_PASSWORD" db \
  psql -U food_backup -h 127.0.0.1 -d food_os -At -v ON_ERROR_STOP=1 < "$ctl" > "$out" 2>"$work/psql.err" &
psql_pid=$!
exec 9>"$ctl"
printf 'BEGIN ISOLATION LEVEL REPEATABLE READ;\nSELECT pg_export_snapshot();\n' >&9

snap=""
for _ in $(seq 1 150); do
  snap=$(grep -E '^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$' "$out" 2>/dev/null | head -1 || true)
  [ -n "$snap" ] && break
  sleep 0.2
done
if [ -z "$snap" ]; then
  echo "could not export a snapshot" >&2
  cat "$work/psql.err" >&2 || true
  exit 1
fi

ts=$(date -u +%Y%m%dT%H%M%SZ)
name="food_os-$ts"
docker compose exec -T -e PGPASSWORD="$BACKUP_DB_PASSWORD" db \
  pg_dump -U food_backup -h 127.0.0.1 -d food_os -Fc --no-owner --no-privileges --snapshot="$snap" \
  > "$work/$name.dump"

parts=""
for t in "${COUNT_TABLES[@]}"; do parts+="${parts:+, }'$t', (SELECT count(*) FROM $t)"; done
json_sql="SELECT json_build_object($parts);"
printf '%s\nCOMMIT;\n' "$json_sql" >&9
exec 9>&-
wait "$psql_pid" || { echo "snapshot session failed" >&2; cat "$work/psql.err" >&2 || true; exit 1; }
psql_pid=""

counts=$(grep -E '^\{' "$out" | tail -1)
if [ -z "$counts" ]; then
  echo "row counts were not returned" >&2
  exit 1
fi
printf '%s\n' "$counts" | jq -S . > "$work/$name.counts.json"
test -s "$work/$name.dump"

publish() {  # publish <local file> <key under pg/>
  case "$BACKUP_TARGET" in
    s3://*) aws s3 cp "$1" "${BACKUP_TARGET%/}/pg/$2" --region ap-south-1 --only-show-errors ;;
    file://*) local dir="${BACKUP_TARGET#file://}/pg"; mkdir -p "$dir"; cp "$1" "$dir/$2" ;;
    *) echo "unsupported BACKUP_TARGET" >&2; exit 1 ;;
  esac
}
publish "$work/$name.dump" "$name.dump"
publish "$work/$name.counts.json" "$name.counts.json"
echo "backup OK: $name"
