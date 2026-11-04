#!/usr/bin/env bash
# Run on the instance after the first good deploy. NOT RUNNABLE in this repository (needs the EC2 host,
# GHCR, and the public DOMAIN). The stub-based logic test is scripts/tests/deploy-logic.test.sh.
set -euo pipefail
: "${DOMAIN:?set DOMAIN}"
DIR=/home/ubuntu/docker
good=$(cat "$DIR/state/current_tag")
bad=sha-0000000000000000000000000000000000000000   # does not exist in GHCR
if "$DIR/deploy.sh" "$bad"; then echo "FAIL: bad tag deployed" >&2; exit 1; fi
grep -q "IMAGE_TAG=$good" "$DIR/.env"
[ "$(cat "$DIR/state/current_tag")" = "$good" ]
curl -fsS "https://$DOMAIN/api/health" | grep -q '"ok":true'
echo "rollback drill OK"
