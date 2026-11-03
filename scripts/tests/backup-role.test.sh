#!/usr/bin/env bash
# Needs the compose stack up and the ops bootstrap (db/bootstrap/003_backup_roles.sql) applied.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${BACKUP_DB_PASSWORD:?}"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
psql_backup() {
  docker compose exec -T -e PGPASSWORD="$BACKUP_DB_PASSWORD" db psql -h 127.0.0.1 -U food_backup -d food_os -v ON_ERROR_STOP=1 "$@"
}
# food_backup can read
n=$(psql_backup -tAc 'SELECT count(*) FROM restaurant_nodes')
[[ "$n" =~ ^[0-9]+$ ]]
# food_backup cannot write: the INSERT is rejected with a permission error (WHERE false inserts no rows)
if psql_backup -c 'INSERT INTO restaurant_nodes SELECT * FROM restaurant_nodes WHERE false' > "$T/ins.log" 2>&1; then
  echo "FAIL: food_backup INSERT succeeded" >&2; exit 1
fi
grep -q 'permission denied' "$T/ins.log"
echo "backup-role OK"
