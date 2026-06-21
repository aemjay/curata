# KONZEPT — Einstellungen vor der Verarbeitung (Presets-Sektion im StartScreen)

**Version:** v1.1 (Reviewer-Audit eingearbeitet — beauftragbar)
**Status:** Entscheidung B getroffen. Architektur + Verträge festgelegt. τ-Frage entschieden (§8 = 8a). Reviewer-Blocker 1 code-verifiziert als **bereits erfüllt**; Blocker 2 (Resync-Guard) eingearbeitet; 5 Präzisierungen übernommen.
**Basis (maßgeblicher Stand):** `photobook-review-fokus-inline-v1` (verifiziert + browser-abgenommen)
**Scope:** UI-Komponente (Extraktion) + StartScreen-**Persistenz der bestehenden** `presets`-Meta vor dem ersten Lauf. Kein neues Schema, kein neuer Meta-Key, kein Pipeline-/Solver-/`app.js`-Eingriff. Betroffen: `js/components/SelectionSettingsPanel.js` (neu), `js/screens/StartScreen.js`, `js/screens/ReviewScreen.js` (Extraktion).

---

## 1 — Problem / Ziel
Auswahl-Einstellungen (`selectionMode`, `focus`, `techStrict`, `tauSliderPos`, `maxPickCap`) sind heute **nur** im Review setzbar. Ziel: sie **vor** der Verarbeitung initial setzbar machen — „dort auch, aber nicht nur". Erste Verarbeitung läuft bereits mit den gewählten Parametern statt Default → Nachjustieren.

## 2 — Entscheidung B (Recap)
Einstellungen als **Sektion im StartScreen** (nach Ingest/Stats, vor dem Start-Button). **Kein** eigener Screen, **kein** `app.js`/`screenMap`-Eingriff. (Variante A mit eigenem `'presets'`-Screen wegen FROZEN-`screenMap`-Berührung verworfen.)

## 3 — Ist-Diagnose (verifiziert, Stand fokus-inline-v1)

### 3.1 StartScreen-Flow
`proceedToProcessing` (`StartScreen.js:169-185`): `getMeta('presets')` → **nur falls leer** `putMeta('presets', state.presets)` → `RESET_PIPELINE` → `SET_SCREEN processing`. **Kein** `SET_PRESETS`, **kein** `startPipeline`. Button „Weiter zur Verarbeitung" (`:327`) im `showCuratingActions`-Block (`isCurating`), disabled außer `photosLoaded && canMutate && !starting`.

### 3.2 Start-Mechanik
ProcessingScreen startet die Pipeline **selbst** per `useEffect` auf `pipeline.status==='idle'` (`ProcessingScreen.js:78-86`). `RESET_PIPELINE` setzt `idle` → Autostart greift. Ein expliziter `startPipeline`-Aufruf im Start-Handler ist **nicht** erforderlich und wäre Doppelstart-Risiko.

### 3.3 Presets-Lesepfad (kritischer Vertrag — beide Erstlauf-Consumer verifiziert)
**Zwei** laufrelevante Consumer lesen Presets/`focus` aus META:
- `s6_select.js:105` — `db.getMeta('presets')` (Auswahl-Stufe: `selectionMode`, `techStrict`, `tauSliderPos`, `maxPickCap`, `focus`).
- `s3_faces.js:46` — `readFocusFactor(db)` (`:150-152`: `db.getMeta('presets')` → `presets.focus` → `FOCUS_FACTORS[focus] ?? balanced`). Das ist der **Stream-Klassifikationspfad des ersten Laufs**.

⇒ **Reviewer-Blocker 1 am Code widerlegt:** der erste `faces`/Stream-Pfad fällt **nicht** still auf Default `balanced`, sofern `putMeta('presets', next)` **vor** `SET_SCREEN processing` läuft (so spezifiziert). Beide Consumer lesen META, keiner liest `state.presets`. `SET_PRESETS` ist damit **rein UI-Sync** (ProcessingScreen-Anzeige, Review-Draft-Init), nicht laufrelevant. Pflichtiger Schreibvorgang bleibt `putMeta` vor `SET_SCREEN`.

### 3.4 SelectionSettingsPanel
Definition `ReviewScreen.js:211`. Props `{ draftPresets, dirty, disabled, needsRecalc, applyState, selectParams, onChange, onApply }`. **`selectParams` destrukturiert, im Render-Body nicht verwendet** → pre-processing gefahrlos `null`/weglassbar. Fünf Controls, **alle aus `draftPresets`** (`selectionMode`, `focus`, `techStrict`, `tauSliderPos`, `maxPickCap`). `tauSliderPos` ist gespeicherte Position ∈ [−1,+1] in `presets`, **keine** Ableitung aus `selectParams`; die τ-Live-Zahl lebt im Review-Header, nicht im Panel. Footer-Button via `onApply`, disabled außer `dirty`.

