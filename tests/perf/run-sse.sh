#!/bin/sh
# Wraps sse-fanout.ts with perf-app memory samples (docker stats) before, during and after.
set -eu
. "$(dirname "$0")/env.sh"
mem() { docker stats --no-stream --format '{{.MemUsage}}' perf-app; }
echo "mem_before=$(mem)"
( while :; do echo "mem_sample=$(mem)"; sleep 1; done ) &
SAMPLER=$!
perf_node sh -c 'npx tsx tests/perf/sse-fanout.ts' 2>&1 | grep -v "npm notice" || true
kill "$SAMPLER" 2>/dev/null || true
sleep 10
echo "mem_after_disconnect=$(mem)"
