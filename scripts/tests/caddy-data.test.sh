#!/usr/bin/env bash
# Archives a throwaway volume with the same tar layout as proxy-caddy-data, then checks the restore.
set -euo pipefail
cd "$(dirname "$0")/../.."
T=$(mktemp -d)
VOL="caddy-data-test-$$"
trap 'docker volume rm -f "$VOL" >/dev/null 2>&1 || true; rm -rf "$T"' EXIT
docker volume create "$VOL" >/dev/null
docker run --rm -v "$VOL:/data" alpine:latest sh -c 'mkdir -p /data/caddy/acme /data/caddy/certificates && echo k > /data/caddy/acme/key && echo c > /data/caddy/certificates/cert'
export BACKUP_TARGET="file://$T" BACKUP_SCRATCH="$T" CADDY_VOLUME="$VOL"
bash scripts/caddy-data-backup.sh backup
bash scripts/caddy-data-backup.sh check latest | grep -q 'caddy-data check OK'
# Negative: an archive without certificates must fail the check
rm -f "$T"/caddy/caddy-data-*.tar.gz
docker run --rm -v "$VOL:/data" alpine:latest sh -c 'rm -rf /data/caddy/certificates/*'
bash scripts/caddy-data-backup.sh backup >/dev/null
if bash scripts/caddy-data-backup.sh check latest > "$T/neg.log" 2>&1; then
  echo "FAIL: check passed without certificates" >&2; exit 1
fi
echo "caddy-data OK"