### 3.5 Review-Verdrahtung (bleibt funktional unverändert)
`draftPresets`-State (`:1370`), Resync-Effect bei Presets-Wechsel (`:1463`), `settingsDirty` (`:1562`), `onChange` (`:1607`), `applySelectionSettings` (`:1610`, inkl. verifiziertem Fokus-Inline-Pfad). Panel-Mount im `settings`-Tab (`:1847`).

### 3.6 Lebenszyklus
`startNewWorkset` erhält `presets` (v7 §10.3 Reset-Scope: löscht Folder-Meta + `selectParams`, **erhält** `presets`/Theme/`vlmTextEmb:*`). ⇒ Frischer StartScreen trägt die zuletzt gewählten Presets als Ausgangswert.

## 4 — Architektur

### 4.1 Extraktion (DRY)
Neue Datei `js/components/SelectionSettingsPanel.js` mit **Named Exports**: `SelectionSettingsPanel` **und** die Panel-eigenen Helfer aus `ReviewScreen.js` — `normalizePresets` (`:21`), `samePresets` (`:30`), `RadioGroup` (`:156`), `tauSliderLabel` (`:178`), `normalizeDraftMaxPickCap` (`:185`), `selectionSettingsSummary` (`:192`), `normalizeTauSliderPos` (`:332`). Importiert ausschließlich `deps.js` (**keine** Rückimporte aus `ReviewScreen.js` → kein Zirkelimport).
`ReviewScreen.js` importiert daraus `{ SelectionSettingsPanel, normalizePresets, samePresets }` (und jeden weiteren Helfer, den ReviewScreen außerhalb des Panels noch referenziert — per `node`-Lauf + Undefined-Check absichern). Die **Pipeline-eigene** `normalizePresets` in `s6_select.js:106` ist eine separate, FROZEN Kopie und wird **nicht** angefasst.

