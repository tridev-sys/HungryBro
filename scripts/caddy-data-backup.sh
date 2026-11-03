#!/usr/bin/env bash
# Weekly archive of the proxy-caddy-data volume (Let's Encrypt certificates and ACME account keys).
# The archive holds private keys: the bucket must stay private.
# Usage: caddy-data-backup.sh backup | check latest
# Env: BACKUP_TARGET (s3://bucket/prefix or file:///dir), BACKUP_SCRATCH, CADDY_VOLUME (default proxy-caddy-data).
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:?usage: caddy-data-backup.sh backup | check latest}"
: "${BACKUP_TARGET:?set BACKUP_TARGET}"
SCRATCH_ROOT="${BACKUP_SCRATCH:-/home/ubuntu/docker/data/backup-scratch}"
VOLUME="${CADDY_VOLUME:-proxy-caddy-data}"
mkdir -p "$SCRATCH_ROOT"
work=$(mktemp -d "$SCRATCH_ROOT/caddy.XXXXXX")
check_volume=""
cleanup() {
  if [ -n "$check_volume" ]; then docker volume rm -f "$check_volume" >/dev/null 2>&1 || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

case "$BACKUP_TARGET" in
  s3://*) base="${BACKUP_TARGET%/}/caddy" ;;
  file://*) base="${BACKUP_TARGET#file://}/caddy" ;;
  *) echo "unsupported BACKUP_TARGET" >&2; exit 1 ;;
esac

if [ "$mode" = backup ]; then
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  name="caddy-data-$ts.tar.gz"
  docker run --rm -v "$VOLUME:/data:ro" -v "$work:/out" alpine:latest \
    tar -C /data -czf "/out/$name" .
  test -s "$work/$name"
  case "$BACKUP_TARGET" in
    s3://*) aws s3 cp "$work/$name" "$base/$name" --region ap-south-1 --only-show-errors ;;
    file://*) mkdir -p "$base"; cp "$work/$name" "$base/$name" ;;
  esac
  echo "caddy-data backup OK: $name"
  exit 0
fi

if [ "$mode" = check ]; then
  [ "${2:-}" = latest ] || { echo "usage: caddy-data-backup.sh check latest" >&2; exit 2; }
  case "$BACKUP_TARGET" in
    s3://*) key=$(aws s3 ls "$base/" --region ap-south-1 | awk '{print $4}' | grep '\.tar\.gz$' | sort | tail -1)
            aws s3 cp "$base/$key" "$work/archive.tar.gz" --region ap-south-1 --only-show-errors ;;
    file://*) key=$(ls "$base" | grep '\.tar\.gz$' | sort | tail -1)
              cp "$base/$key" "$work/archive.tar.gz" ;;
  esac
  test -s "$work/archive.tar.gz"
  check_volume="caddy-data-check-$$"
  docker volume create "$check_volume" >/dev/null
  docker run --rm -v "$check_volume:/data" -v "$work:/in:ro" alpine:latest \
    tar -C /data -xzf /in/archive.tar.gz
  if docker run --rm -v "$check_volume:/data:ro" alpine:latest sh -c \
      'test -d /data/caddy/acme && test -n "$(ls -A /data/caddy/acme)" && test -d /data/caddy/certificates && test -n "$(ls -A /data/caddy/certificates)"'; then
    echo "caddy-data check OK"
  else
    echo "caddy-data check FAILED: caddy/acme or caddy/certificates is missing or empty" >&2
    exit 1
  fi
  exit 0
fi

echo "usage: caddy-data-backup.sh backup | check latest" >&2
exit 2
