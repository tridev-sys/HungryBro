#!/bin/sh
# Prints the useful part of a full vitest log (path given as $1), without ANSI colour codes:
#   - the "Test Files" and "Tests" summary lines;
#   - for every failed file, the first error block (the FAIL line and the lines after it, up to
#     BLOCK_LINES), so a setup-time failure such as a globalSetup error is never hidden;
#   - if vitest printed no FAIL line (for example globalSetup threw), the first "Error" block.
# The full log is kept on disk by the caller; this only decides what goes to the console.
set -eu
LOG="$1"
BLOCK_LINES="${BLOCK_LINES:-25}"
MAX_LINES="${MAX_LINES:-200}"
ESC="$(printf '\033')"

if sed "s/${ESC}\[[0-9;]*m//g" "$LOG" | grep -q '^ *FAIL '; then
  MODE=fail
elif sed "s/${ESC}\[[0-9;]*m//g" "$LOG" | grep -q '^ *Test Files *[0-9]'; then
  # vitest reached its summary and no file failed: nothing to print beyond the summary lines.
  MODE=none
else
  MODE=error
fi

sed "s/${ESC}\[[0-9;]*m//g" "$LOG" | awk -v mode="$MODE" -v block="$BLOCK_LINES" -v maxl="$MAX_LINES" '
  BEGIN { left = 0; printed = 0; header = 0; errdone = 0 }
  /^ *Test Files +[0-9]/ || /^ *Tests +[0-9]/ { print; printed++; next }
  mode == "fail" && /^ *FAIL / {
    f = $2
    if (!(f in seen)) {
      seen[f] = 1; left = block
      if (!header) { print "--- first error block per failed file ---"; header = 1; printed++ }
    }
  }
  mode == "error" && !errdone && /Error|error|No test files|failed|Failed/ {
    errdone = 1; left = 20
    print "--- first error (no FAIL line in output) ---"; printed++
  }
  left > 0 && printed < maxl { print; printed++; left-- }
  printed >= maxl { exit }
'
