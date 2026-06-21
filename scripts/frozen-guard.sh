#!/usr/bin/env bash
# FAIL, wenn FROZEN-Pfade vs Baseline-Ref geaendert wurden -- ausser HEAD traegt 'FROZEN-CHANGE:'.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT" || exit 2
BASE_REF="${1:-baseline}"
if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "frozen-guard: Baseline-Ref '$BASE_REF' nicht gefunden -- uebersprungen."; exit 0
fi
mapfile -t paths < scripts/frozen-paths.txt
changed="$(git diff --name-only "${BASE_REF}...HEAD" -- "${paths[@]}" 2>/dev/null)"
if [ -z "$changed" ]; then echo "frozen-guard: keine FROZEN-Pfade geaendert."; exit 0; fi
if git log -1 --format='%B' HEAD | grep -q 'FROZEN-CHANGE:'; then
  echo "frozen-guard: FROZEN-Pfade geaendert, FROZEN-CHANGE-Marker vorhanden -- erlaubt:"; echo "$changed"; exit 0
fi
echo "frozen-guard: FAIL -- FROZEN-Pfade ohne FROZEN-CHANGE-Marker geaendert:"; echo "$changed"
echo "Bei bewusster Entscheidung: Commit-Message mit 'FROZEN-CHANGE: <Begruendung>' (per --amend), dann erneut pruefen."
exit 1
