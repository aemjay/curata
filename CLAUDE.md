# CLAUDE.md — Curata

Projektinstruktionen für Claude Code. Diese Datei ist verbindlich für jede Änderung an diesem Repo.

## Projekt
**Curata** — browser-lokales Zero-Build-Foto-Kurationstool. Vanilla JS + Preact/htm, IndexedDB, ONNX Runtime Web. ML: CLIP, Florence-2, MediaPipe, EdgeFace. Alle Laufzeit-Abhängigkeiten/Modelle kommen per CDN/HF-Hub (siehe `photobook/js/deps.js`) — **kein Build, kein Bundler, kein npm-Install für die App**. Die App liegt vollständig unter `photobook/` und wird statisch ausgeliefert.

## Arbeitsmodell
Michael ist **nicht-codierender Product Owner**. Architektur entscheidest du autonom. Produkt-, Legal-, Effort- und FROZEN-Grenzen eskalierst du an Michael, statt sie selbst zu überschreiten.

Quelle der Wahrheit (SoT) sind die KONZEPT-Dokumente in `docs/konzept/`. Reihenfolge: **KONZEPT (SoT) zuerst → dann Implementierung**. Kein Feature ohne zugehörigen KONZEPT-Eintrag. Bei Produktmodell-Änderungen die betroffenen KONZEPTe im selben PR nachziehen (grep-clean Konsistenzpropagation bei Versionsbumps).

## Stil
Deutsch. Token-effizient, kritisch, Struktur Problem→Grund→Schwäche→Lösung. Exakte Identifier/Pfade. **insight before agreement** — prüfe Annahmen am Code, übernimm keine Behauptungen ungeprüft. Keine Modell-Verweise in KONZEPTen.

## Branch-/PR-Disziplin
- **Eine Aufgabe = ein Branch = ein Delta.** Keine vermischten Änderungen.
- Branch-Namen sprechend, z. B. `feat/presets-initial`, `fix/fokus-inline`, `chore/css-cleanup`.
- Jeder PR nennt im Body: Ziel, betroffene Dateien, DoD-Checkliste, FROZEN-Bestätigung.
- Der externe Reviewer/Verifizierer soll **bestätigen, nicht entdecken**: vor dem PR den Failure-Mode-Pass selbst fahren.

## Pflicht-Verifikation vor "fertig"
Vor jedem PR lokal ausführen und im PR-Body bestätigen:
```
bash scripts/verify.sh
```
Das deckt ab: `node --check` über alle `photobook/js/**/*.js`; Anti-Schein-Extraktion/Zirkelimport-Gate; Warnung bei Änderungen an FROZEN-Pfaden (`scripts/frozen-paths.txt`). FROZEN-Treffer sind **kein** Hard-Fail, aber erfordern eine bewusste, dokumentierte Entscheidung im PR.

Zusätzlich, je nach Aufgabe:
- Failure-Mode-Pass über die Achsen: überlappende Ops/zwei Tabs, Async-Grenze Lesen/Schreiben, Abbruch/Crash, leer/degeneriert, Legacy/Migration, Idempotenz/Re-Entry, Nachbarsysteme.
- Full-File-Read vor Spezifikation (nicht aus Ausschnitten schließen).
- Browser-Testanleitung für Michael in Klartext (Zweck → nummerierte Klickschritte → „Erwartet:" / „Stutzig werden, wenn:"). Nur für Tests, die Michael selbst macht.

