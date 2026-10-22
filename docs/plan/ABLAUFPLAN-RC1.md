# Ablaufplan — von v8 bis Release-Kandidat RC1

**Stand:** 2026-10-22 · **Status:** Entwurf, wartet auf Entscheidungen D1–D4 (Abschnitt 5)
**Basis:** `docs/konzept/KONZEPT-Pipeline-SoT.md` (v8), `docs/GOVERNANCE.md`, Code-Stand `main` (bc299ef)
**Zweck:** Verbindliche Reihenfolge und Arbeitsmechanik für die Fortführung. Schritte 1–3 detailliert, Schritte 4–7 bis RC1 grob. Fernziel (Buch von A bis Z) ist Post-RC1 und hier nur als Abgrenzung aufgeführt.

---

## 1. Rahmen und Arbeitsmechanik

### 1.1 Rollen
| Rolle | Wer | Inhalt |
|---|---|---|
| Product Owner | Michael | Produkt-, Legal-, Effort- und FROZEN-Entscheidungen; Scope-Freeze je Schritt; UI/UX-Abnahme nach Testanleitung; Relais zum externen Reviewer (ChatGPT) |
| KONZEPT-Autor + Implementierer | Claude | KONZEPT-first, Failure-Mode-Pass, Implementierung (ein Delta je Branch), Testanleitung für Michael |
| Interner Reviewer | Subagent `konzept-reviewer` | Audit KONZEPT gegen Code vor Beauftragung (isoliert, read-only) |
| Interner Verifizierer | Subagent `independent-verifier` | Audit Diff gegen DoD/FROZEN/`baseline` vor Merge |
| Externer Reviewer | ChatGPT (über Michael) | Zweite, modellfremde Meinung auf KONZEPT und Abnahmebericht; fängt korrelierte blinde Flecken (GOVERNANCE.md „nicht delegierbar") |
| Mechanische Gates | `verify.sh`, `frozen-guard.sh`, CI, PreToolUse-Hook | teilen keine Annahmen |

### 1.2 Gate-Kette je Schritt (verbindlich)
```
G0 DoR erfüllt  →  KONZEPT  →  G1 konzept-reviewer  →  G2 ChatGPT-Review-Paket  →  G3 Freigabe Michael (= Scope-Freeze)
→ Implementierung (Branch je Delta)  →  G4 verify.sh + independent-verifier + CI  →  G5 UI/UX-Abnahme Michael (Testanleitung)
→ Merge --no-ff  →  git tag -f baseline  →  STATUS-Notiz in docs/status/
```
- **G2 ChatGPT-Review:** Claude erzeugt pro KONZEPT ein selbsttragendes Review-Paket (`docs/review/<schritt>-paket.md`: Prompt + KONZEPT + relevante Code-Ausschnitte + konkrete Prüffragen). Michael pastet es, liefert die Antwort zurück. Claude trianguliert jeden Befund am Code (annehmen / mit Beleg widerlegen) und dokumentiert das im KONZEPT-Changelog. Kein Befund wird ungeprüft übernommen.
- **G5** nur für Deltas mit sichtbarer UI-Wirkung; reine Pipeline-/Docs-Deltas enden bei G4 + Go/No-Go.

### 1.3 Anti-Mission-Creep (Regeln)
1. **Scope-Freeze bei G3.** Danach ändert sich der Schritt nur über einen Änderungsantrag an Michael (Problem → Grund → Konsequenz für DoD/Aufwand).
2. **Parkplatz statt Nachschub.** Jede Idee, die während eines Schritts auftaucht, geht datiert nach `docs/PARKPLATZ.md`, nicht in den laufenden Branch. Parkplatz wird nur an Schrittgrenzen gesichtet.
3. **„Bewusst nicht"-Liste** ist Pflichtteil jedes KONZEPTs und jedes PR-Bodys.
4. **Ein offener Implementierungsbranch gleichzeitig.** Kein zweites Delta, solange das erste nicht gemerged oder verworfen ist.
5. **Jeder Schritt hat ein messbares Ergebniskriterium** (Abschnitt 3/4). Kein „fertig" ohne Messung oder Abnahme.
6. **Entscheidungslog** `docs/DECISIONS.md` (D-Nummern, Datum, Optionen, Entscheidung, Begründung). Verhindert Re-Litigation.
7. **FROZEN bleibt FROZEN.** Berührung nur mit `FROZEN-CHANGE:`-Marker nach expliziter Entscheidung (D-Eintrag).

### 1.4 Codequalität (Mindeststandard je Delta)
- `bash scripts/verify.sh` grün; CI grün; `frozen-guard` grün oder bewusst markiert.
- Full-File-Read vor Spezifikation; Failure-Mode-Pass über alle sieben Achsen im KONZEPT dokumentiert.
- Keine neuen Laufzeit-Abhängigkeiten ohne D-Eintrag (zero-build, CDN-gepinnt in `deps.js`).
- Kein toter Code, keine Schein-Extraktion (Anti-Schein-Gate in `verify.sh`).
- Determinismus-Gate für alles, was Segmentierung/Solver berührt (§6 SoT).

### 1.5 Bezug Jungle Jiggle
Im Repo liegen keine Artefakte aus Jungle Jiggle; die Mechanik oben ist aus `GOVERNANCE.md` abgeleitet und um Scope-Freeze, Parkplatz, Entscheidungslog, Ergebniskriterien und ChatGPT-Gate erweitert. **Offen:** Michael nennt, welche Jungle-Jiggle-Praktiken zusätzlich übernommen werden sollen (Schritt 1, Punkt 1.7).

---

## 2. RC1-Definition (Vorschlag — Entscheidung D1)

**RC1 = Curata 1.0: ein vollständiger, von einem Nutzer ohne Entwickler durchlaufbarer Kurations-Workflow, dessen Ergebnis ein strukturiertes Buch-Skelett ist (Kapitel → Szenen → Bilder mit Beat, Begründung und Text-Rohdaten), das in einen Fotobuch-Dienst oder ein Layoutwerkzeug übernommen werden kann.**

| In RC1 | Bewusst nicht in RC1 (Post-RC / 2.0) |
|---|---|
| Arbeitsmenge aus Ordnern **und** Einzeldateien, entfernbar vor dem Lauf (Phase A) | Automatisches Seitenlayout, Layout-Editor, PDF-Buch |
| Qualitätsblock nach Diagnosebefund (D3) | LLM-Dramaturg / LLM-Captions (lokal oder remote) |
| Robustheit: Inferenz im Worker, Pause/Resume gehärtet, ehrliche Backend-Anzeige | Face-Clustering **nur falls** Diagnose es als Hauptursache zeigt (sonst 2.0) |
| Deterministische Erzählschicht: Kapitel-/Szenen-Titel aus Metadaten, Context Packs, Export-Manifest v3 | Online-Geo/POI (Opt-in) — nur bei D5 = ja |
| Abnahme auf ≥3 heterogenen Bibliotheken gegen §6-Kriterium | Mobile-Optimierung, Video/Live Photos, Active Learning |

Dies ist ein Scope-Vorschlag. Erst mit D1 wird er verbindlich; danach gilt Regel 1.3.1.

---

## 3. Die nächsten drei Schritte (detailliert)

### Schritt 1 — Fundament und Governance schließen
**Typ:** docs/chore, kein App-Code. **Ziel:** Der Arbeitsloop aus GOVERNANCE.md läuft tatsächlich; SoT und Instruktionen sind konsistent; Entscheidungen D1–D2 sind getroffen und protokolliert.

**Warum zuerst:** `frozen-guard.sh` überspringt sich selbst, solange kein `baseline`-Tag existiert (`git tag` ist leer) — das FROZEN-Gate ist derzeit wirkungslos. Das im SoT als „nächster Schritt, beauftragbar" geführte `KONZEPT-Kuratierung-Phase-A-v6.7` liegt nicht im Repo. `CLAUDE.md` und `README.md` führen erledigte Punkte als offen (v7/„v7-v10"-Hinweis, „SoT-Reconciliation fällig" — laut Changelog v8 erledigt).

**Inhalt (Checkliste):**
1. `git tag baseline bc299ef` setzen und pushen; CI-Lauf zeigt frozen-guard aktiv (nicht „übersprungen").
2. `KONZEPT-Kuratierung-Phase-A-v6.7.md` nach `docs/konzept/` — **Michael liefert die Datei.** Falls nicht mehr vorhanden: eigener Rekonstruktions-Auftrag (dann verschiebt sich Schritt 3, siehe Risiko R1).
3. `CLAUDE.md` „Aktueller Stand & offene Punkte" und `README.md` Zeile 44 auf v8/SoT-Dateiname ziehen; erledigte Punkte streichen.
4. Beat-Grammatik: SoT §3 nennt fünf Beats, `s6_select.js:72` seedet nur `establishing` und `hero`. **D2:** als bewusste Vereinfachung im SoT dokumentieren (Empfehlung) oder als Lücke in den Qualitätsblock aufnehmen. Kein Code-Eingriff in Schritt 1.
5. RC1-Definition (Abschnitt 2) nach **D1** in `docs/DECISIONS.md` und SoT-Kopf übernehmen.
6. Dateien anlegen: `docs/DECISIONS.md`, `docs/PARKPLATZ.md`, `docs/review/TEMPLATE-ChatGPT-Review-Paket.md`, `docs/status/TEMPLATE-Testanleitung.md`.
7. Michael benennt Jungle-Jiggle-Praktiken, die zusätzlich gelten sollen → Nachtrag in GOVERNANCE.md.

**DoR:** keine. **Branch:** `chore/governance-close`. **Gates:** G1 entfällt (kein KONZEPT), G2 optional (Michael kann GOVERNANCE+Plan an ChatGPT geben), G3, G4 (verify.sh), kein G5.
**DoD (mechanisch):** `git tag -l baseline` nicht leer; CI-Log enthält „frozen-guard: keine FROZEN-Pfade geaendert"; `grep -c "v7-v10" CLAUDE.md README.md` = 0; Phase-A-Datei vorhanden oder Rekonstruktions-Auftrag als D-Eintrag; D1/D2 im Entscheidungslog.
**Aufwand:** Claude 1 Session; Michael ca. 1 h (Datei suchen, D1/D2 entscheiden, Jungle-Jiggle-Liste).
**Bewusst nicht:** kein App-Code, kein CSS, kein SoT-Umbau jenseits der genannten Stellen.

### Schritt 2 — Qualitätsdiagnose auf heterogenen Bibliotheken
**Typ:** Messung + Befundbericht, kein Produktdelta. **Ziel:** Evidenz, *woran* schlechte Auswahlen liegen, bevor teure Architektur (E11 EdgeFace, Candidate Expansion, Intent Brief, Score-Spreizung) beauftragt wird — SoT §14.C „Diagnose vor Architektur". Bisher existiert ein einziger Datenpunkt (468 Fotos, 94 % Landschaft).

**Inhalt:**
1. **Pre-Check (Claude, Session 1):** `diagnose.json` gegen Bedarf prüfen: enthält `selectParams` (τ_auto/τ_eff/Slider), Reject-Gründe je Bild, Szenen-/Cluster-IDs, Override-Richtung, `momentScore`-Verteilung? Fehlt etwas Entscheidendes, ist das ein kleines, abgegrenztes Delta an `ExportScreen.js` (präsentationsseitig erlaubt) **vor** den Läufen — sonst sind die Läufe wertlos.
2. **Läufe (Michael):** drei Ordner mit unterschiedlichem Charakter, je ≥300 Fotos: (a) Stadt/Sehenswürdigkeiten, (b) Familie/Personen-dominant, (c) Natur/Landschaft (Vergleich zur Feldabnahme). Je Lauf: Presets Default, Review wie ein echter Nutzer (Entfernen/Zurückholen), zusätzlich pro Ordner eine Liste „unverzichtbar" (10–20 Dateinamen) **vor** dem Blick auf die Auswahl; dann Export `diagnose.json` + `selection.json` + 10 Zeilen Freitext („was hat gestört"). Zeitaufwand je Ordner ca. 1–2 h inkl. Rechenzeit.
3. **Auswertung (Claude, Session 2):** Skript im Scratchpad (nicht in der App). Kennzahlen je Bibliothek: Override-Quote, Richtung, Anteil unverzichtbar-verworfen, Reject-Grund-Verteilung, Fehlfall-Klassen (Technik / Person / Cluster-Repräsentant / Beat / Kontext-Semantik), Score-Kompression (`momentScore`, Gesamt-Score Median/p80/max), τ_auto-Lage vs. Floor (tote Slider-Hälfte). Bericht `docs/status/DIAGNOSE-2026-<MM>.md` mit Rangfolge der Ursachen.
4. **Entscheidung D3 (Michael, auf Basis des Berichts):** Reihenfolge des Qualitätsblocks (Schritt 4). Entscheidungsregel aus SoT §14.C: Personen-Unterscheidung dominiert → E11 vor; semantische Redundanz/fehlender Intent dominiert → Candidate Expansion + Intent Brief vor; Kompression dominiert → Score-Rebalancierung (FROZEN `W_*`, D-Eintrag nötig).
5. **G2:** Befundbericht als ChatGPT-Paket (Prüffrage: Sind die Ursachen-Zuordnungen aus den Daten belegt oder interpretiert?).

**DoR:** Schritt 1 gemerged (Tag, Templates). **Branch:** keiner, außer Pre-Check-Delta (`fix/diagnose-export-<feld>`). **Gates:** G2 auf Bericht, G3 = D3.
**DoD:** drei `diagnose.json` in `docs/status/diagnose/` (ohne Bilddaten — Datenschutzhinweis im Export bestätigt), Bericht vorhanden, D3 im Entscheidungslog, Parkplatz aktualisiert.
**Aufwand:** Claude 2 Sessions; Michael 4–6 h verteilt.
**Bewusst nicht:** kein Tuning von Solver-Konstanten „mal probieren"; keine Preset-Experimente außer Default — die Messung muss vergleichbar bleiben.

### Schritt 3 — Kuratierung Phase A (A-Core, dann A-UI)
**Typ:** Feature, FROZEN-berührend. **Ziel:** Arbeitsmenge statt Ordner — Ordner **und** Einzeldateien hinzufügen, Fotos vor dem Lauf entfernen, konsistente Signatur, verlustfreie Migration bestehender Bestände. Das ist der im SoT deklarierte nächste Schritt und die einzige fertig auditierte Etappe (11 Audit-Runden).

**Warum an dritter Stelle und nicht erster:** Es ist ein State-Machine-Umbau in `db.js`, `ingest.js`, `app.js` (Reducer), `selectors.js` — alle FROZEN. Ein solcher Eingriff gehört hinter ein funktionierendes FROZEN-Gate (Schritt 1) und sollte nicht parallel zur Diagnose laufen, die den *heutigen* Stand messen muss (Schritt 2). Michael kann per D1 auch den Qualitätsblock vorziehen und Phase A nach hinten setzen; dann tauschen Schritt 3 und 4.

**Inhalt:**
1. **Re-Audit des KONZEPTs (Claude + `konzept-reviewer`):** v6.7 wurde gegen den Stand „Review-Controls v3" geschrieben; seitdem kamen Presets-Initial, E4a und fokus-inline. Jede Zeilenreferenz und jeder Vertrag (`proceedToProcessing`, `startNewWorkset`, Reset-Scope erhält `presets`) wird gegen den aktuellen Code neu belegt. Ergebnis: v6.8 mit Changelog, oder Bestätigung „unverändert gültig".
2. **G2 ChatGPT-Paket** mit Fokus auf §4.10-Zustandsmatrix und den sieben Failure-Mode-Achsen (zwei Tabs, Abbruch mitten in Mutation, Legacy-Migration, Re-Entry).
3. **D4 (Michael):** FROZEN-CHANGE-Freigabe für `db.js` (API-Form), `ingest.js`, `app.js`-Reducer, `selectors.js`, `normalizeState`. Ohne D4 kein Branch.
4. **Branch 1 `feat/workset-a-core`** (Commit mit `FROZEN-CHANGE:`): `applyWorksetMutation` + CAS (`worksetEpoch`/`worksetRevision`), `putPhotos` update-only, `hydrateWorkset()` mit Status-Mapping + CURATING/LOCKED + Recovery, Reset-Scope, Legacy-Migration, `normalizeState` trägt neue Felder. Keine UI-Änderung außer dem Minimum, das den Core erreichbar macht. Verifikation: `independent-verifier`, Lifecycle-Tests A–H aus dem KONZEPT als Browser-Checkliste, Determinismus-Gate unverändert grün.
5. **Branch 2 `feat/workset-a-ui`:** StartScreen zu Ordner+Datei-Auswahl mit Entfernen vor der Verarbeitung, Sperranzeige während des Laufs, Migrationshinweis. Präsentationsseitig (`StartScreen.js`, `IngestCurationGrid.js`, CSS).
6. **G5 UI/UX-Abnahme (Michael)** nach Testanleitung: Zweck → Klickschritte → „Erwartet" / „Stutzig werden, wenn". Pflichtfälle: Ordner + Einzeldatei mischen; Foto entfernen, dann Lauf; Reload mitten im Hinzufügen; alter v8-Bestand wird ohne Verlust geöffnet; zweiter Tab.
7. STATUS-Notiz, `baseline`-Tag verschieben, SoT §10.3/§10.5 von „Zielvertrag" auf „realisiert".

**DoR:** Schritt 1 gemerged; KONZEPT-Datei im Repo; D4 vorliegend. **Gates:** alle (G1–G5).
**DoD:** DoD-Liste aus Phase-A-KONZEPT (Datei-Set, greps, byte-cmp) + Lifecycle-Tests A–H bestanden + SoT nachgezogen + Override-/Determinismus-Verhalten gegen Schritt-2-Bibliotheken unverändert (Regressionsschutz: gleiche Auswahl bei gleichem Bestand).
**Aufwand:** Claude 3–4 Sessions (Re-Audit 1, Core 1–2, UI 1); Michael ca. 2 h Entscheidungen + 2 h Abnahme.
**Bewusst nicht:** keine Änderung an Solver, Szenen, Presets; keine Mehrfach-Worksets/Projekte; kein Drag-and-drop-Komfort über das KONZEPT hinaus.

---

## 4. Schritte 4–7 bis RC1 (grob)

| # | Schritt | Inhalt | Abhängig von | Ergebniskriterium | Aufwand Claude |
|---|---|---|---|---|---|
| 4 | **Qualitätsblock** | Reihenfolge nach D3. Kandidaten: Candidate Expansion (mehrere Kandidaten je Cluster), Intent Brief (`meta.intent`, Muss-Motive/Ausschlüsse), E11 Face-Clustering (EdgeFace, mit Backend-Ehrlichkeit §13.1), Score-Spreizung (FROZEN `W_*`/`momentScore`, D-Eintrag). Je Baustein ein KONZEPT + Branch. | D3, Schritt 2 | Override-Quote und „unverzichtbar verworfen" sinken messbar auf denselben drei Bibliotheken (§14.E); Determinismus-Gate grün | 4–6 Sessions |
| 5 | **Robustheit** | Inferenz → Web-Worker (Architekturentscheid §9.1 revidieren, D-Eintrag), Pause/Resume/Wake-Lock gehärtet, HEIC-Performance, Backend-Status je Stufe sichtbar (§13.1), Proof Layer `curation-proof.json` (§13.2) | Schritt 4 (sonst doppelte Worker-Anpassung) | 1000-Bilder-Lauf übersteht Tab-Wechsel/Suspend; UI bleibt bedienbar während Inferenz; Fallbacks sichtbar | 3–4 Sessions |
| 6 | **Deterministische Erzählschicht** | Context Packs je Kapitel/Szene (§13.3), Kapitel-/Szenen-Titel aus Zeit/Ort/Aktivität (Template, deutsch, facts-only), Export-Manifest v3 = Buch-Skelett (Kapitel → Szene → Bilder + Beat + Begründung + Titel-Rohdaten), Review zeigt Titel. **Optional** Geo/POI Opt-in (§12) nur bei D5 = ja (Legal: OSM-Attribution, Netzwerk-Prinzip §9.6) | Schritt 4 | Export reicht für Übernahme in ein Layoutwerkzeug ohne Nacharbeit an der Struktur; ChatGPT-Review bestätigt Lesbarkeit des Manifests | 2–3 Sessions (+2 bei Geo) |
| 7 | **RC-Härtung** | Dead-CSS-Purge (deferred), Fehlertexte/Leerzustände, Erstnutzer-Hinweise (Modell-Download, Session-Gültigkeit der Originale), Abnahme-Lauf gegen §6-Kriterium auf ≥3 Bibliotheken, SoT final reconciled, Release-Notes, Netlify-Deploy, Tag `rc1` | 4–6 | Alle drei Bibliotheken ≤30 % Override, kein „unverzichtbar" verworfen; CI grün; Michael-Abnahme des Gesamtflows | 2–3 Sessions |

**Post-RC1 (Fernziel, nicht geplant, nur abgegrenzt):** D6 LLM-Weggabelung (lokal/remote/keins), Buchmodell und Seitenlayout aus Tag→Szene→Beat, PDF/Dienstleister-Export, LLM-Captions, Mobile.

---

## 5. Entscheidungen (offen, für Michael)

| ID | Frage | Empfehlung | Fällig |
|---|---|---|---|
| D1 | RC1-Scope wie Abschnitt 2? Reihenfolge Phase A (3) vor Qualitätsblock (4)? | Scope ja. Reihenfolge ja, weil Phase A fertig auditiert ist und die Diagnose den heutigen Stand messen soll | Schritt 1 |
| D2 | Beats 2 von 5: dokumentierte Vereinfachung oder Lücke? | Vereinfachung dokumentieren; Erweiterung nur, wenn Schritt 2 „Beat" als Fehlfall-Klasse zeigt | Schritt 1 |
| D3 | Reihenfolge Qualitätsblock | nach Befundbericht | Ende Schritt 2 |
| D4 | FROZEN-CHANGE für Phase A (`db.js`, `ingest.js`, `app.js`, `selectors.js`) | ja, mit Marker und Re-Audit | Beginn Schritt 3 |
| D5 | Geo/POI Opt-in in RC1? | nein (Legal/Netzwerk-Prinzip; erst 2.0) | vor Schritt 6 |
| D6 | LLM-Weggabelung | Post-RC1 | nach RC1 |

---

## 6. Risiken

| ID | Risiko | Wirkung | Gegenmaßnahme |
|---|---|---|---|
| R1 | Phase-A-KONZEPT nicht mehr auffindbar | Schritt 3 verzögert sich um eine Rekonstruktion (2–3 Sessions, erneute Audit-Runden) | In Schritt 1 klären; notfalls Schritt 4 vorziehen |
| R2 | Diagnose-Bibliotheken zu homogen | D3 auf falscher Basis | Drei explizit verschiedene Charaktere; Mindestgröße 300 |
| R3 | Phase A bricht Determinismus/Overrides | Regressionen in abgenommener Auswahl | Regressionsschutz gegen Schritt-2-Exporte (gleiche Auswahl bei gleichem Bestand) |
| R4 | Worker-Umbau (Schritt 5) destabilisiert CDN/WASM-Pfad | §9.1 hat genau davor gewarnt | Eigener Spike-Branch vor dem KONZEPT; Rückfallpfad Main-Thread bleibt |
| R5 | Mission Creep durch Fernziel-Ideen (Layout, LLM) | Schritte verwässern | Parkplatz, Scope-Freeze, „Bewusst nicht"-Listen, Abschnitt 2 |
| R6 | ChatGPT-Befunde werden ungeprüft übernommen | falsche Korrekturen | Triangulation am Code ist Pflicht (1.2) |

---

## 7. Sofort nächste Aktion
Nach Michaels Antwort auf D1 und D2 startet Schritt 1 auf `chore/governance-close`. Michael: Phase-A-Datei suchen, Jungle-Jiggle-Praktiken benennen.
