#!/usr/bin/env bash
# Deploys one immutable image tag to the app container and rolls back on failure.
# Installed to /home/ubuntu/docker/deploy.sh on the host (mode 755, owner deploy).
# Usage: deploy.sh sha-<40-hex commit>
# Exit: 0 deployed, 1 failed (rollback attempted), 2 bad usage.
# DEPLOY_DIR and HEALTH_ATTEMPTS exist so tests can run the logic against a temp folder.
set -euo pipefail
NEW="${1:-}"
if [ -z "$NEW" ]; then echo "usage: deploy.sh sha-<40-hex>" >&2; exit 2; fi
case "$NEW" in
  sha-*) ;;
  *) echo "tag must be sha-<commit>" >&2; exit 2 ;;
esac
if ! [[ "$NEW" =~ ^sha-[0-9a-f]{40}$ ]]; then echo "tag must be sha-<40 lowercase hex>" >&2; exit 2; fi

DIR="${DEPLOY_DIR:-/home/ubuntu/docker}"
STATE="$DIR/state"
ATTEMPTS="${HEALTH_ATTEMPTS:-24}"
mkdir -p "$STATE"
COMPOSE=(docker compose -f "$DIR/docker-compose.yml" -f "$DIR/docker-compose.prod.yml" --env-file "$DIR/.env")
CURRENT=$(cat "$STATE/current_tag" 2>/dev/null || true)

set_tag() { sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" "$DIR/.env"; }

registry_login() {
  local token user
  token=$(grep '^GHCR_TOKEN=' "$DIR/.env" | cut -d= -f2- || true)
  user=$(grep '^GHCR_USER=' "$DIR/.env" | cut -d= -f2- || true)
  user="${user:-$(grep '^GHCR_OWNER=' "$DIR/.env" | cut -d= -f2-)}"
  if [ -n "$token" ]; then
    printf '%s' "$token" | docker login ghcr.io -u "$user" --password-stdin >/dev/null
  fi
}

healthy() {
  for _ in $(seq 1 "$ATTEMPTS"); do
    if "${COMPOSE[@]}" exec -T app wget -qO- http://localhost:3000/api/health 2>/dev/null | grep -q '"ok":true'; then
      return 0
    fi
    sleep 5
  done
  return 1
}

deploy_tag() {
  set_tag "$1"
  "${COMPOSE[@]}" pull app migrate && "${COMPOSE[@]}" run --rm migrate && "${COMPOSE[@]}" up -d --no-deps app && healthy
}

registry_login

if deploy_tag "$NEW"; then
  if [ -n "$CURRENT" ] && [ "$CURRENT" != "$NEW" ]; then echo "$CURRENT" > "$STATE/previous_tag"; fi
  echo "$NEW" > "$STATE/current_tag"
  echo "deployed $NEW"
  exit 0
fi

echo "deploy of $NEW failed; rolling back" >&2
if [ -n "$CURRENT" ] && deploy_tag "$CURRENT"; then
  echo "rolled back to $CURRENT" >&2
else
  echo "ROLLBACK FAILED; manual action required" >&2
fi
exit 1
