#!/bin/sh
# Check 6 wrapper. Stops ONLY the throwaway perf-redis container (on perf-net, started by the perf
# setup; never food-os-redis), runs the intent probe, then removes perf-redis.
set -eu
. "$(dirname "$0")/env.sh"
if [ "$(docker inspect -f '{{.Name}}' perf-redis)" != "/perf-redis" ]; then echo "refusing: unexpected container" >&2; exit 1; fi
docker stop perf-redis >/dev/null
echo "perf-redis stopped at $(date -u +%H:%M:%S)"
set +e
perf_node sh -c 'npx tsx tests/perf/redis-outage.ts' 2>&1 | grep -v "npm notice"
set -e
docker rm -f perf-redis >/dev/null
echo "perf-redis removed"
