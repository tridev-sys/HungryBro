#!/bin/sh
# Full perf and concurrency run against the perf stack only. Output goes to stdout (RESULT lines).
# Order matters: redis-outage stops perf-redis, so it runs last and removes that container.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/env.sh"
sh "$DIR/setup.sh"

echo "== check 1 and 7: intent burst, default sandbox bid delay"
sh "$DIR/start-app.sh" >/dev/null
perf_node sh -c 'npx tsx tests/perf/intent-burst.ts' | grep RESULT

echo "== check 1 and 7: intent burst, sandbox bid delay 0 (isolates the route cost)"
sh "$DIR/start-app.sh" 0 >/dev/null
perf_node sh -c 'npx tsx tests/perf/intent-burst.ts' | grep RESULT
sh "$DIR/start-app.sh" >/dev/null

echo "== check 2: auction correctness"
perf_node sh -c 'npx tsx tests/perf/auction-concurrency.ts' | grep RESULT
perf_node sh -c 'PERF_E_CLOSERS=9 npx tsx tests/perf/auction-concurrency.ts' | grep RESULT | grep -o '"E_closersProbe.*'
perf_node sh -c 'PERF_E_CLOSERS=10 npx tsx tests/perf/auction-concurrency.ts' | grep RESULT | grep -o '"E_closersProbe.*'

echo "== check 3: dine-in and KDS"
perf_node sh -c 'npx tsx tests/perf/dine-kds.ts' | grep RESULT

echo "== check 4: rate limiting"
perf_node sh -c 'npx tsx tests/perf/rate-limit.ts' | grep RESULT

echo "== check 5: SSE fan-out with memory samples"
sh "$DIR/run-sse.sh" | grep -v mem_sample

echo "== check 6: Redis outage (stops and removes perf-redis)"
sh "$DIR/redis-outage.sh" | grep -v npm

echo "== cleanup"
perf_node sh -c 'npx tsx tests/perf/cleanup.ts' | grep RESULT
