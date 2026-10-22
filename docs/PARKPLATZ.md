# Parkplatz — Ideen und Befunde außerhalb des laufenden Schritts

Regel (Ablaufplan 6.3): Was während eines Schritts auffällt und nicht zu dessen Scope gehört, landet hier mit Datum. Sichtung nur an Schrittgrenzen. Einträge werden nicht gelöscht, sondern als `erledigt`/`verworfen` markiert.

| Datum | Befund / Idee | Quelle | Status |
|---|---|---|---|
| 2026-10-22 | `photobook/favicon.ico` fehlt → 404 in der Browser-Konsole bei jedem Start. Kosmetisch. | A-001 | offen |
| 2026-10-22 | `CLAUDE.md`/`README.md` nennen `python3 -m http.server`; auf Windows ist `python3` nur der Store-Alias → `python -m http.server`. Beide Varianten dokumentieren. | A-001 | offen (Schritt 1, Punkt 3) |
| 2026-10-22 | Playwright-Standard-Chromium 131 startet auf Windows Build 26300 nicht; `channel:'chrome'` nutzen. Für das Testgeschirr des Spikes festhalten. | A-001 | offen (Spike) |
| 2026-10-22 | SoT führt „Kuratierung Phase A" als *nicht realisiert*, der Code enthält aber `worksetEpoch`/`worksetRevision`/`REMOVE_PHOTOS`/`startNewWorkset` in `app.js`, `db.js`, `ingest.js`, `runner.js`, und der StartScreen zeigt „Ordner hinzufügen / Dateien hinzufügen / entfernen". Zu klären: Umsetzungsgrad gegen Phase-A-KONZEPT (Datei fehlt im Repo), dann SoT nachziehen. Betrifft Ablaufplan Schritt 3. | Cloud-Session, Code-Grep | offen (Schritt 1) |
