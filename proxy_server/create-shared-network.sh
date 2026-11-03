#!/usr/bin/env bash
# Creates the external network that the proxy and every app share. Safe to re-run.
set -euo pipefail
docker network inspect shared >/dev/null 2>&1 || docker network create shared
echo "shared network ready"
