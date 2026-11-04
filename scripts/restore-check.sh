#!/usr/bin/env bash
# Restores a backup into a scratch database and compares row counts with its manifest.
# Usage: restore-check.sh <local .dump path | file:// | s3:// key | latest>
# Passes (exit 0, "restore check OK") only when every table count matches the manifest exactly.
# Restore runs as food_admin; counts run as food_backup. The scratch database is always dropped.
# Env: BACKUP_TARGET, BACKUP_DB_PASSWORD, FOOD_ADMIN_DB_PASSWORD, BACKUP_SCRATCH.
set -euo pipefail
cd "$(dirname "$0")/.."

src="${1:?usage: restore-check.sh <dump path | latest>}"
: "${BACKUP_DB_PASSWORD:?set BACKUP_DB_PASSWORD}"
: "${FOOD_ADMIN_DB_PASSWORD:?set FOOD_ADMIN_DB_PASSWORD}"
SCRATCH_ROOT="${BACKUP_SCRATCH:-$PWD/backups-scratch}"
DB=food_os_restore_check
REMOTE_DUMP=/tmp/food_os_restore.dump
REMOTE_LIST=/tmp/food_os_restore.list

mkdir -p "$SCRATCH_ROOT"
work=$(mktemp -d "$SCRATCH_ROOT/restore.XXXXXX")
cleanup() {
  docker compose exec -T -e PGPASSWORD="$FOOD_ADMIN_DB_PASSWORD" db \
    psql -U food_admin -h 127.0.0.1 -d postgres -q -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1 || true
  docker compose exec -T db rm -f "$REMOTE_DUMP" "$REMOTE_LIST" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# Resolve the source to a local dump and manifest.
if [ "$src" = latest ]; then
  : "${BACKUP_TARGET:?set BACKUP_TARGET to resolve latest}"
  case "$BACKUP_TARGET" in
    s3://*) key=$(aws s3 ls "${BACKUP_TARGET%/}/pg/" --region ap-south-1 | awk '{print $4}' | grep '\.dump$' | sort | tail -1)
            src="${BACKUP_TARGET%/}/pg/$key" ;;
    file://*) src=$(ls "${BACKUP_TARGET#file://}"/pg/*.dump | sort | tail -1) ;;
    *) echo "unsupported BACKUP_TARGET" >&2; exit 1 ;;
  esac
fi
case "$src" in
  s3://*) aws s3 cp "$src" "$work/restore.dump" --region ap-south-1 --only-show-errors
          aws s3 cp "${src%.dump}.counts.json" "$work/restore.counts.json" --region ap-south-1 --only-show-errors ;;
  *) path="${src#file://}"; cp "$path" "$work/restore.dump"; cp "${path%.dump}.counts.json" "$work/restore.counts.json" ;;
esac
test -s "$work/restore.dump"
test -s "$work/restore.counts.json"

docker compose cp "$work/restore.dump" "db:$REMOTE_DUMP"
docker compose exec -T -e PGPASSWORD="$FOOD_ADMIN_DB_PASSWORD" db \
  psql -U food_admin -h 127.0.0.1 -d postgres -q -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER food_admin TEMPLATE food_os_restore_template"
# The template already has the PostGIS extensions and their schemas (superuser bootstrap). Drop the
# dump's EXTENSION entries and the extension-owned schemas from the restore list: a non-superuser
# cannot create them, and the template provides them. spatial_ref_sys is PostGIS reference data
# owned by the superuser; the template already has it. The tiger and topology schemas and their
# reference tables belong to PostGIS extensions too, so they are dropped from the list as well.
docker compose exec -T db pg_restore -l "$REMOTE_DUMP" > "$work/full.list"
grep -v -E '(^| )EXTENSION - |COMMENT - EXTENSION |spatial_ref_sys| (tiger|tiger_data|topology)[ .]' "$work/full.list" > "$work/restore.list"
docker compose cp "$work/restore.list" "db:$REMOTE_LIST"
docker compose exec -T -e PGPASSWORD="$FOOD_ADMIN_DB_PASSWORD" db \
  pg_restore -U food_admin -h 127.0.0.1 -d "$DB" --no-owner --no-privileges --no-comments --exit-on-error -L "$REMOTE_LIST" "$REMOTE_DUMP"

actual=$(docker compose exec -T -e PGPASSWORD="$BACKUP_DB_PASSWORD" db \
  psql -U food_backup -h 127.0.0.1 -d "$DB" -At -v ON_ERROR_STOP=1 \
  -c "SELECT json_build_object(
        'restaurant_nodes', (SELECT count(*) FROM restaurant_nodes),
        'menu_items', (SELECT count(*) FROM menu_items),
        'menu_categories', (SELECT count(*) FROM menu_categories),
        'dining_tables', (SELECT count(*) FROM dining_tables),
        'tabletop_sessions', (SELECT count(*) FROM tabletop_sessions),
        'kds_tickets', (SELECT count(*) FROM kds_tickets),
        'mesh_food_auctions', (SELECT count(*) FROM mesh_food_auctions),
        'verified_customer_ratings', (SELECT count(*) FROM verified_customer_ratings))" | grep -E '^\{' | tail -1)
expected=$(jq -c . "$work/restore.counts.json")

fail=0
keys=$(printf '%s\n%s\n' "$(jq -r 'keys[]' <<<"$expected")" "$(jq -r 'keys[]' <<<"$actual")" | sort -u)
for t in $keys; do
  e=$(jq -r --arg t "$t" '.[$t] // "missing"' <<<"$expected")
  a=$(jq -r --arg t "$t" '.[$t] // "missing"' <<<"$actual")
  if [ "$e" != "$a" ]; then
    echo "MISMATCH $t: manifest=$e restored=$a"
    fail=1
  fi
done
if [ "$fail" -ne 0 ]; then
  echo "restore check FAILED"
  exit 1
fi
echo "restore check OK"