### 4.2 `mode`-Prop
Neues Prop `mode: 'review' | 'initial'`, Default `'review'`.
- **`'review'`** — verhaltens-/DOM-semantisch gleich zu heute: Footer-Aktion, Dirty-Badge, „erst mit Button"/„Slider-Drag startet keinen Lauf"-Copy, `onApply`/`dirty`/`needsRecalc`/`applyState`/`selectParams` aktiv.
- **`'initial'`** — nur das Controls-Grid. **Kein** Footer-Button, **kein** Dirty-Badge, **kein** Recompute-Copy. Kontextgerechte Hints (insb. `focus`-Option „Menschen" **nicht** mit dem Review-Text „aus vorhandenen Gesichtern neu abgeleitet" — pre-processing existieren keine Gesichter; neutraler Hint, z. B. „Menschen stärker gewichten"). τ-Hint (§8). `selectParams` ungenutzt → `null`/weglassbar.

### 4.3 StartScreen-Integration
- Lokaler State `draftPresets` aus `normalizePresets(state.presets)`. **Resync-Guard (Reviewer-Blocker 2):** Resync aus `state.presets` **nur solange der lokale Draft pristine** ist — sonst überschreibt ein asynchroner `state.presets`-Wechsel laufende Nutzeredits.
  ```js
  const [draftPresets, setDraftPresets] = useState(() => normalizePresets(state.presets));
  const [draftTouched, setDraftTouched] = useState(false);

  function onChange(key, value) {
    setDraftTouched(true);
    setDraftPresets(prev => normalizePresets({ ...prev, [key]: value }));
  }

  useEffect(() => {
    if (!draftTouched) setDraftPresets(normalizePresets(state.presets));
  }, [state.presets, draftTouched]);
  ```
  Bei relevantem Workset-Neustart/Reset darf der `touched`-Guard gezielt zurückgesetzt werden (falls ein geeigneter Token im State vorhanden ist, z. B. Wechsel von `worksetSessionStartToken`/`worksetRevision`).
- Neue Sektion `<${SelectionSettingsPanel} mode="initial" draftPresets=${normalizePresets(draftPresets)} disabled=${!canMutate} onChange=${onChange} />` **zwischen** Stats-Sektion (`:310-322`) und Start-Action-Row (`:324-329`).
- **Ein** Primärbutton bleibt die bestehende Action-Row-Schaltfläche (`:327`); Panel im Initial-Modus ist footerlos. Panel bleibt rein präsentational; kein `SET_SCREEN`-Wissen im Panel.

### 4.4 Start-Handler (angepasstes `proceedToProcessing`)
Ersetzt die bedingte Speicherung durch unbedingtes Schreiben des Drafts:
```js
const next = normalizePresets(draftPresets);
await putMeta('presets', next);                    // META = Pipeline-SoT (§3.3)
dispatch({ type: 'SET_PRESETS', payload: next });  // UI-Sync
dispatch({ type: 'RESET_PIPELINE' });
dispatch({ type: 'SET_SCREEN', screen: 'processing' });
```
Reihenfolge verbindlich: META + State **vor** `SET_SCREEN`. Fehlerpfad unverändert (Catch wie heute: kein Screen-Wechsel bei `putMeta`-Fehler, `PIPELINE_ERROR`/`ingest.error`).

## 5 — Verträge
1. **`presets` in META ist die Pipeline-Quelle** (verifiziert: `s3_faces.js:46`/`readFocusFactor` für `focus` im Erstlauf **und** `s6_select.js:105` für die Auswahl-Stufe). Initial-Start schreibt **vor** `SET_SCREEN`.
2. `SET_PRESETS` hält `state.presets` synchron (ProcessingScreen-Anzeige; Review-Draft-Init `:1370/1463`) — rein UI, nicht laufrelevant.
3. **Kein** neuer Meta-Key, **keine** Schema-/`normalizeState`-Änderung (Draft ist lokaler Komponenten-State, `presets` existiert bereits). **Kein** `app.js`/`screenMap`-Eingriff.
4. Panel-Extraktion ohne Zirkelimport; Review-Render im `'review'`-Modus verhaltens-/DOM-semantisch gleich.
5. **Erstlauf-Lesepfad:** alle laufrelevanten Preset-Felder sehen den vor `SET_SCREEN` geschriebenen `meta.presets`-Wert; `focus` insbesondere via `s3_faces.js:46`. Nutzt ein Stage-Pfad `state.presets` statt `meta.presets`, ist `SET_PRESETS` vor `SET_SCREEN` ausreichend zu begründen; andernfalls muss der Pfad aus META lesen. **Keine** Pipeline-Logik ändern — nur Lesepfad-Verifikation, im STATUS dokumentieren.

## 6 — Failure-Mode-Pass (Reviewer-Perspektive, vorab)
- **Zwei Tabs / überlappende Ops:** Mitgliedschafts-/Start-Absicherung unverändert (`worksetSessionStartToken`/`worksetLocked`/`canMutate`/`starting`). Draft ist lokal bis zum Start; keine neue Concurrency-Fläche.
- **Async-Grenze Lesen/Schreiben:** `putMeta` vor `SET_SCREEN`; bei Fehler kein Screen-Wechsel (bestehender Catch). Pipeline liest META erst nach Screen-Wechsel/Autostart → sieht garantiert den geschriebenen Wert.
- **Abbruch/Crash zwischen `putMeta` und `SET_SCREEN`:** META aktuell, Screen noch Start → harmlos; erneuter Start schreibt identisch (idempotent).
- **Leer/degeneriert:** keine Fotos → Start-Button disabled; Panel rendert harmlos; `tauSliderPos`-Default 0.
- **Legacy/Migration:** `normalizePresets` coerct fehlende/alte Felder; kein neues Feld.
- **Idempotenz/Re-Entry:** `starting`-Guard; `RESET_PIPELINE`→`idle`→ **ein** Autostart-Effect.
- **Nachbarsysteme:** Pipeline liest META, ProcessingScreen-Anzeige liest State, Review-Draft re-initialisiert aus `presets` — alle drei nach Start konsistent (META+State geschrieben).
- **Resync-Hazard:** durch `draftTouched`-Guard (§4.3) ausgeschlossen — Resync nur solange pristine; laufende Edits werden nicht geclobbert.

## 7 — FROZEN / Scope
Unberührt: Pipeline/Runner/Solver (`s6_select.js`)/Segmentierung/`presetInvalidation.js`/Modus-Logik/`recomputeNeedsHeavyPath`/Inline-Recompute/Reducer+`screenMap` (`app.js`)/`db.js` (API-Form)/Schema/`normalizeState`/`FOLDER_META_KEYS`/Inferenz-Stages/Scoring. **`s6_select.js`-eigene `normalizePresets` nicht anfassen.** Betroffen: neue Komponentendatei, `ReviewScreen.js` (nur Extraktion, Review-Verhalten gleich), `StartScreen.js`. `css/main.css` voraussichtlich **nicht** (Panel-CSS existiert, wird wiederverwendet) — falls Initial-Modus minimale Abstände braucht, additiv und gesondert ausweisen.

## 8 — τ im Initial-Modus (entschieden: 8a)
τ-„Auswahlschärfe" hat im Initial-Modus keine Live-Zahl (der Zähler entsteht erst in der `select`-Stufe). **Festgelegt: 8(a)** — τ initial als grobe Vorab-Tendenz anzeigen (Parität zur Review-Sektion; Feinjustierung mit Live-Zähler im Review), mit erklärendem Hint. Verbindliche Copy:
> „Legt die grobe Auswahlschärfe für den ersten Lauf fest. Die tatsächliche Bildzahl siehst du nach der Analyse im Review."

## 9 — DoD (für die Beauftragung)
1. Neue `js/components/SelectionSettingsPanel.js`: exportiert `SelectionSettingsPanel`, `normalizePresets`, `samePresets` (+ benötigte Panel-Helfer); importiert nur `deps.js`; kein Zirkelimport.
2. `ReviewScreen.js`: Panel + verschobene Helfer lokal entfernt, aus neuem Modul importiert; alles sonst Genutzte re-importiert; **`'review'`-Render und -Verhalten funktional/DOM-semantisch unverändert** (nach Extraktion ist die Datei nicht bytegleich — gemeint ist Verhaltensgleichheit: Fokus-Inline, `applySelectionSettings`, Dirty, Tabs unverändert). `node --check` grün, keine undefinierten Referenzen. **Anti-Schein-Extraktion/Zirkelimport:**
   - `grep -nE "function SelectionSettingsPanel|const SelectionSettingsPanel" js/screens/ReviewScreen.js` → **leer**.
   - `grep -nE "from './ReviewScreen.js'|from '../screens/ReviewScreen.js'" js/components/SelectionSettingsPanel.js` → **leer**.
3. `mode`-Prop: Default `'review'` = heute identisch; `'initial'` = nur Controls-Grid (kein Footer/Dirty/Apply), kontextgerechte Hints, τ-Hint-Copy (§8).
4. `StartScreen.js`: `draftPresets`-State + `draftTouched`-Guard + Resync-Effect (§4.3) + `onChange`; Panel-Sektion (`mode='initial'`) zwischen Stats und Action-Row; `proceedToProcessing` schreibt `putMeta('presets', normalizePresets(draftPresets))` + `SET_PRESETS` + `RESET_PIPELINE` + `SET_SCREEN processing`; Fehlerpfad unverändert.
5. Kein `app.js`/`screenMap`/`normalizeState`/Schema/Pipeline-Eingriff; FROZEN byte-identisch.
6. `selectParams` im Initial-Modus weglassbar/`null` (ungenutzt).
7. **Lesepfad-Nachweis im STATUS-MD:** dokumentieren, dass alle erstlaufrelevanten Preset-Felder den vor `SET_SCREEN` geschriebenen `meta.presets`-Wert sehen — `focus` via `s3_faces.js:46`/`readFocusFactor`, übrige via `s6_select.js:105`. Kein Pipeline-Logik-Eingriff, nur Lesepfad-Bestätigung.
8. **Browser:** Einstellungen auf dem StartScreen vor der Verarbeitung änderbar; gewählte Presets steuern den ersten Lauf (über `focus`/τ-Effekt sichtbar); Review zeigt/ändert dieselben Presets; Review-Verhalten unverändert.

## 10 — Reihenfolge
Reviewer-Audit eingearbeitet → beauftragbar (ein Branch = ein Delta). Danach Container-Verifikation gegen §9, dann Browser-Abnahme.

## 11 — SoT-Folgepflicht (nach Landung)
KONZEPT-Pipeline-SoT sagt aktuell: alle Auswahl-Einstellungen leben im Review, PresetsScreen auswahl-leer, Erstlauf nutzt Default `focus='balanced'`. Dieses Konzept ändert das Produktmodell bewusst: Einstellungen leben künftig im **StartScreen und** Review; der Erstlauf nutzt die gewählten Presets. **Nach** Container-Verifikation + Browser-Abnahme ist v7 zu bumpen (§5 „fünf Screens", Kopf-Stand) — zusammen mit der ohnehin offenen E3/E4a/Dubletten/fokus-inline-Reconciliation in einem Schwung.
