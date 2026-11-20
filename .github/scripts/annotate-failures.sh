#!/usr/bin/env bash
# Turns the failures in a cargo log into GitHub annotations (readable without downloading logs):
# one multi-line annotation per compiler error block and per failing test's captured output.
# GitHub keeps 10 error annotations per step, so at most 10 are emitted.
# Usage: annotate-failures.sh <log> [title]
log=$1
title=${2:-failure}
[ -f "$log" ] || exit 0
awk '
  # A compiler block counts only when it points at code or is the final "could not compile" (a
  # passing test that prints "error: ..." from a child process is not a failure).
  function flush() {
    if (b != "" && (!rustc || b ~ /-->|could not compile|test failed/)) print b
    b = ""; n = 0; rustc = 0
  }
  # CARGO_TERM_COLOR=always: drop ANSI colours; Windows: drop CR.
  { gsub(/\033\[[0-9;]*[A-Za-z]/, ""); sub(/\r$/, "") }
  /^---- .* stdout ----$/ { flush(); b = $0; n = 1; next }
  /^error(\[E[0-9]+\])?: / { flush(); b = $0; n = 1; rustc = 1; next }
  b != "" && rustc && /^$/ { flush(); next }
  b != "" && (/^failures:$/ || /^test result:/ || /^warning: build failed/) { flush(); next }
  b != "" && n < 40 { b = b "\x01" $0; n++ }
  END { flush() }
' "$log" | head -10 | while IFS= read -r block; do
  msg=${block//%/%25}
  msg=${msg//$'\r'/}
  msg=${msg//$'\x01'/%0A}
  echo "::error title=$title::$msg"
done
failed=$(grep -E "^test .* FAILED\r?$" "$log" | sed -e 's/\r$//' | head -40 | awk '{printf "%s%%0A", $0}')
[ -n "$failed" ] && echo "::error title=$title (failed tests)::$failed"
# No test output and no compiler error (a test binary that could not start, e.g. a missing DLL on
# Windows): show the end of the log instead.
if ! grep -qE "^---- .* stdout ----\r?$|could not compile" "$log"; then
  # One multi-line annotation (GitHub keeps only 10 per step).
  msg=$(tail -n 25 "$log" | sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's/\r$//' -e 's/%/%25/g' | awk '{printf "%s%%0A", $0}')
  echo "::error title=$title (log tail)::$msg"
fi
