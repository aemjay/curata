#!/usr/bin/env bash
# Curata Verifikations-Gate. Aufruf: bash scripts/verify.sh [BASIS-REF]
# BASIS-REF optional (Default: HEAD) für die FROZEN-Diff-Warnung.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 2
BASE_REF="${1:-HEAD}"
fail=0

echo "== 1) node --check (alle photobook/js) =="
if ! command -v node >/dev/null 2>&1; then
  echo "  ! node nicht gefunden — Syntaxprüfung übersprungen (Warnung)"
else
  while IFS= read -r f; do
    if ! node --check "$f" 2>/tmp/nc.err; then echo "  FEHLER $f"; cat /tmp/nc.err; fail=1; fi
  done < <(find photobook/js -name '*.js')
  [ "$fail" -eq 0 ] && echo "  grün"
fi

echo "== 2) Anti-Schein-Extraktion / Zirkelimport =="
if grep -nE "function SelectionSettingsPanel|const SelectionSettingsPanel" photobook/js/screens/ReviewScreen.js >/dev/null 2>&1; then
  echo "  FEHLER: SelectionSettingsPanel-Definition liegt noch in ReviewScreen.js"; fail=1
fi
if grep -nE "from '\.\./screens/ReviewScreen\.js'|from '\./ReviewScreen\.js'" photobook/js/components/SelectionSettingsPanel.js >/dev/null 2>&1; then
  echo "  FEHLER: Zirkelimport in SelectionSettingsPanel.js"; fail=1
fi
[ "$fail" -eq 0 ] && echo "  ok"

echo "== 3) FROZEN-Pfad-Warnung (Diff vs $BASE_REF) =="
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  changed="$(git diff --name-only "$BASE_REF" 2>/dev/null; git diff --name-only --cached 2>/dev/null)"
  hit=0
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    echo "$changed" | grep -qE "^$(echo "$p" | sed 's/[.]/[.]/g')" && { echo "  WARNUNG: FROZEN-Pfad berührt -> $p (bewusste Entscheidung im PR dokumentieren)"; hit=1; }
  done < scripts/frozen-paths.txt
  [ "$hit" -eq 0 ] && echo "  keine FROZEN-Pfade berührt"
else
  echo "  (kein git-Repo/keine git-CLI — übersprungen)"
fi

echo "== Ergebnis =="
if [ "$fail" -eq 0 ]; then echo "PASS (FROZEN-Warnungen ggf. oben prüfen)"; exit 0; else echo "FAIL"; exit 1; fi
