#!/bin/sh
# Feeds a fake failing vitest log through scripts/tests/vitest-summary.sh and asserts that the
# first error block of every failed file is printed (including a setup-time failure), that the
# summary lines are kept, and that ANSI colour codes are stripped.
set -eu
cd "$(dirname "$0")/../.."
SUMMARY=scripts/tests/vitest-summary.sh
TMP="$(mktemp -d "$PWD/test-results/summary-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

ESC="$(printf '\033')"
cat > "$TMP/vitest.log" <<LOG
${ESC}[1m${ESC}[7m${ESC}[36m RUN ${ESC}[39m${ESC}[22m${ESC}[0m v4.0.0
 ✓ tests/ok/passes.test.ts (3 tests) 12ms
${ESC}[41m${ESC}[1m FAIL ${ESC}[49m${ESC}[22m  tests/db/broken-setup.test.ts [ tests/db/broken-setup.test.ts ]
Error: connect ECONNREFUSED 127.0.0.1:5432 FIRST-SETUP-ERROR
 at connect (node:net:1)
 at setup (tests/setup/test-database.ts:10:3)
 FAIL  tests/api/assert.test.ts > handler > returns 200
AssertionError: expected 500 to be 200 FIRST-ASSERT-ERROR
 + expected
 - received
 FAIL  tests/api/assert.test.ts > handler > second failure SECOND-ASSERT-ERROR
 ${ESC}[31m❯${ESC}[39m tests/api/assert.test.ts:9:3
${ESC}[31m Test Files ${ESC}[39m 2 failed | 1 passed (3)
${ESC}[31m      Tests ${ESC}[39m 2 failed | 3 passed (5)
LOG

OUT="$("$SUMMARY" "$TMP/vitest.log")"
printf '%s\n' "$OUT"

fail() { echo "FAIL: $1" >&2; exit 1; }
printf '%s' "$OUT" | grep -q 'FIRST-SETUP-ERROR' || fail "setup-time error block not printed"
printf '%s' "$OUT" | grep -q 'FIRST-ASSERT-ERROR' || fail "first error of the second failed file not printed"
printf '%s' "$OUT" | grep -q 'Test Files' || fail "Test Files summary line missing"
printf '%s' "$OUT" | grep -q 'Tests ' || fail "Tests summary line missing"
printf '%s' "$OUT" | grep -q "$ESC" && fail "ANSI codes not stripped"

# A green run must print only the summary lines, not unrelated passing test names that contain "error".
cat > "$TMP/green.log" <<LOG
 ✓ tests/ok/errors.test.ts (2 tests) 9ms
   ✓ handles error responses 4ms
${ESC}[32m Test Files ${ESC}[39m 1 passed (1)
${ESC}[32m      Tests ${ESC}[39m 2 passed (2)
LOG
GREEN="$("$SUMMARY" "$TMP/green.log")"
printf '%s\n' "$GREEN"
printf '%s' "$GREEN" | grep -q 'first error' && fail "green run printed an error block"
printf '%s' "$GREEN" | grep -q 'Test Files' || fail "green run: Test Files summary missing"
echo "vitest-summary OK"
