#!/usr/bin/env bash
# Asserts that a .trx results file proves tests actually RAN.
#
#   assert-trx.sh <file.trx> [min-executed]
#
# Why this exists: `dotnet test` has, in some environments, exited 0 with an empty log
# (docs/09-DOCKER.md). A suite that ran nothing and a suite that passed look identical
# from the exit code alone, so every test step writes a .trx and this script reads the
# counters back: the file must exist, at least <min-executed> tests (default 1) must have
# executed, and none may have failed, errored, timed out or aborted.
set -euo pipefail

TRX="${1:?usage: assert-trx.sh <file.trx> [min-executed]}"
MIN="${2:-1}"

[ -s "$TRX" ] || { echo "::error::$TRX is missing or empty — the test run produced no results"; exit 1; }

COUNTERS="$(grep -o '<Counters [^>]*>' "$TRX" | head -n1)"
[ -n "$COUNTERS" ] || { echo "::error::$TRX has no <Counters> element"; exit 1; }

attr() { printf '%s' "$COUNTERS" | sed -n "s/.* $1=\"\([0-9]*\)\".*/\1/p"; }
TOTAL="$(attr total)"; EXECUTED="$(attr executed)"; PASSED="$(attr passed)"
FAILED="$(attr failed)"; ERROR="$(attr error)"; TIMEOUT="$(attr timeout)"; ABORTED="$(attr aborted)"

echo "$(basename "$TRX"): total=$TOTAL executed=$EXECUTED passed=$PASSED failed=$FAILED error=$ERROR timeout=$TIMEOUT aborted=$ABORTED"

[ "${EXECUTED:-0}" -ge "$MIN" ] || { echo "::error::$(basename "$TRX"): only ${EXECUTED:-0} test(s) executed, expected at least $MIN"; exit 1; }
[ "$(( ${FAILED:-0} + ${ERROR:-0} + ${TIMEOUT:-0} + ${ABORTED:-0} ))" -eq 0 ] \
  || { echo "::error::$(basename "$TRX"): failures recorded"; exit 1; }
