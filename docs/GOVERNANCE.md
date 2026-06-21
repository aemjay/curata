# Governance & Arbeitsloop (Curata)

Ziel: PO-/Reviewer-/Verifizierer-Mechanik im Repo, Mensch nur noch als Upper Management (Produkt/Legal/Effort/FROZEN-Bruch, finales Go/No-Go, Meta-Drift).

## Gewaltenteilung
- **Konzept-Autor:** Hauptagent, KONZEPT-first (SoT in docs/konzept/), Failure-Mode-Pass.
- **konzept-reviewer (Subagent, isoliert):** auditiert das KONZEPT gegen Code VOR Implementierung.
- **Implementierer:** Hauptagent, ein Branch = ein Delta.
- **independent-verifier (Subagent, read-only, isoliert):** prueft Diff gegen Baseline-Tag + DoD + FROZEN, glaubt keinem Selbstbericht.
- **Mensch (Upper Management):** entscheidet Produkt/Legal/Effort/FROZEN-Bruch; finale Abnahme; Meta-Audit der Schleife.

## Loop pro Delta
1. KONZEPT in docs/konzept/ (Autor) -> `konzept-reviewer` auditiert -> Mensch gibt Scope/Produkt frei.
2. Branch `typ/name`, Implementierung (ein Delta).
3. `independent-verifier` prueft gegen `baseline`-Tag.
4. PR -> GitHub Action (verify.sh + frozen-guard) ist Pflicht-Check.
5. Mensch: Go/No-Go -> Merge `--no-ff`.

## Mechanische Gates (agent-unabhaengig)
- `scripts/verify.sh`: node --check, Zirkel-Guard, FROZEN-Warnung.
- `scripts/frozen-guard.sh baseline`: byte-Drift der FROZEN-Pfade vs Baseline-Tag -> FAIL ausser Commit traegt `FROZEN-CHANGE: <Begruendung>`.
- `.github/workflows/verify.yml`: beides als PR-Pflichtcheck im CI.
- PreToolUse-Hook `.claude/hooks/frozen-block.sh`: blockt Edits an FROZEN-Pfaden waehrend der Session.

## Baseline-Tag pflegen
Nach jeder abgenommenen Lieferung den Baseline-Tag verschieben:
    git tag -f baseline <merge-commit>
So prueft frozen-guard immer gegen den zuletzt abgenommenen Stand.

## Was NICHT delegierbar ist
Korrelierte blinde Flecken (Autor + Verifizierer teilen Modell/Annahmen) kann die Schleife nicht selbst fangen. Dafuer: (1) mechanische Gates (teilen keine Annahmen), (2) bei FROZEN-/Produkt-heiklen Deltas eine zweite, unabhaengige Meinung (Mensch oder externer Reviewer).
