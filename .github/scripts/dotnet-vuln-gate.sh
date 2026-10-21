#!/usr/bin/env bash
# NuGet vulnerability gate — run from backend-dotnet/ after a restore.
#
# `dotnet list package --vulnerable` always exits 0, whatever it finds, and it ALSO
# exits 0 when the advisory feed could not be reached (it prints `error: ... timed out`
# and simply reports nothing for that package). So the exit code proves nothing in
# either direction and the output has to be read:
#   - any `error:` line          → FAIL (the scan did not complete; "no findings" is unproven)
#   - any High/Critical advisory → FAIL
#   - Moderate/Low               → warning annotation only; Dependabot opens the PR
# Transitive packages are included: two of the three highs this gate found on its first
# run (MessagePack via the SignalR Redis backplane, Newtonsoft.Json via Hangfire) were
# transitive.
set -uo pipefail

SLN="${1:-Govori.sln}"
OUT="$(dotnet list "$SLN" package --vulnerable --include-transitive 2>&1)"
RC=$?
printf '%s\n' "$OUT"

if [ $RC -ne 0 ] || printf '%s\n' "$OUT" | grep -qiE '^[[:space:]]*error'; then
  echo "::error::the vulnerability scan did not complete (feed unreachable?) — re-run the job"
  exit 1
fi
if printf '%s\n' "$OUT" | grep -qE '[[:space:]](High|Critical)[[:space:]]'; then
  echo "::error::High/Critical NuGet advisories found — bump the package (or pin the transitive one) before merging"
  exit 1
fi
if printf '%s\n' "$OUT" | grep -qE '[[:space:]](Moderate|Low)[[:space:]]'; then
  echo "::warning::Moderate/Low NuGet advisories present (not blocking) — see the log above"
fi
echo "NuGet vulnerability gate: no High/Critical advisories"
