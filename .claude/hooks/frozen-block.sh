#!/usr/bin/env bash
# PreToolUse-Guard: blockt Edit/Write an FROZEN-Pfaden (exit 2 = deny).
input="$(cat)"
path="$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
[ -z "$path" ] && exit 0
norm="$(printf '%s' "$path" | tr '\\' '/')"
while IFS= read -r p; do
  [ -z "$p" ] && continue
  case "$norm" in
    *"$p"*) echo "FROZEN-Block: '$path' liegt unter FROZEN-Pfad '$p'. Aenderung erfordert bewusste Eskalation (CLAUDE.md) + Commit-Marker 'FROZEN-CHANGE:'. Abgelehnt." >&2; exit 2;;
  esac
done < scripts/frozen-paths.txt
exit 0
