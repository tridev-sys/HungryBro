#!/usr/bin/env bash
# Exercises deploy/deploy.sh against a temp folder and a stub docker CLI (no registry, no host).
# Covers: a good deploy, a bad tag that fails at pull, and a bad tag that fails the health check.
set -euo pipefail
cd "$(dirname "$0")/../.."
SCRIPT="$PWD/deploy/deploy.sh"
OLD=sha-1111111111111111111111111111111111111111
GOOD=sha-2222222222222222222222222222222222222222
BAD_PULL=sha-3333333333333333333333333333333333333333
BAD_HEALTH=sha-4444444444444444444444444444444444444444
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/state"
cat > "$T/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$DEPLOY_DIR/calls.log"
tag=$(grep '^IMAGE_TAG=' "$DEPLOY_DIR/.env" | cut -d= -f2)
case "$*" in
  *" login "*) cat >/dev/null; exit 0 ;;
  *" pull "*) [ "$tag" = "$BAD_PULL" ] && exit 1; exit 0 ;;
  *" exec "*) [ "$tag" = "$BAD_HEALTH" ] && exit 1; echo '{"ok":true}'; exit 0 ;;
  *) exit 0 ;;
esac
STUB
printf '#!/usr/bin/env bash\nexit 0\n' > "$T/bin/sleep"
chmod +x "$T/bin/docker" "$T/bin/sleep"
printf 'IMAGE_TAG=%s\nGHCR_OWNER=example\nGHCR_TOKEN=stub-token\n' "$OLD" > "$T/.env"
echo "$OLD" > "$T/state/current_tag"
: > "$T/docker-compose.yml"; : > "$T/docker-compose.prod.yml"
export DEPLOY_DIR="$T" HEALTH_ATTEMPTS=1 BAD_PULL BAD_HEALTH PATH="$T/bin:$PATH"

run() { set +e; bash "$SCRIPT" "$1" >"$T/out.log" 2>&1; rc=$?; set -e; echo "$rc"; }

# 1. Good deploy: new tag becomes current, old tag is kept as previous.
rc=$(run "$GOOD"); [ "$rc" = 0 ] || { echo "FAIL good deploy rc=$rc"; cat "$T/out.log"; exit 1; }
grep -qx "IMAGE_TAG=$GOOD" "$T/.env"
[ "$(cat "$T/state/current_tag")" = "$GOOD" ]
[ "$(cat "$T/state/previous_tag")" = "$OLD" ]
echo "PASS good deploy"

# 2. Bad tag fails at pull: exit 1, app stays on the good tag.
rc=$(run "$BAD_PULL"); [ "$rc" = 1 ] || { echo "FAIL pull-failure rc=$rc"; exit 1; }
grep -qx "IMAGE_TAG=$GOOD" "$T/.env"
[ "$(cat "$T/state/current_tag")" = "$GOOD" ]
echo "PASS bad tag fails at pull and rolls back"

# 3. Bad tag starts but fails the health check: rollback to the good tag.
rc=$(run "$BAD_HEALTH"); [ "$rc" = 1 ] || { echo "FAIL health-failure rc=$rc"; exit 1; }
grep -q 'rolled back' "$T/out.log" || { echo "FAIL no rollback message"; cat "$T/out.log"; exit 1; }
grep -qx "IMAGE_TAG=$GOOD" "$T/.env"
[ "$(cat "$T/state/current_tag")" = "$GOOD" ]
echo "PASS bad tag fails health and rolls back"

# 4. Usage errors exit 2 without touching anything.
rc=$(run "latest"); [ "$rc" = 2 ] || { echo "FAIL usage rc=$rc"; exit 1; }
rc=$(run "sha-XYZ"); [ "$rc" = 2 ] || { echo "FAIL usage rc=$rc"; exit 1; }
echo "PASS usage errors exit 2"
echo "deploy logic OK"