## FROZEN — nie ohne bewusste, eskalierte Entscheidung ändern
Pipeline/Runner/Solver (`s6_select.js`) / Segmentierung (`s5b_scenes.js`) / Reducer+`screenMap` (`app.js`) / `db.js` (API-Form) / `ingest.js` / `selectors.js` / `presetInvalidation.js` (inkl. `rederiveStreamsForFocus`) / Modus-Logik (`globalContextMode`/`contextModeByChapter`/`normalizeContextMode`) / Inline-Recompute (`recomputeNeedsHeavyPath`) / Datenbindungen / `schema:photobook-selection-v2` / `FOLDER_META_KEYS` / `vlmRaw` / `vlmTextEmb`. Inferenz-Stages. Scoring-Gewichte `W_*`/`momentScore`. Single-Model-Rule. `faces.invalidates`/STAGES-Registry. `DIVERSITY_NUDGE=0.10`/`EPS_SHARE=0.01`/`LAMBDA_SCENE_BY_MODE`. Rare-Flag-Logik (`candShare<=idealTarget+EPS_SHARE → Penalty=0`). `s6_select.js`-eigene `normalizePresets` (separate Kopie).

`normalizeState` muss neu hinzugefügte Felder explizit weitertragen. `overrides` liegt in `FOLDER_META_KEYS` und wird bei Workset-Mutation gelöscht.

## Erlaubte präsentationsseitige Eingriffe
`photobook/index.html`, `photobook/css/main.css`, `photobook/js/Nav.js`, `photobook/js/screens/{ReviewScreen,StartScreen,ProcessingScreen,ExportScreen}.js`, `photobook/js/components/*`.

## Verträge (verifiziert, nicht neu diagnostizieren)
- **Presets-Quelle der Pipeline ist META**, nicht State: `s6_select.js` (`db.getMeta('presets')`) und der Erstlauf-`focus`-Pfad `s3_faces.js` → `readFocusFactor` (`db.getMeta('presets')`). Wer Presets vor einem Lauf setzt, muss `putMeta('presets', …)` **vor** `SET_SCREEN processing` schreiben. `SET_PRESETS` ist nur UI-Sync.
- **ProcessingScreen startet die Pipeline selbst** per Effect auf `pipeline.status==='idle'`. `RESET_PIPELINE`+`SET_SCREEN` genügt; kein expliziter `startPipeline`-Aufruf im Start-Handler.
- **`screenMap` in `app.js` ist FROZEN** = `{start, processing, review}`. Keine neuen Screens über den Reducer.
- `SelectionSettingsPanel` ist eine eigenständige Komponente (`photobook/js/components/SelectionSettingsPanel.js`), genutzt im Review (`mode='review'`, Default) und im StartScreen (`mode='initial'`). Importiert nur `../deps.js` — **kein** Rückimport aus `ReviewScreen.js` (Zirkel verboten).

## Deploy
Statisch, Publish-Verzeichnis = `photobook/`. Netlify (mit dem Repo verbunden, Publish-Dir `photobook`) oder Netlify-Drop von `photobook/`. ES-Module + `fetch` brauchen einen echten Server — lokal nie über `file://`, sondern z. B. `python3 -m http.server` aus `photobook/`.

## Aktueller Stand & offene Punkte
- **Baseline:** `photobook/` = verifizierter Stand `presets-initial-startscreen-v2` (Hashes in `docs/status/VERIFIED-SHA256.txt`).
- **Offen, fällig:** SoT-Reconciliation in `KONZEPT-v7-Pipeline-SoT.md` (E3/E4a/Dubletten/fokus-inline/Presets-Initial nachziehen; §5 „fünf Screens" und Erstlauf-`focus` korrigieren; Produktmodell „Einstellungen im StartScreen **und** Review"). Hinweis: Die v7-Datei trägt im Inhalt Stand **v7**, der Dateiname war historisch irreführend („v7-v10").
- **Deferred:** Dead-CSS-Purge (verwaiste „Detail-PickCard"- und „Rejected-Panel"-Cluster in `css/main.css`, ~80 Regeln; rein Hygiene, kein User-Effekt; eigener Branch, mit Gruppen-Selektor-Guard).
- **Roadmap:** E4b/E4c (Header entzerren / Dichte-Regler), Inferenz→Web-Worker, HEIC-Performance, @container-Drawer, Quality/Redundanz-Filter, Candidate-Expansion, §14 LLM-Dramaturg, Full PWA.
