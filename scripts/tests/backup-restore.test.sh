#!/usr/bin/env bash
# Needs the compose stack up, migrations applied, and db/bootstrap/003_backup_roles.sql applied.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${BACKUP_DB_PASSWORD:?}"; : "${FOOD_ADMIN_DB_PASSWORD:?}"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export BACKUP_TARGET="file://$T" BACKUP_SCRATCH="$T" MIN_FREE_GIB=0
bash scripts/backup-pg.sh
dump=$(ls "$T"/pg/food_os-*.dump)
manifest="${dump%.dump}.counts.json"
test -s "$dump"
test -s "$manifest"

# Happy path
out=$(bash scripts/restore-check.sh "$dump")
echo "$out" | grep -q 'restore check OK'

# Review Focus 5: a manifest that disagrees with the restored data must fail
jq '.menu_items += 1' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
if bash scripts/restore-check.sh "$dump" > "$T/neg.log" 2>&1; then
  echo "FAIL: restore check passed with a wrong manifest" >&2; exit 1
fi
grep -q 'menu_items' "$T/neg.log"

# Scratch DB is always dropped
docker compose exec -T -e PGPASSWORD="$BACKUP_DB_PASSWORD" db psql -U food_backup -h 127.0.0.1 -d food_os -tAc \
  "SELECT count(*) FROM pg_database WHERE datname = 'food_os_restore_check'" | grep -qx 0
echo "backup-restore OK"
