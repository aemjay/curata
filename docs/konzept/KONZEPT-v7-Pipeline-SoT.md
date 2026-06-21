# MVP-Konzept: Lokale Urlaubsfoto-Auswahl → Buch-Skelett

**Stand:** v8 — **Auswahl-Einstellungen im StartScreen *und* Review (Presets-Initial), Review-Einstellungen-Tab (E4a) und Inline-Recompute (fokus-inline) realisiert und browser-abgenommen; τ-Regler (E13.3) + Controls-IA seit v7.** *(Dateiname historisch „v7-v10"; inhaltlicher Stand ist v8 — der Name ist nicht maßgeblich.)* Gegenüber v6: (1) **Auswahlmengen-Regler `tauSliderPos ∈ [−1,+1]`** ins Produktmodell aufgenommen (asymmetrisch, datenabhängig um den Auto-Punkt; `select-v4 → select-v5`, `selectParamsSchema: 'select-params-v3'`). (2) **Controls-IA:** *alle* Auswahl-Einstellungen leben seit v7 im **Review** (inkl. `focus`; in v8 um die StartScreen-Sektion ergänzt, siehe (4)); `focus` invalidiert gezielt `['vlm','scenes','select']` (Re-Derive aus Cache, **kein** Modell-Laden) via neuem `invalidateStages`; Stream-Klassifikation als Single-Source-Modul; Vor-Analyse-Flow „Weiter zur Verarbeitung". *(v7-Stand „PresetsScreen auswahl-leer" — in v8 durch die StartScreen-Einstellungen-Sektion abgelöst, siehe (4).)* (3) **Workset-Modell adoptiert** (für Kuratierung Phase A, beauftragbar, *noch nicht realisiert*): `folderSignature` = `worksetSignature` — die Signatur schützt eine **konsistente Arbeitsmengen-Version**, nicht einen physischen Ordner (ersetzt §10.3-Ordner-Lifecycle); verlustfreie Legacy-Migration. (4) **v8 — Einstellungs-Standort korrigiert:** Auswahl-Einstellungen leben im **StartScreen** (Sektion vor dem Start, `SelectionSettingsPanel mode='initial'`) **und** im **Review** (Einstellungen-Tab, E4a) — nicht mehr „nur im Review". Der **Erstlauf nutzt die gewählten Presets** (kein Default `focus='balanced'`): `s3_faces.js`/`readFocusFactor` liest `meta.presets.focus`, das der StartScreen via `putMeta('presets')` **vor** `SET_SCREEN` schreibt. Review-Recompute läuft **inline** (Light-Pfad), kein Sprung mehr auf den Processing-Screen. `screenMap` bleibt FROZEN `{start, processing, review}` — **kein** eigener Presets-Screen. Stage-Versionen: `chapters-v3`, `scenes-v1`, **`select-v5`**.
- ABGENOMMEN: E13.1; E13.2.1 (select-v3); E13.2.2 (select-v4: komposition-adaptive Diversität) — feld-abgenommen; **E13.3 Phase 0+1 (τ-Regler, select-v5)** — container- + browser-abgenommen; **Review-Controls v3** (alle Einstellungen ins Review inkl. `focus`, `invalidateStages`, PresetsScreen auswahl-leer — *in v8 durch Presets-Initial abgelöst*) — container- + browser-abgenommen (Fokus rechnet kurz, lädt kein Modell; Regler beidseitig wirksam; Overrides überleben; Lauf-Sperre greift); **E4a Einstellungen-Tab** (`REVIEW_SIDE_TABS = settings|coverage|diagnostics`, Default-Tab Abdeckung; Dirty-Dot am Tab) — browser-abgenommen; **fokus-inline** (Inline-Recompute: `applySelectionSettings` → `runRecompute({heavy:false})`, Heavy-Gate `recomputeNeedsHeavyPath`) — browser-abgenommen; **Presets-Initial** (StartScreen-Einstellungen-Sektion `mode='initial'`; Erstlauf nutzt die gewählten Presets) — browser-abgenommen.
- NÄCHSTER SCHRITT: **Kuratierung Phase A — A-Core** (Opus; Working-Set-Lebenszyklus, atomare Mutation + CAS, Hydration, Reset, Sperre — KONZEPT-Kuratierung-Phase-A-v6.7, 11 Audit-Runden; A-Core geschlossen, finaler §4.10-Review abgeschlossen, beauftragbar), dann **A-UI** (Sonnet). Danach Inferenz→Web-Worker (Architektur), breiter Mobile-Pass.
- **Erledigt in v8 (war: bekannter offener UX-Punkt):** „Auswahl neu berechnen" sprang früher auf den Processing-Screen und zurück; mit **fokus-inline** läuft der Light-Pfad (select-only / Fokus-Re-Derive) **inline im Review** — `applySelectionSettings` → `runRecompute({heavy:false})`; der Heavy-Pfad greift nur per `recomputeNeedsHeavyPath`-Gate (echte Stage-Invalidierung).
- E11/§14-LLM nachrangig · **Deployment:** Netlify Drop (statisch, zero-build) · **Verarbeitung:** vollständig lokal im Browser (JS / WASM / WebGPU); Netzwerk nur als künftiges Opt-in gemäß §9.6

---

## 1. Ziel & Scope

**Input:** Ordner mit Urlaubsfotos (JPEG/PNG/WebP/**HEIC**). *(Aktuell: Ordner. Nach Kuratierung Phase A: Ordner **und** Einzeldateien als additive Arbeitsmenge — §10.3.)*
**Output:** Das **Review-UI ist die primäre Ergebnisfläche**; `selection.json` + ZIP sind Export-Artefakte.

| Drin (v1) | Bewusst draußen (v1) |
|---|---|
| Technik-Bewertung (Schärfe/Belichtung) | Automatisches Seitenlayout / Layout-Editor |
| Kapitel-Segmentierung | GPS-Reverse-Geocoding zu Ortsnamen *(vorbereitet als v2 — §12)* |
| Personen-Split (P / S / M) | Active-Learning aus Overrides |
| Near-Dup-Dedup + Diversität | Videos / Live Photos |
| VLM-Tagging (nur Cluster-Repräsentanten) | Mobile-Optimierung (Desktop-first) |
| Personen-Identität via Face-Clustering *(vorbereitet als s3b-Stub; nach Segmentierung, nachrangig — siehe §15)* | Storytelling als „gelöstes" Problem |
| Narrative Selektion | |
| Review-UI als Ergebnisfläche | |
| Export (ZIP + Manifest + Kontaktbogen) | |

**Grundprinzip:** Vollautomatisch ist nur die *Vorsortierung*. Die finale Auswahl bestätigt der Mensch.

---

## 2. Pipeline (Funnel: billig zuerst, teuer zuletzt)

| Stufe | Key | Was | Werkzeug |
|---|---|---|---|
| Ingest | — | EXIF, HEIC-Decode, Downscale ~512 px, IDs | Worker (OffscreenCanvas) |
| 1 | `technical` | Schärfe region-aware + Belichtung — Strafterm, kein Cut | JS |
| 2 | `chapters` | Tag/Kapitel = Kalendertag; Split bei GPS-/großer Zeitlücke, Merge stiller Tage | JS |
| 3 | `faces` | P/S/M-Split + Blink/Smile | MediaPipe FaceLandmarker |
| 3b | `persons` | Face-Clustering → Personen-IDs (Stub bis E11; bleibt `skipped`, falls kein Modell verfügbar) | kleines Face-ONNX (optional) |
| 4 | `embeddings` | CLIP-Embeddings → Near-Dup-Cluster + Repräsentanten | transformers.js |
| 5 | `vlm` | Florence-2-Caption + OD (`vlmRaw`); Ableitung: `place`/`activity` per Zero-Shot über CLIP-Embeddings (E6-Checkpoint), `shotType` geometrie-/caption-basiert, `mood` hybrid | transformers.js |
| 5b | `scenes` | **Szenenbildung** aus Tag/Kapitel + Zeit + GPS + `vlm.place/activity` (auf der Repräsentanten-Sequenz; Nicht-Reps erben über `clusterId`). `sceneId` pro Photo, `meta.scenes`. Strikt innerhalb eines Tags. | JS |
| 6 | `select` | Constraint-Solver (`select-v5`): **globaler** τ-Qualitäts-Floor (distributions-relativ, Auto-Umfang; ein τ_auto/Lauf) als Greedy-Gate, **um den Auto-Punkt per `tauSliderPos ∈ [−1,+1]` verschiebbar** (datenabhängig: −1→`FLOOR_MIN_SCORE`, +1→`TAU_MAX_SCORE`, 0→τ_auto; `floorGate` an `tauEffective`). **Floor- und Beat-Seeding pro Szene** (modusabhängig: Floor chronicle/balanced, Beats chronicle); **Greedy global** mit Szenen-Konzentrations-Malus + komposition-adaptiver Diversität/Redundanz. Tag/Kapitel = chronologischer Container (kein separater Tag-Budget-/Coverage-Pass; Tagesabdeckung emergent über Szenen-Floor). Kein `targetCount`; optionales `maxPickCap` (für Auto hart über alle Phasen). | JS |

Stufen **sequentiell**; ML-Modelle nach jeder Stufe entladen. Weights via Cache API. Zwischenstand in IndexedDB → resumebar.

---

## 3. Das Erzählmodell

1. **Skelett** = Zeit (+ GPS) → chronologischer Reisebogen.
2. **Kapitel/Tag** = grobe Tages-/Reiseeinheit (Kalendertag mit Split/Merge). **Szene** = zusammenhängende Aufnahme-Situation innerhalb des Tages (Ort/Aktivität). Realisiert in `select-v5`: **Floor (bestes Bild je Szene) und Beat-Härtung laufen pro Szene** (modusabhängig); der **globale τ-Grenznutzen** (ein τ_auto/Lauf, per `tauSliderPos` verschiebbar) gatet den Greedy; **Konzentrations-Malus + Diversität/Redundanz** wirken szenen-/strombezogen. Tagesabdeckung entsteht **emergent** über den Szenen-Floor — **kein fester Budget/`targetCount`, kein separater Tag-Budget-/Coverage-Pass** (§4 Punkt 4, §15).
3. **Beat-Grammatik pro Szene:** establishing → action → detail → hero → transition. *(Realisiert: `select-v5` seedet Floor und Beats pro Szene; Greedy global mit globalem τ-Gate.)*
4. **Coverage-Zwänge:** Personen, Orte, Emotions-/Aktivitätsvielfalt.
5. **Anti-Redundanz** innerhalb der Szene.

**Story-Score ist relational:** Selektion = Constraint-Erfüllung.

### Ordnungsprinzip (unverhandelbar)

**Chronologie ist immer der dominante Ordnungsfaktor.** Bilder werden nie nach Typ geclustert oder umsortiert. Presets/Ströme beeinflussen ausschließlich die *Auswahl*, niemals die *Reihenfolge*. Maximal zulässig: zeitlich eng benachbarte Bilder desselben Stroms rücken innerhalb eines Kapitels als Tiebreaker zusammen.

### Personen-Achse als Verteiler

| Strom | Bilder | Logik |
|---|---|---|
| **P** | Personen dominant | emotionaler Bogen: Ausdruck, Interaktion, Moment |
| **S** | keine Person | Reisetagebuch: Ort, Abdeckung, visuelle Varianz |
| **M** | Person in Szene | Anker/Hero; zählt auf beide Ströme |

### Personen-Coverage: zwei Betriebsmodi
- **Mit Face-Clustering (Soll):** echte Coverage pro Person, benenn-/mergebar.
- **Fallback:** Gesichts-Anzahl-/Größen-Diversität; UI weist darauf hin.

---

## 4. Einstellungsmenü (Presets)

1. **Auswahlprinzip** — *Chronik* / *Ausgewogen* (Default) / *Höhepunkte*
   Steuert Floor, λ (`LAMBDA_SCENE_BY_MODE`) und Beat-Härte entlang der Zeitachse, **nie die Reihenfolge**:
   - *Chronik:* Floor (bestes Bild pro Szene, sofern über `floorGate`), λ hoch, Beats hart.
   - *Ausgewogen:* Floor an, λ mittel.
   - *Höhepunkte:* kein Floor, λ ≈ 0, Beats weich; leere Szenen erscheinen nicht.
2. **Fokus** — Menschen / Orte / Ausgewogen (Default) → P/S/M-Schwellen + Strom-Balance.
3. **Technik-Strenge** — Streng / Moment vor Technik (Default) → Gewicht des Technik-Scores.
4. **Auswahlmenge** — **Auto-Umfang** statt fester Zielanzahl: τ-Grenznutzen schneidet eine relative Qualitätskante (distributions-relativer τ_auto, §15). **Kein numerischer `targetCount` mehr.** **Realisiert (E13.3):** *relativer* Regler „strenger ↔ mehr behalten" als persistierter **`tauSliderPos ∈ [−1,+1]`** (Default 0 = Auto), datenabhängig um den Auto-Punkt (−1→`FLOOR_MIN_SCORE`, +1→`TAU_MAX_SCORE`); inert, wenn τ_auto bereits am Floor klemmt. Optionales hartes `maxPickCap` als Obergrenze (Auto hart, manuelle Includes weich/sichtbar überschreitend).

**IA-Hinweis (Controls-IA, realisiert):** Alle vier Schalter (Auswahlprinzip, Fokus, Technik-Strenge, Auswahlmenge) **plus** das `maxPickCap` sind **im StartScreen** (Sektion vor dem Start, `SelectionSettingsPanel mode='initial'`) **und im Review** (Einstellungen-Tab, Live-Tuning mit „Auswahl neu berechnen") setzbar — **nicht** auf einem eigenen Vor-Analyse-Presets-Screen (`screenMap` FROZEN `{start, processing, review}`). Vier davon sind select-only (instant); `focus` löst eine kurze Re-Derive aus (`['vlm','scenes','select']`, kein Modell-Laden). **Erstlauf nutzt die im StartScreen gewählten Presets** (kein Default `focus='balanced'`): `s3_faces.js`/`readFocusFactor` liest `meta.presets.focus` — der StartScreen schreibt es via `putMeta('presets')` **vor** `SET_SCREEN`; `FOCUS_FACTORS.balanced` greift nur als Fallback bei fehlendem Wert. Das „Einstellungsmenü" ist damit eine Modell-Beschreibung, kein eigener Screen.

---

## 5. UI/UX — fünf UI-Flächen (drei Reducer-Screens)

> **Klarstellung (v8):** „Fünf" zählt **UI-Flächen** im Nutzerfluss, **nicht** Reducer-Screens. Der `screenMap`-Reducer ist FROZEN dreigliedrig: `{start, processing, review}` — „Verarbeitung-Vorbereitung" ist in den StartScreen gefaltet, Export ist eine Fläche innerhalb des Flows. Die **Nummerierung 1–5 bleibt stabil**, weil eingefrorene v5-Prompts (§11) auf „Screen 4/5" verweisen. Wo unten oder in den historischen Prompts „PresetsScreen"/„Vor-Analyse-Presets-Screen" steht, ist das ein **v5-Altbegriff** — ein solcher Screen existiert nicht; Auswahl-Einstellungen sind eine **Sektion im StartScreen** (Screen 1) **und** ein **Tab im Review** (Screen 4).

1. **Start/Ingest:** Ordnerwahl, Thumbnail-Wall, Eingangsdiagnose (Anzahl, HEIC-%, GPS-%, WebGPU), Laufzeitschätzung; **Auswahl-Einstellungen-Sektion** (`SelectionSettingsPanel mode='initial'`, zwischen Stats und Start-Button — alle fünf Regler, footerlos) zum Vorab-Setzen der Presets für den **ersten Lauf**; CTA „Weiter zur Verarbeitung" (schreibt `putMeta('presets')` **vor** `SET_SCREEN processing`). *(Kuratierung Phase A erweitert diesen Screen zu Ordner+Einzeldatei-Auswahl mit Entfernen vor der Verarbeitung — beauftragbar, noch nicht realisiert.)*
2. **Verarbeitung-Vorbereitung** *(überholt — in den StartScreen gefaltet; Nummer bleibt wegen v5-Prompt-Referenzen):* Es gibt **keinen** eigenständigen auswahl-leeren Vorbereitungs-Screen mehr. Die Vorab-Einstellungen sitzen seit **Presets-Initial** in der StartScreen-Sektion (Screen 1); der frühere „auswahl-leer"-Stand (Review-Controls v3) ist damit abgelöst. Der ProcessingScreen (Screen 3) startet die Pipeline selbst per Effect auf `pipeline.status==='idle'`.
3. **Processing:** Stufenliste, Live-Fortschritt, Restzeit, Pause/Resume, Wake Lock, Kapitel erscheinen live.
4. **Review (Kern):** EINE vereinheitlichte Arbeitssicht. **Das Panel „Auswahl-Einstellungen" (alle fünf Regler: Auswahlprinzip, Fokus, Technik-Strenge, Auswahlmenge-Regler `tauSliderPos`, `maxPickCap`) liegt im Einstellungen-Tab der Sidebar** (E4a: `REVIEW_SIDE_TABS = settings|coverage|diagnostics`, Default-Tab Abdeckung; Dirty-Dot am Einstellungen-Tab und am collapsed Toggle) + Button „Auswahl neu berechnen" (Draft-basiert, im Lauf gesperrt; Light-Pfad rechnet **inline** im Review, nur echte Stage-Invalidierung nimmt den Heavy-Pfad — `recomputeNeedsHeavyPath`). **Pro Tag/Kapitel werden Szenen als Zwischenblöcke angezeigt; innerhalb jeder Szene bleiben Picks und (per Dichte-Regler eingeblendete) Verwürfe chronologisch verwoben** — beide direkt aktionierbar (Pick „Ablehnen", Verwurf/Ex-Pick „Zurückholen"). Dichte-Regler (Aus = Picks + manuell abgelehnte Ex-Picks · Knapp = + Near-Misses · Alle Verwürfe = + strukturell budget/redundant/stream; Standard Knapp), global + pro Kapitel. Dubletten erscheinen gebündelt in einer Gruppen-Box (Tausch zum Repräsentanten), nie als freie Strom-Items. Lightbox (Bild-Tipp) mit rechtem Metadaten-Panel; Cluster-Tausch nur über Button/Box. Pick-Karten (Badges, Caption, „Warum gewählt", Aufnahmedatum), Coverage-Panel, Auswahl-Zähler „picked — N manuell" (Umfang τ-bestimmt; bei gesetztem `maxPickCap` sichtbare Überschreitung durch manuelle Includes), live Override-Quote. Dark/Light-Theme-Toggle (persistiert). Bilder ohne Crop (contain).
5. **Export:** ZIP (Originale), `selection.json`, druckbarer Kontaktbogen.

**Leitplanken:** Desktop-first; Lazy-Loading Pflicht; die Arbeitssicht ist Beurteilungsfläche, kein Layout-Editor.

---

## 6. Abnahmekriterium

> Realer Urlaubsordner (≥300 Fotos). **Erfolg: Override-Quote ≤ 30 %** und kein als „unverzichtbar" markiertes Bild verworfen.

**Segmentierungs-Gate (E13/Etappe 1):** Gleiche Fotos + gleicher Zustand → identische `chapterId` UND `sceneId` (Determinismus). Jede Szene liegt strikt **innerhalb eines Tags**; keine Szene überspannt nicht-zusammenhängende Zeitbereiche. Re-Run nach Reload identisch. Alte `chapters-v1`/`chapters-v2`-Zustände (v2 = G1-Härtung) werden über den `implVersion`-Mismatch (`chapters-v3`) invalidiert und neu gebildet.

---

## 7. Bekannte Grenzen

GPS fehlt oft → Kapitel rein zeitbasiert. VLM-Felder manchmal falsch → Review-UI Pflicht. ~300 Fotos ≲1 h (WebGPU); Tausende = Mehrstunden-Lauf (Resumability). Ohne Face-Clustering keine Personen-Garantien. „Story" bleibt editorielle These.

---

## 8. Operatives Hauptrisiko

Erster Modell-Load (mehrere hundert MB) braucht sichtbaren Fortschritt + Caching — früh einplanen.

---

## 9. Architektur-Grundsatzentscheidungen (verbindlich, mit Begründung)

1. **Nur der Ingest läuft im Worker.** Alle ML-Stufen (MediaPipe, transformers.js) laufen auf dem Main-Thread. Begründung: Die Kombination Module-Worker + CDN-Import + WASM/WebGPU ist die fehleranfälligste Stelle des Stacks; WebGPU-Inferenz ist ohnehin asynchron und blockiert den Main-Thread kaum. Bewusster Tausch: minimal mehr UI-Jank gegen deutlich weniger Integrationsrisiko.
2. **State enthält nur Metadaten.** Keine Blobs, keine Embeddings, keine File-Objekte im Preact-State. Große Daten leben in IndexedDB bzw. modulglobalen Maps.
3. **Original-Dateien sind nur session-gültig.** `File`-Handles aus `webkitdirectory` überleben kein Reload. Resume stellt Thumbnails + Analyse aus IndexedDB wieder her; der Export von Originalen nach einem Reload verlangt erneute Ordnerwahl (Abgleich über Bild-ID). Das ist akzeptiert, kein Bug.
4. **Fehler sind per Bild, nie per Pipeline.** Jede Stufe fängt Einzelbild-Fehler, schreibt den Grund nach `photo.stageFails[stageKey]` und läuft weiter; das fachliche Ergebnisfeld bleibt `null`. BERECHNET heißt: Ergebnisfeld gesetzt ODER `stageFails[stageKey]` vorhanden. `photo.status` wird ausschließlich vom Ingest geschrieben — Stufen fassen es NIE an (ein Analysefehler darf ein Bild nicht aus der Pipeline werfen).
5. **Jede Stufe ist idempotent.** Bilder mit BERECHNET-Status werden übersprungen — Ergebnisfeld gesetzt ODER `stageFails[stageKey]` vorhanden → Resume ist trivial.
6. **Netzwerk ist die Ausnahme, nicht die Regel.** v1 verarbeitet vollständig lokal; kein Bild, keine Position, kein Text verlässt den Browser (CDN-Modell-Downloads ausgenommen). Die geplante Geo/POI-Anreicherung (§12) ist der einzige vorgesehene Netzwerkpfad und unterliegt drei verbindlichen Regeln: (a) explizites Opt-in, in der UI klar als Online-Schritt gekennzeichnet; (b) übertragen werden ausschließlich gerundete Orts-Cluster-Zentroiden — nie Einzelfoto-Koordinaten, nie Bilddaten, nie Captions; (c) nur Dienste, die CORS-fähig direkt aus dem statischen Deployment funktionieren (kein Backend, kein Proxy) und deren Nutzungsbedingungen lokales Caching erlauben — das schließt u. a. Google Places aus.

---

## 10. Architektur-Verträge (verbindlich für alle Etappen)

### 10.1 Dateistruktur (final — Etappen erzeugen exakt diese Dateien)

```
photobook/
  index.html
  css/main.css                    E1 ✓ (Design-Tokens; nur ergänzen, nie umbenennen)
  js/
    deps.js                       E1 ✓ (EINZIGE Stelle mit CDN-URLs; Versionen gepinnt)
    ctx.js                        E1 ✓ (AppContext + JSDoc-Typedefs = Single Source of Truth)
    app.js                        E1 ✓ (initialState, reducer, App, render)
    Nav.js                        E1 ✓
    db.js                         E2  (IndexedDB-Wrapper, einziger IDB-Zugriffspunkt)
    ingest.js                     E2  (Ingest-Orchestrierung Main-Thread; fileMap)
    workers/ingest.worker.js      E2  (Decode/Downscale/EXIF; einziger Worker)
    thumbs.js                     E3  (ObjectURL-Cache, lazy, revoke)
    pipeline/runner.js            E3  (Stufen-Runner: Reihenfolge, Pause/Resume, Fortschritt)
    pipeline/stages.js            E3  (STAGES-Registry; Stubs bis zur jeweiligen Etappe)
    pipeline/s1_technical.js      E4
    pipeline/s2_chapters.js       E4
    pipeline/s3_faces.js          E5
    pipeline/s3b_persons.js       R (Stub) → E11 (echte Logik)
    pipeline/s4_embeddings.js     E6
    pipeline/s5_vlm.js            E8
    pipeline/s5b_scenes.js        E13 (Szenenbildung; Etappe 1 Segmentierung)
    pipeline/s6_select.js         E9
    models.js                     E6  (Modell-Loader: Cache API, Fortschritt, unload)
    selectors.js                  E3  (abgeleitete Daten: Kapitelgruppen, Quoten, Diagnose)
    components/Grid.js            E3
    components/PickCard.js        E7
    components/ClusterOverlay.js  E7
    components/RejectedView.js    E7
    components/CoveragePanel.js   E10
    screens/*.js                  E1 ✓ (werden etappenweise mit Leben gefüllt)
```

### 10.2 Datenmodell: Photo-Record (Felder + schreibende Etappe)

```js
{
  id: string,                    // E2: SHA-1 aus `${name}|${size}|${lastModified}`
  name: string, size: number, lastModified: number,   // E2
  width: number, height: number, // E2 (nach Orientierung)
  takenAt: number|null,          // E2: EXIF DateTimeOriginal (epoch ms), Fallback lastModified
  gps: {lat:number, lon:number,
        alt:number|null, dir:number|null}|null,  // E2; alt/dir ab G0.5:
                                 //   alt = GPSAltitude (m), dir = GPSImgDirection (Grad; T/M-Ref
                                 //   bewusst nicht unterschieden — Deklination < GPS-Fehlerbudget).
                                 //   Bestände vor G0.5 haben die Felder nicht: undefined wie null lesen.
  exifOptics: {focalLength:number|null, focalLength35mm:number|null,    // G0.5 (Rohfelder, v2-Vorbereitung):
               digitalZoomRatio:number|null, lensModel:string|null,    //   ViewGeometry-Evidenz (FoV/Distanz) in v2.
               make:string|null, model:string|null,                    //   Nur konserviert, nicht interpretiert.
               fNumber:number|null, iso:number|null,                   //   v4.6: Kamera-Trias (roh) fürs Metadaten-Panel.
               exposureTime:number|null}|null,                         //   Re-Ingest für Altbestand nötig.
  exifTime: {dateTimeOriginalRaw:string|null, offsetTimeOriginal:string|null,  // G0.5 (Rohfelder):
             gpsDateStamp:string|null, gpsTimeStamp:string|null}|null,         //   SunEvidence-/Chronolocation-Basis in v2.
                                 //   inferredUtc/timeConfidence sind ABLEITUNGEN → v2, NICHT hier.
  status: 'ok'|'failed',         // E2+: Einzelbild-Fehler, Pipeline läuft weiter
  failReason: string|null,       // E2+: lesbarer Verarbeitungsfehler-Grund (nur bei status 'failed');
                                 //      semantisch getrennt von rejectReason (Selektion)
  stageFails: Object,            // R: Record<string,string> — stageKey → lesbarer Grund (Default {}).
                                 //    BERECHNET ⇔ Stufen-Feld gesetzt ODER stageFails[stageKey] vorhanden.
                                 //    Grenze: status 'failed' (nur Ingest!) = Bild grundsätzlich unverarbeitbar,
                                 //    spätere Stufen überspringen es. stageFails[key] = Bild ok, aber DIESE
                                 //    Analyse-Stufe ist für dieses Bild gescheitert. Stufen schreiben NIE status.
  tech: {sharpness:number, exposure:number}|null,     // E4 (0–1)
  chapterId: number|null,        // E4 (= Tag/Kalendertag, oberste Rhythmusebene)
  sceneId: string|null,          // E13 (Szene ⊂ Tag; stabil 'scene-<chapterId>-<index>' aus sortierter Reihenfolge)
  faces: {count:number, maxBoxRatio:number, blink:boolean, smile:number}|null, // E5
  stream: 'P'|'S'|'M'|null,      // E5
  clusterId: string|null,        // E6
  repr: boolean,                 // E6: Cluster-Repräsentant
  vlm: {shotType:string, activity:string, mood:string, place:string,
        momentScore:number, caption:string}|null,     // E8 (nur repr)
  personIds: string[],           // E11 (bis dahin [])
  beat: 'establishing'|'action'|'detail'|'hero'|'transition'|null,  // E9
  picked: boolean,               // E9 + Overrides
  reason: string|null,           // E9: lesbare Begründung
  rejectReason: 'duplicate'|'blurry'|'budget'|'redundant'|'stream'|null
  // 'budget' = hartes maxPickCap erreicht (select-v5); KEIN fester targetCount mehr (τ-Grenznutzen, §4/§15).
}
```
**Embeddings sind NIE Teil des Photo-Records** (zu groß) → eigene IDB-Stores.

### 10.3 IndexedDB-Schema

DB-Name `photobook`, `DB_VERSION` als Konstante in `db.js` (Erhöhung nur bei Schema-Änderung, mit Migration im `onupgradeneeded`).

| Store | keyPath | Inhalt |
|---|---|---|
| `photos` | `id` | Photo-Record (10.2) — ohne Blobs/Embeddings |
| `thumbs` | `id` | JPEG-Blob ~512 px |
| `embeddings` | `id` | Float32Array (CLIP) |
| `faceEmbeddings` | `id` | Array von Float32Arrays (E11) |
| `vlmRaw` | `id` | `{caption, odLabels, odBboxes, modelId, ts}` — Florence-2-Rohdaten (E8); teures Inferenz-Artefakt, bleibt bei vlm-Reset erhalten |
| `meta` | `key` | `folderSignature` (= `worksetSignature`, §10.3-Regel), `folderSignaturePending`, `worksetEpoch`, `worksetRevision` *(Phase A)*, `presets`, `selectParams` (select-v5-Snapshot), `pipelineState`, `chapters`, `scenes`, `overrides`, `persons`, `vlmTextEmb:*` (Zero-Shot-Kategorievektoren, E8.2; Schlüssel = modelId:revision:transformersVersion:textDtype:promptsVersion) |
| `geo` *(geplant — v2, §12)* | `key` | POI-/Geocoding-Cache; Schlüssel = `quelle:latGerundet,lonGerundet:radius:version`. Anlage erst mit DB_VERSION-Bump bei §12-Umsetzung; fällt dann unter die Kosten-Regel §10.4 (extern beschafftes, rate-limitiertes Artefakt — überlebt Stage-Resets analog `vlmRaw`) |

**Regel (Arbeitsmengen-Lifecycle — ab v7, ersetzt den Ordner-Lifecycle):** Die `folderSignature` (= **`worksetSignature`**) schützt eine **konsistente Arbeitsmengen-Version, nicht einen physischen Ordner**. Die Arbeitsmenge ist der `photos`-Store selbst (vorhandene Records = inkludiert); sie ist **additiv kuratierbar** (Ordner **und** Einzeldateien hinzufügen, Fotos vor der Verarbeitung entfernen). *Mechanik (Kuratierung Phase A, beauftragbar, noch nicht realisiert — siehe KONZEPT-Kuratierung-Phase-A-v6.7):* atomare Mutation als einzige Mitgliedschafts-/Signaturgrenze (`applyWorksetMutation`), CAS via `worksetEpoch`/`worksetRevision`, `putPhotos` update-only, `hydrateWorkset()` mit Status-Mapping + Sperre (CURATING/LOCKED) + Recovery, expliziter Reset-Scope (löscht Folder-Meta + `selectParams`, erhält `presets`/Theme/`vlmTextEmb:*`), **verlustfreie Legacy-Migration** bestehender v6/E13.3-Bestände (Epoch/Revision nachtragen, Signatur bleibt). *Bis Phase A realisiert ist, gilt operativ weiter der ZIP-Stand (replace-basierter Ingest); diese Regel ist der adoptierte Zielvertrag.*

**Pending-Marker — zeitlich abgegrenzt:**
- *BIS ZUR REALISIERUNG VON PHASE A (Übergangsrealität):* Der Replace-Ingest bleibt gültig — `folderSignature` ist das Commit-Signal eines VOLLSTÄNDIG geschriebenen Bestands: `clearFolderData()` → `markFolderIngestPending(signature)` → Ingest → bei Erfolg `commitFolderSignature(signature)` (löscht den Pending-Marker atomar). Resume nur, wenn die Signatur passt UND kein `folderSignaturePending` existiert — ein abgebrochener Ingest hinterlässt nie einen als gültig lesbaren Bestand.
- *AB PHASE A (Zielvertrag):* `folderSignaturePending` wird **nicht** mehr als globaler Add-/Remove-Marker verwendet; `clearFolderData()` läuft beim normalen Hinzufügen **nicht**. `applyWorksetMutation()` schreibt bzw. löscht **pro Operation** Records/Artefakte, `folderSignature` und `worksetRevision` atomar. Ein vorhandener Legacy-`folderSignaturePending` führt beim `hydrateWorkset()` in **Recovery**.

**Regel (Persistenzfehler):** Scheitert `putPhotos`/`putThumb`/`putMeta`, ist das nie nur ein Log-Eintrag. In einer Pipeline-Stufe → Stage-State `error`. Im Ingest (der formal KEINE Pipeline-Stufe ist) → eigener Ingest-Fehlerzustand, kein Übergang zum Presets-Screen; Ingest-Fehler erscheinen nie in `pipelineState.stages`. Eine Stufe darf nie als `done` persistiert werden, wenn ihre Outputs nicht nachweislich geschrieben sind — die App behandelt IndexedDB als Wahrheit, also muss IndexedDB wahr sein.

**Regel:** Screens und Komponenten greifen NIE direkt auf IndexedDB zu — ausschließlich über `db.js`-Funktionen (`putPhotos`, `getAllPhotos`, `putThumb`, `getThumb`, `putMeta`, `getMeta`, …). Stufen persistieren batchweise (alle ~25 Bilder), nicht pro Bild.

### 10.4 Pipeline-Kontrakt

```js
// pipeline/stages.js — die Registry ist die EINZIGE Wahrheit über Stufen-Metadaten
export const STAGES = [
  { key:'technical',  num:1, label:'Technik-Analyse',   implVersion:'technical-v1',
    run: runTechnical,  validate: validateTechnical,  reset: resetTechnical,
    isStub:false, invalidates:['embeddings','vlm','scenes','select'] },  // Repräsentanten-Wahl nutzt tech-Score;
                                                                 // faces bewusst NICHT (Score beeinflusst Gesichtserkennung nicht)
  { key:'chapters',   num:2, label:'Kapitel (Tag)',     implVersion:'chapters-v3',
    run: runChapters,   validate: validateChapters,   reset: resetChapters,
    isStub:false, invalidates:['scenes','select'] },  // Tag-Grenzen ändern → sceneId stale
  { key:'faces',      num:3, label:'Gesichter (P/S/M)', implVersion:'faces-v1',
    run: runFaces,      validate: validateFaces,       reset: resetFaces,
    isStub:false, invalidates:['persons','embeddings','vlm','scenes','select'] },
  // … persons (3b, Stub bis E11, invalidates:['select']),
  // … embeddings (invalidates:['vlm','scenes','select']), vlm (['scenes','select']),
  // … scenes (E13, implVersion:'scenes-v1', validateScenes, resetScenes, isStub:false, invalidates:['select']),
  // … select ([])
];
// invalidates-Listen sind EXPLIZIT UND VOLLSTÄNDIG — der Runner kennt keine
// transitive Auflösung. Wer eine Abhängigkeit ergänzt, schreibt die ganze Kette.
```

**Rückgabe-/Fehlervertrag von `run`:** `run` gibt `{status:'done'|'skipped'}` zurück. Einzelbild-Fehler → `stageFails[key]`, KEIN throw. Stufen-Fehler (Modell lädt nicht, Persistenz scheitert) → `throw new StageError(message)`; der Runner fängt das und persistiert `status:'error'`. Stubs: `isStub:true`, `validate: () => false`, geben `{status:'skipped'}` zurück.

**Downstream-Invalidierung:** Führt der Runner eine Stufe (neu) aus und sie meldet `done`, setzt er alle Stufen aus deren `invalidates`-Liste auf `pending` und ruft deren `reset(photos, db, context)` auf (Cleanup-Tabelle §10.8; `context` optional: `{reason, changedPhotoIds}` — ohne Kontext muss der Reset konservativ, aber korrekt sein). **Kosten-Regel:** Invalidierung setzt ausschließlich *Ableitungen* zurück — pixel-basierte Inferenz-Artefakte (IDB-Embeddings, VLM-Roh-Captions in `vlmRaw`) und modell-/prompt-gebundene Text-Embedding-Assets (Zero-Shot-Kategorievektoren im meta-Store, invalidiert nur über Schlüssel-Mismatch, Neuerzeugung in Sekunden) bleiben gültig, solange das Foto bzw. das Setup unverändert ist. Re-Runs invalidierter Stufen sind dadurch billiges Re-Clustering/Re-Ableiten (Sekunden), nie Re-Inferenz (Stunden). Konkret: `technical` ändert sich → `embeddings` läuft neu, überspringt per Foto-Idempotenz alle vorhandenen IDB-Embeddings und wiederholt nur die Cluster-/Repräsentanten-Wahl. `embeddings` ändert sich (neuer Checkpoint) → `vlm` läuft neu, aber nur als Re-Ableitung (Zero-Shot gegen die vorhandenen Embeddings); Florence-Captions in `vlmRaw` bleiben unangetastet.

**Rhythmus-Regel:** Persistierte Rhythmusstrukturen außerhalb `meta.chapters` (Tag) und `meta.scenes` (Szene) sind verboten. Alle rhythmusabhängigen Ableitungen (Review-Gruppen Tag→Szene→Items, Beat-Abdeckung, Quoten) entstehen frisch in `selectors.js` — eine Tag- oder Szenen-Neubildung invalidiert damit automatisch alles Abhängige (Invalidierungsketten §10.4), ohne dass der Runner UI-Konzepte kennen muss.

Jede Stufe implementiert exakt:
```js
async function runX({ photos, db, dispatch, signal, onProgress }) 
// - idempotent: überspringt Photos mit BERECHNET-Status (Feld gesetzt ODER stageFails[key])
// - onProgress(done, total) regelmäßig aufrufen
// - signal (AbortSignal) zwischen Bildern prüfen → Pause
// - Einzelbild-Fehler fangen: Ergebnisfeld null lassen, Grund nach stageFails[key], weiter
// - Stufen-Fehler (Modell/Persistenz): throw new StageError(...)
// - Rückgabe: {status:'done'|'skipped'}
// - Ergebnis in photos-Array mutieren + batchweise via db persistieren
// - ML-Stufen: Modell am Anfang laden (models.js), am Ende entladen
```
`runner.js` iteriert STAGES, dispatcht `PIPELINE_STAGE` und persistiert nach jeder Stufe den **Per-Stage-Zustand**:

```js
pipelineState = {
  folderSignature,
  pipelineVersion: 1,            // Legacy-Zustände ohne Version werden ignoriert
  stages: {
    technical: { status:'done',    implVersion:'technical-v1', error:null },
    chapters:  { status:'done',    implVersion:'chapters-v1',  error:null },
    faces:     { status:'skipped', implVersion:'stub',         error:null },
    // status: 'pending' | 'active' | 'done' | 'skipped' | 'error'
  }
}
```

**Verbindliche Semantik:**
- **Stubs sind nie `done`.** Eine Stufe ohne echte Implementierung gibt `{status:'skipped'}` zurück; der Runner persistiert `skipped`, die UI zeigt es als „noch nicht implementiert".
- **`done` erfordert Validierung.** Jede Stufe liefert einen billigen Validator (`validateX(photos, meta) → boolean`, reine Feld-Checks in O(n), keine Neuberechnung). Der Runner entscheidet beim Start NICHT nach gespeichertem Status allein, sondern nach `status==='done' && implVersion === aktuelle && validate() === true` — sonst wird die Stufe (erneut) ausgeführt. Damit aktivieren neue Implementierungen sich selbst gegen alte `skipped`/Vorversions-Zustände.
- **Beispiel-Validatoren:** `technical`: alle `status:'ok'`-Photos haben `tech !== null` ODER `stageFails.technical`; `chapters`: alle ok-Photos haben `chapterId !== null` UND `meta.chapters` existiert oder ist aus den Records rekonstruierbar (dann rekonstruieren + persistieren).
- **Fehlerebenen getrennt:** Einzelbild-Fehler → `stageFails[key]` am Photo, Stufe läuft weiter. Stufen-Fehler (Modell lädt nicht, Persistenz scheitert) → `status:'error'` + Retry-Button. Die Pipeline bricht nie wegen eines Einzelbildes ab.

### 10.5 State-Regeln (ergänzt Reducer aus E1)

- `state.photos`: Photo-Records gemäß 10.2 — niemals Blobs/Files/Embeddings.
- File-Handles: modulglobale `Map<id, File>` in `ingest.js` — nicht im State, session-gültig.
- Thumbnails: `thumbs.js` verwaltet ObjectURLs (erstellen lazy via IntersectionObserver, revoke bei Verlassen).
- Bestehende Action-Types aus E1 (`SET_SCREEN`, `SET_PRESETS`, `SET_PHOTOS`, `PIPELINE_*`, `SET_SELECTION`, `SET_REJECTED`, `ADD_OVERRIDE`) bleiben stabil. Neue Actions: `UPDATE_PHOTOS` (Teilmengen-Merge per id), `SET_CHAPTERS`, `SET_SCENES` (Szenen analog Kapitel: schreibt `sceneId` in Photos + `meta.scenes`; Szenen-Gruppen werden in `selectors.js` frisch abgeleitet, nie im State dupliziert), `SET_PERSONS` — weitere nur per Konzept-Update. *(Phase A ergänzt `HYDRATE_WORKSET` als atomaren Bootstrap-Payload + `ADD_PHOTOS`/`REMOVE_PHOTOS` + einen `hydrating`-Zustand; persistierter Pipeline-State wird beim Hydrate auf `done|paused|error|idle` gemappt, `raw active → pending` — siehe Phase-A-Konzept.)*
- Abgeleitete Daten (Kapitelgruppen, Quoten, Diagnose) werden NIE im State dupliziert → `selectors.js` + `useMemo`.

### 10.6 Modell-Loader-Kontrakt (`models.js`, ab E6)

```js
await loadModel(key, loaderFn, onProgress)  // lädt einmal, cached via Cache API
await unloadModel(key)                       // gibt Referenzen frei (GC + dispose)
hasWebGPU()                                  // einmalige Detection, gecacht
```
Es ist nie mehr als ein ML-Modell gleichzeitig geladen.

### 10.7 Konventionen

- Code Englisch, UI-Texte Deutsch. JSDoc-Typedefs in `ctx.js` sind die Wahrheit — neue Typen dort ergänzen. Typedef-Ergänzungen in `ctx.js` sind in jeder Etappe zulässig, auch ohne Listung unter ÄNDERN.
- htm-Pattern wie E1: `const html = _htm.bind(h);` pro Modul. Alle Imports über `deps.js`; neue CDN-Abhängigkeiten NUR dort, Versionen gepinnt.
- **Worker importieren NIE `deps.js`** (zöge UI-Libs in den Worker — §9.1). Benötigte CDN-URLs werden als Konstanten in `deps.js` gepinnt und dem Worker per init-Message übergeben. `deps.js` bleibt damit die einzige Pin-Quelle.
- **CLIP-Checkpoint (Single Source of Truth, E8.2):** `CLIP_MODEL_ID` + `CLIP_MODEL_REVISION` (Commit-Hash, nicht `main`) als exportierte Konstante — E6 (Bild-Embeddings) und E8.2 (Text-Tower für Zero-Shot) nutzen dieselbe Quelle. Revision auf den Stand pinnen, mit dem die vorhandenen Embeddings erzeugt wurden; ein Checkpoint-Wechsel invalidiert Embeddings/Cluster und ist nie eigenmächtig vorzunehmen. Florence-2-Pin (`FLORENCE_MODEL_ID`/`_REVISION`) analog.
- Design-Tokens aus `main.css` verwenden; keine neuen hartkodierten Farben.
- Keine Frameworks/Bundler/Build-Steps. Kein TypeScript.

### 10.8 Stage-Reset / Cleanup (was `reset(photos, db)` je Stufe löscht)

| Stufe | Reset löscht | Bleibt erhalten |
|---|---|---|
| `technical` | `tech=null`, `delete photo.stageFails.technical` | — |
| `chapters` | `chapterId=null`, `meta.chapters`, `delete photo.stageFails.chapters` | — (Szenen werden über die `scenes`-Invalidierung separat zurückgesetzt, §10.4) |
| `faces` | `faces=null`, `stream=null`, `stageFails.faces` | — |
| `scenes` | `sceneId=null`, `meta.scenes`, `delete photo.stageFails.scenes` | `vlmRaw`, IDB-Embeddings, VLM-Ableitungen (`vlm.place/activity` etc.) — Szenen sind reine Re-Ableitung in Sekunden |
| `embeddings` | `clusterId=null`, `repr=false`, `rejectReason==='duplicate'`→null, `stageFails.embeddings` | **IDB-Store `embeddings`** (pixel-basiert, nie stale) |
| `vlm` | konservativ immer alle `vlm=null`, `delete photo.stageFails.vlm` (E8 D3; kein `changedPhotoIds`-Pfad) | **IDB-Store `vlmRaw`** (Florence-Captions/OD, pixel-basiert) **und** Text-Embedding-Assets im meta-Store (Re-Run ist reine Re-Ableitung) |
| `select` | `picked`, `beat`, `reason`, selektionsbezogene `rejectReason` ('budget'/'redundant'/'stream') | **Override-Log**; include/exclude-Overrides werden nach Re-Selektion erneut angewandt (sofern Foto noch Repräsentant), reorder-Overrides verfallen |

Jedes Stufen-Modul exportiert sein `reset(photos, db, context?)` neben `run`/`validate` — die Registry verdrahtet alles; kein Ad-hoc-Löschen außerhalb dieser Tabelle.

**stageFails-Regel:** Resets löschen ausschließlich den eigenen Key (`delete photo.stageFails[key]`) — das Objekt wird NIE als Ganzes überschrieben, sonst gehen die Fehler anderer Stufen verloren.

**Deterministische Re-Selektions-Reihenfolge:** (1) Solver rechnet frisch. (2) include/exclude-Overrides anwenden (sofern Foto noch Repräsentant). (3) **Include-Overrides haben Vorrang vor dem (optionalen) `maxPickCap`** — automatisches Trimmen entfernt nie manuell inkludierte Bilder; eine Überschreitung der Obergrenze wird im Zähler sichtbar gemacht („240 — 3 manuell"), nicht still aufgelöst. *(Den Umfang bestimmt sonst der τ-Grenznutzen, nicht ein festes Budget.)* (4) Begründungen aktualisieren. (5) Override-Quote neu berechnen.

**Override-Minimalität:** Ein Foto trägt höchstens **ein** include/exclude-Override. Stimmt eine Nutzeraktion (Ablehnen/Zurückholen) mit dem **Solver-Ursprung** (`photo.picked`) überein, wird **kein** Override gespeichert bzw. ein bestehendes entfernt → der Status kehrt zum Ursprung zurück (z. B. automatisch aussortiert, nicht „manuell"). `swap`/`reorder` bleiben davon unberührt. Verhindert Override-Akkumulation und falsche „manuell"-Markierungen.

---

## 11. Historische Umsetzungsaufträge und aktuelle Roadmap

### Nächste Etappe: Kuratierung Phase A — A-Core

**Status:** A-Core geschlossen; **beauftragbar — finaler Review gegen die Zustands-Übergangstabelle (Phase-A-v6.7 §4.10) abgeschlossen** (11 Audit-Runden; zuletzt F1 — Fehlersemantik nach bestätigtem Lock präzisiert, §4.10 E1 korrigiert + B1a ergänzt, Tabelle widerspruchsfrei). **Basis:** KONZEPT-v7 (diese Datei) + KONZEPT-Kuratierung-Phase-A-v6.7 + aktuelles ZIP (Review-Controls-v3-Stand). **Modell:** Opus (determinismus-/state-kritisch). **Inhalt:** Working-Set-Lebenszyklus — atomare Mutation + CAS (`worksetEpoch`/`worksetRevision`), Epoch-Herkunft + Guard vor jedem Seiteneffekt, `HYDRATE_WORKSET`/`hadStarted`-Ordering, CURATING/LOCKED + Reset nach Live-Runner, `putPhotos` update-only, verlustfreie Legacy-Migration, §4.9-Lebenszyklusregeln, §4.10-Zustandsmatrix. Danach **A-UI** (Sonnet). Vollständiger Vertrag + DoD + Handover in Phase-A-v6.7.

> **Hinweis (v5):** Die historischen Etappen-Prompts unten (Etappen 2–12) sind **eingefrorene Snapshots** ihres jeweiligen Stands. Wo sie `invalidates`-Listen nennen, sind diese **nicht** maßgeblich — verbindlich ist allein die Registry in **§10.4** (inkl. der `scenes`-Nachführung). Bei künftigen Etappen gilt: wer eine Abhängigkeit ergänzt, schreibt die ganze Kette in §10.4.

### Historische Etappe E13.1 — abgenommen, NICHT ausführen — Zwei-Ebenen-Segmentierung, Etappe 1 (Segmentierung + Anzeige)

> Dieser Block ist ein **eingefrorener Umsetzungsauftrag aus v5**. Er dokumentiert den damaligen Schnitt, ist **abgenommen und nicht mehr beauftragbar**. Nicht als Auftragsschablone verwenden — aktueller Auftrag siehe „Nächste Etappe: Kuratierung Phase A" oben.

**Ziel:** `chapterId` = Tag (zeitbasiert, neu definiert); neue Stufe `scenes` (inhaltsbasiert, nach `vlm`); Anzeige Tag→Szene→Items. Solver bleibt tagbasiert → Struktur-/Review-Fix, **nicht** der vollständige Auswahl-Fix (§15).

**NEU/ÄNDERN:**
- `js/pipeline/s2_chapters.js` (Tag, zeitbasiert): Kalendertag-Basis; Split mitten am Tag bei GPS-Sprung >`GPS_JUMP_KM` ODER Zeitlücke >`DAY_SPLIT_GAP`; Merge Tag mit <`MIN_DAY_PHOTOS` und Spanne <`MIN_DAY_SPAN` in zeitlich näheren Nachbarn (Tie-Break: früherer); Mitternacht-Artefakt vermeiden (kein Split nur wegen Datumswechsel ohne Min-Gap). implVersion→`chapters-v3` (v1/v2-Altzustände werden invalidiert). Schwellen als Konstanten in `meta.chapters`-Snapshot.
- `js/pipeline/s5b_scenes.js` (NEU, nach `vlm`): Szenen auf der **Repräsentanten-Sequenz** (nur Reps tragen `vlm.place/activity`); Grenze bei nachhaltigem place/activity-Wechsel (Glättung `SCENE_MIN_RUN`), GPS-Korroboration; **Tagesgrenze hart**. Nicht-Reps erben Szene via `clusterId`; untagged Rep via zeitnächste Szene **innerhalb des Tags**. Mindestszene mergen. Setzt `photo.sceneId` (`'scene-<chapterId>-<index>'`), schreibt `meta.scenes`. Determinismus + Tie-Breaks fixiert, in `meta.scenes`-Snapshot.
- `js/pipeline/stages.js`: `scenes`-Registry-Eintrag (`implVersion:'scenes-v1'`, validateScenes, resetScenes, isStub:false, invalidates:`['select']`); Invalidierungsketten gemäß §10.4 (chapters/technical/faces/embeddings/vlm ziehen `scenes` mit).
- `js/app.js`: `SET_SCENES`-Action (§10.5).
- `js/screens/ReviewScreen.js` + `js/selectors.js`: Arbeitssicht Tag→Szene→Items (Szenen als Zwischenblöcke, §5); Gruppierung additiv um Szenen-Ebene; Dichte-Regler auf Tag-Ebene.

**NICHT ANFASSEN:** Solver-Scoring/-Phasen (`s6_select.js` bleibt tagbasiert), Override-Reihenfolge in selectors, `db.js`-API-Form, Inferenz-Stufen, single-model-Regel.

**DoD:** Segmentierungs-Gate §6 (gleiche Fotos → identische chapterId/sceneId; Szene strikt im Tag; keine Cross-Day-Szene; Reload-identisch; alte chapters-v1/v2 invalidiert); Anzeige Tag→Szene→Items chronologisch; konservativer scenes-Reset (vlm/embeddings überleben); `node --check` grün.

**Modell:** Sonnet/hoch, Eskalation auf Opus bei Determinismus-/Pipeline-Problemen. **Output:** vollständiges deploybares ZIP.

*(Etappe 2 — Solver auf Szenen — folgt separat nach Abnahme von E13.1; Opus, §15.)*

**Vorgehen je Etappe:** Neues Chat-Fenster. Anhängen: **dieses KONZEPT.md** + **ZIP des aktuellen Stands**. Prompt einfügen. Ergebnis: deploybares ZIP, das per Netlify Drop testbar ist.

**Definition of Done — gilt zusätzlich für JEDE Pipeline-Etappe ab Etappe R** (die NEU/ÄNDERN-Listen bleiben als Orientierung, die Abnahme erfolgt gegen diese Liste):
1. Die Stufe hat eine `implVersion` und einen Validator (§10.4); alte `skipped`/Stub-/Vorversions-Zustände werden dadurch automatisch invalidiert.
2. Pro-Bild-Fehler landen in `stageFails[key]` (§10.2); kein Einzelbild bricht die Stufe.
3. Persistenzfehler setzen die Stufe auf `error` (§10.3); nie `done` ohne geschriebene Outputs.
4. Idempotenz: BERECHNET ⇔ Feld gesetzt ODER `stageFails[key]` vorhanden.
5. Nach Reload ist der Zustand identisch interpretierbar (Lifecycle-Tests unten bestehen).
6. Registry-Eintrag vollständig (`implVersion`, `validate`, `reset`, `isStub:false`, `invalidates`); Downstream-Invalidierung gemäß §10.8 funktioniert.

**Lifecycle-Abnahmetests:**

*Historisch bis einschließlich v6 (Replace-Modell — Test B gilt NICHT mehr ab Phase A):* A. Ordner A → Lauf → Reload → Zustand identisch. B. Ordner B laden → keine Spur von A (DB inspizieren). C. Stub-Stufen zeigen `skipped`, nie `done`. D. Lauf mit altem pipelineState aus Vor-Etappe → neue Stufe führt sich selbst aus statt übersprungen zu werden. E. Simulierter Persistenzfehler (DevTools-Breakpoint oder temporärer Fehlerwurf in putPhotos/putMeta) → Stufe wird `error`, nie `done`. *(C/D/E bleiben sachlich gültig; B ist durch die additive Arbeitsmengen-Semantik ersetzt.)*

*Ab v7 / Phase A (Arbeitsmengen-Semantik — beim A-Core-Abnahme im Browser durchspielen):*
A. Leere Arbeitsmenge → Ordner A hinzufügen → Reload: gleiche Fotos, gleiche `worksetSignature`, CURATING.
B. Ordner B vor Pipeline-Start hinzufügen: Arbeitsmenge = A ∪ B; vorhandene A-Records/Thumbs unverändert; nur neue IDs aus B werden dekodiert.
C. Foto entfernen → Reload: Photo-Record, Thumb, Embedding, Face-Embedding und vlmRaw fehlen; `fileMap`-Eintrag und ObjectURL entfernt.
D. Pipeline anfordern/starten: Arbeitsmenge wird bereits **vor** erster persistierter Stage lokal gesperrt (§4.9).
E. Arbeitsmenge nach paused/done/error zurücksetzen: neue Epoch, Revision 0, Leer-Signatur; CURATING.
F. Reset während live-running: blockiert.
G. Konsistenter v6/E13.3-Bestand: Epoch/Revision verlustfrei ergänzt; Pipeline und Auswahl bleiben resumierbar.
H. Pending oder Signatur-Mismatch: Recovery; nur Reset/Clear verfügbar.

| Etappe | Modell | Denktiefe | Risikotyp |
|---|---|---|---|
| 2 Ingest | Sonnet | **hoch** | Integration: libheif-WASM im Worker — riskanteste Stelle des Projekts |
| 3 Grid + Runner + Processing | Sonnet | mittel | Vertrag §10.4 liegt vor |
| 4 Technik + Kapitel | Sonnet | mittel | dokumentierte Algorithmen |
| **R Rebaseline** (nach 4) | **Opus** | **hoch** | Zustandssemantik im Kern — teuerste Fehlerklasse |
| 5 MediaPipe P/S/M | Sonnet | mittel | ✅ abgenommen |
| 6 CLIP + Dedup | Sonnet | **hoch** | ✅ abgenommen |
| 7 Review-UI | Sonnet | mittel | ✅ abgenommen |
| 8 Florence-2 VLM (Inferenzarchitektur) | Opus | **hoch** | ✅ code-reviewed (Captions/OD/vlmRaw stehen) |
| 8.2 Zero-Shot-Ableitung | Opus | **hoch** | ✅ abgenommen |
| 8.5 Pipeline-Reset-Fix | Sonnet | niedrig | ✅ abgenommen |
| G0.5 EXIF-Geo/Optik/Zeit | Sonnet | niedrig | ✅ abgenommen |
| G1 Kapitel-Härtung | Sonnet | niedrig | ✅ abgenommen |
| 9 Constraint-Solver | Fable | **hoch** | ✅ abgenommen (Solver + Aussortiert-Reaktivierung) |
| 10 Coverage + Overrides | Sonnet | mittel | ✅ abgenommen |
| **11 Face-Clustering** *(zurückgestellt — nach Segmentierung, §15)* | Sonnet | **hoch** | EdgeFace-XS (CC-BY-NC-SA, privat ok) via onnxruntime-web; Alignment = Hauptrisiko; Backend-Broker-Light integrieren |
| 12 Presets + Export | Sonnet | mittel | ✅ abgenommen (v1-Kernpipeline komplett) |

Bewusst nirgends „max"/„extra" als Default: Die Design-Entscheidungen sind per Vertrag (§10) geschlossen; Quota fließt besser in einen sauberen zweiten Anlauf als in Über-Reasoning beim ersten.

---

### Etappe 2 — Ingest
**Modell:** Sonnet · **Denktiefe:** hoch

```
Browser-lokales Foto-Kuratierungs-Tool. KONZEPT.md (verbindlich: §9 Grundsätze, §10 Verträge) + aktueller Stand als ZIP beigefügt.

Bitte Etappe 2 umsetzen: Ingest.

NEU: js/db.js, js/ingest.js, js/workers/ingest.worker.js
ÄNDERN: js/screens/StartScreen.js (Mock-handleFiles durch echten Ingest ersetzen), js/ctx.js (Photo-Typedef gemäß §10.2 ergänzen), js/app.js (Action UPDATE_PHOTOS gemäß §10.5)
NICHT ANFASSEN: deps.js-Bestand, Nav.js, css/main.css-Tokens, übrige Screens

Inhalt:
- db.js: IndexedDB-Wrapper exakt nach §10.3 (Stores photos/thumbs/embeddings/faceEmbeddings/meta; alle Stores jetzt anlegen, auch wenn erst später befüllt)
- ingest.worker.js: createImageBitmap mit resizeWidth (~512px kürzere Seite), EXIF-Parse via exifr (in deps.js pinnen — KEINE Eigenimplementierung), JPEG-Blob als Thumb, Transferables nutzen
- HEIC — Fallback-Leiter (in dieser Reihenfolge, jede Ebene funktionsfähig abschließen bevor die nächste versucht wird):
  1. libheif-WASM (Version in deps.js pinnen) im Worker
  2. Falls Worker-Import scheitert: HEIC-Decode auf dem Main-Thread (gleiche Library), restlicher Ingest bleibt im Worker
  3. Falls beides scheitert: HEIC-Dateien als status 'failed' mit Grund "HEIC nicht dekodierbar" — App und Pipeline laufen mit den übrigen Formaten normal weiter
  Die Leiter ist Teil der Abnahme dieser Etappe: Ebene 3 muss nachweislich greifen (Test mit defekter Datei).
- ingest.js: Dateien sequentiell durch Worker schleusen, Photo-Records gemäß §10.2 bauen (id = SHA-1 aus name|size|lastModified via crypto.subtle), fileMap führen, batchweise nach IDB, Fortschritt dispatchen
- Resumability: beim Ordner-Öffnen folderSignature (Hash über sortierte IDs) gegen meta abgleichen; bei Match Photos+Thumbs aus IDB laden statt neu zu dekodieren
- StartScreen: Fortschrittsanzeige während Ingest, danach Weiter zu Presets

Output: deploybares ZIP des Gesamtstands.
```

---

### Etappe 3 — Grid, Runner-Skelett, Processing-Screen
**Modell:** Sonnet · **Denktiefe:** mittel

```
Browser-lokales Foto-Kuratierungs-Tool. KONZEPT.md (verbindlich: §9, §10) + aktueller Stand als ZIP beigefügt.

Bitte Etappe 3 umsetzen: Thumbnail-Grid, Pipeline-Runner-Skelett, Processing-Screen.

NEU: js/thumbs.js, js/selectors.js, js/components/Grid.js, js/pipeline/runner.js, js/pipeline/stages.js (Registry gemäß §10.4 — alle Pipeline-Stufen gemäß STAGES-Registry (technical, chapters, faces, persons, embeddings, vlm, select) als Stubs, die nur onProgress durchlaufen und ihr Feld mit Platzhalter belegen NICHT: Stubs dürfen keine Dummy-Analysewerte schreiben, sondern lassen Felder null und melden sich nur als 'übersprungen')
ÄNDERN: StartScreen (Grid + Eingangsdiagnose), ProcessingScreen (echte Stufenliste statt Stub), app.js (SET_CHAPTERS-Action)
NICHT ANFASSEN: db.js-API, ingest.js, Worker, Tokens

Inhalt:
- thumbs.js: ObjectURL-Cache mit IntersectionObserver-Anbindung (URL erst beim Sichtbarwerden aus IDB-Blob erzeugen, revoke beim Entfernen)
- Grid.js: virtuell-sparsames Thumbnail-Grid (Lazy-Loading), wiederverwendbar (StartScreen jetzt, ReviewScreen später)
- selectors.js: Diagnose (Anzahl, HEIC-%, GPS-%, Zeitstempel-%), WebGPU-Detection, Laufzeitschätzung (Anzahl × Konstante GPU/CPU, lesbarer Text)
- runner.js: STAGES sequentiell, AbortController für Pause/Resume, PIPELINE_*-Dispatches, pipelineState nach jeder Stufe in meta persistieren, Resume ab letzter unfertiger Stufe
- ProcessingScreen: Stufenliste (ausstehend/aktiv/fertig), Fortschrittsbalken, Restzeit, Pause/Resume-Button, Wake Lock + Hinweis "Tab offen lassen"

Output: deploybares ZIP des Gesamtstands.
```

---

### Etappe 4 — Technik-Scoring + Kapitel
**Modell:** Sonnet · **Denktiefe:** mittel
*Hinweis: historisch bereits VOR der Rebaseline umgesetzt — die alte Idempotenz-Formulierung im Prompt (`tech!==null`) wird durch Etappe R auf den BERECHNET-Vertrag nachgezogen.*

```
Browser-lokales Foto-Kuratierungs-Tool. KONZEPT.md (verbindlich: §9, §10) + aktueller Stand als ZIP beigefügt.

Bitte Etappe 4 umsetzen: Stufen 1+2 implementieren.

NEU: js/pipeline/s1_technical.js, js/pipeline/s2_chapters.js (Stubs in stages.js durch echte Implementierung ersetzen)
ÄNDERN: stages.js (Imports), Grid.js (Badges), selectors.js (Kapitelgruppierung)
NICHT ANFASSEN: runner.js-Kontrakt, db.js-API

Inhalt:
- s1_technical: Thumb aus IDB → Canvas. Schärfe: Laplacian-Varianz auf Zentrum-Crop (~40% der Fläche), normalisiert 0–1 (NICHT global — bewahrt Bokeh). Belichtung: Histogramm, Anteil Pixel >250 und <5 → Clipping-Score 0–1. Beide in photo.tech, batchweise persistieren. Idempotent: tech!==null überspringen.
- s2_chapters: takenAt-Lücken aller Photos (sortiert), adaptive Schwelle (z. B. Lücke > max(3×Median, 90. Perzentil)) → Kapitelgrenzen; GPS-Sprünge (>5 km) als Zusatzsignal. chapterId pro Photo; Kapitelliste {id, start, end, count} via SET_CHAPTERS + meta.
- Grid: Kapitel-Header (Datum/Zeitspanne), Badges Schärfe/Belichtung (Token-Farben), Kapitel live auf ProcessingScreen
- Klein, aus E3-Abnahme: Retry-Button im ProcessingScreen bei status 'error' (Auto-Start bleibt auf 'idle' beschränkt) — ab echten Stufen relevant

Output: deploybares ZIP des Gesamtstands.
```

---

### Etappe R — Rebaseline: Pipeline, Persistenz, Validierung
**Modell:** Opus · **Denktiefe:** hoch
*(Einschub nach Etappe 4, vor Etappe 5 — KEINE neuen Features)*

```
Browser-lokales Foto-Kuratierungs-Tool. KONZEPT.md (verbindlich: §9, §10 — insb. die
NEUEN Verträge in §10.2 stageFails, §10.3 Ordner-Lifecycle/Persistenzfehler, §10.4
Per-Stage-State) + aktueller Stand nach Etappe 4 als ZIP beigefügt.

Bitte KEINE neue Feature-Etappe. Ziel ist die Rebaseline des Fundaments — die
Pipeline-/Persistenz-/Resume-Semantik gegen die neuen Verträge führen.

ÄNDERN: db.js, ingest.js, pipeline/runner.js, pipeline/stages.js, s1_technical.js,
s2_chapters.js, ProcessingScreen.js, selectors.js, app.js, ctx.js
NICHT ANFASSEN: Worker-Decode-Logik, thumbs.js, Grid.js, übrige Screens, Tokens

1. Pipeline-State auf Per-Stage-Modell umstellen (§10.4): status pending/active/
   done/skipped/error, implVersion, error; pipelineVersion:1; Legacy-Zustände ohne
   Version ignorieren. STAGES-Registry um implVersion/validate/reset/isStub/
   invalidates erweitern (Registry = einzige Wahrheit). Rückgabevertrag: run gibt
   {status:'done'|'skipped'} zurück; Stufen-Fehler werfen StageError, Runner fängt
   und persistiert 'error'. Stubs: isStub:true, validate ()=>false, skipped.
   Die Stufe persons (3b) wird JETZT als Stub in die Registry aufgenommen
   (s3b_persons.js mit Stub-run + No-op-reset; echte Logik erst E11).
2. Validatoren einführen (§10.4): validateTechnical, validateChapters (inkl.
   Kapitel-Rekonstruktion aus chapterId, falls meta.chapters fehlt — danach
   persistieren). Runner-Startentscheidung: done && implVersion aktuell &&
   Validator true — sonst Stufe ausführen.
3. stageFails einführen (§10.2): ctx.js-Typedef, Default {}; s1_technical schreibt
   Analysefehler nach stageFails.technical statt tech null zu lassen; Idempotenz-
   Checks beider Stufen auf die neue Regel umstellen.
4. Ordnerwechsel (§10.3): bei abweichender folderSignature ALLE ordnerbezogenen
   Stores + Meta löschen (db.clearFolderData() ergänzen), fileMap.clear(),
   SET_PHOTOS [] / SET_CHAPTERS [], dann frischer Ingest.
5. ingest.js Catch-Bug: der Fehlerpfad liefert IMMER {record, thumbBlob:null}
   (aktuell wird makeFailedRecord nackt zugewiesen → res.record undefined).
6. Persistenzfehler (§10.3): putPhotos/putThumb/putMeta-Fehler in Ingest und
   Stufen führen zu status 'error' bzw. verhindern die done-Persistierung —
   kein console.warn-und-weiter mehr.
7. UI: ProcessingScreen zeigt pending/active/done/skipped/error korrekt (skipped
   sichtbar als „noch nicht implementiert"); Hinweistext dynamisch (technical und
   chapters echt; faces, persons, embeddings, vlm, select Platzhalter/skipped); Retry bei error startet die fehlerhafte bzw. erste
   invalide Stufe; Zeitstempel-Abdeckung in der Diagnose anzeigen; Drop-Zonen-
   Text auf „Dateien hierhin ziehen — Ordner über den Button wählen" korrigieren.
8. app.js: fehlende Action SET_PERSONS (§10.5) ergänzen.
9. Invalidierungs-Infrastruktur (§10.4 + §10.8): runner.invalidateDownstream(key)
   setzt invalidates-Stufen auf pending und ruft deren reset(photos, db, context) auf
   (context optional: {reason, changedPhotoIds}; ohne Kontext konservativ resetten);
   reset-Funktionen für technical/chapters gemäß §10.8 implementieren, für die
   Stub-Stufen als No-op anlegen. Kosten-Regel: Resets löschen nur Ableitungen,
   nie pixel-basierte IDB-Artefakte.

Abnahme-Notiz mitliefern: welche Legacy-Zustände invalidiert werden, wie Stubs
behandelt werden, welche manuellen Tests empfohlen sind.
Output: deploybares ZIP.
```

**Danach — Etappe-4-Wiederabnahme** (fachlich + Robustheit, erst dann Etappe 5):
Schärfe-/Belichtungs-Plausibilität (Bokeh-Porträt darf nicht „unscharf" sein), Grid-Gruppierung. Robustheits-Mindestkriterien Kapitel: ohne `takenAt` → `lastModified`-Fallback greift; 1 Foto → genau 1 Kapitel; alle ohne GPS → rein zeitlich, kein Fehler; Kapitelanzahl explodiert nicht (Plausibilitätsgrenze gegenüber Fotoanzahl).

**Parkliste (bewusst NICHT in R):** Kapitel-Schwellen-Härtung (Min-Gap 60 s, Tagesgrenzen-Signal, Plausibilisierung der Kapitelanzahl) — Algorithmus-Tuning, kein Fundament; als kleiner Auftrag vor Etappe 9 einplanen.

**Parkliste (E9-Anforderung, aus E7-Review):** Review-UI dritter Tab „Aussortiert" zeigt Solver-Rejects (`rejectReason` ≠ duplicate) mit Reaktivierungs-Button. Reaktivierung erzeugt einen Override, der das Bild als Pick erzwingt — auch gegen die Solver-Entscheidung. Begründung: verhindert dass die Heuristik ein storyrelevantes Bild trotz technischer Mängel endgültig aussortiert. Erst ab E9 sinnvoll, weil vorher keine echten `rejectReason`-Werte existieren.

**Parkliste (vor E7, Render-Timing):** Badge-Flicker beim ersten Grid-Load (ObjectURL noch nicht bereit beim Badge-Render) — kosmetisch, kein Blocker.

**Parkliste (aus E9-Abnahme, kosmetisch):** ProcessingScreen zeigt bei der Embeddings-Initialisierung kurz „Bild 0 von 2N" (doppelter total-Wert vor dem ersten onProgress-Tick), korrigiert sich beim ersten Tick auf N. Reiner Anzeige-Glitch, keine Doppelberechnung. Beiläufig fixen, wenn s4_embeddings.js / ProcessingScreen ohnehin angefasst wird (z. B. E10/E11).

---

### Etappe 5 — MediaPipe P/S/M
**Modell:** Sonnet · **Denktiefe:** mittel

```
Browser-lokales Foto-Kuratierungs-Tool. KONZEPT.md (verbindlich: §9, §10 — ML auf Main-Thread!) + aktueller Stand als ZIP beigefügt.

Bitte Etappe 5 umsetzen: Stufe 3 (Gesichter, P/S/M).

NEU: js/pipeline/s3_faces.js
ÄNDERN: stages.js, deps.js (MediaPipe tasks-vision, Version gepinnt), Grid.js (P/S/M-Chips, Blink-Warnung)
NICHT ANFASSEN: runner-Kontrakt, db.js-API

Inhalt:
- MediaPipe FaceLandmarker (IMAGE-Mode, Blendshapes an) aus tasks-vision CDN; WASM-Assets-Pfad pinnen
- Pro Photo (Thumb aus IDB): faces.count, maxBoxRatio (größte Bbox-Fläche / Bildfläche), blink (eyeBlinkLeft+Right > 0.5 bei allen großen Gesichtern), smile (Mittel mouthSmileLeft/Right, 0–1)
- Split mit Fokus-Preset-Faktor (people ×0.5 / balanced ×1 / places ×2):
  P: maxBoxRatio > 0.08×Faktor · S: count===0 oder maxBoxRatio < 0.02×Faktor · M: dazwischen
- stream + faces in Record, idempotent, batchweise persistieren, Modell danach freigeben

Zusätzlich zwingend (DoD §11): Registry-Eintrag faces mit implVersion 'faces-v1',
validateFaces, resetFaces (§10.8), isStub:false, invalidates ['persons','embeddings','vlm','select'];
Einzelbildfehler → stageFails.faces; Persistenzfehler → StageError; der alte
skipped-Stub-Zustand wird durch implVersion+Validator automatisch invalidiert.

Output: deploybares ZIP des Gesamtstands.
```

---

### Etappe 6 — CLIP + Dedup
**Modell:** Sonnet · **Denktiefe:** hoch

```
Browser-lokales Foto-Kuratierungs-Tool. KONZEPT.md (verbindlich: §9, §10 — insb. 10.6 Modell-Loader) + aktueller Stand als ZIP beigefügt.

Bitte Etappe 6 umsetzen: models.js + Stufe 4 (Embeddings, Dedup).

NEU: js/models.js (Kontrakt §10.6), js/pipeline/s4_embeddings.js
ÄNDERN: stages.js, deps.js (transformers.js, Version gepinnt)
NICHT ANFASSEN: runner-Kontrakt, db.js-API

Inhalt:
- models.js: loadModel/unloadModel/hasWebGPU; transformers.js env auf Cache API + WebGPU-Backend mit WASM-Fallback konfigurieren; Download-Fortschritt an onProgress
- s4_embeddings: kleinstes CLIP-Vision-ONNX (z. B. clip-vit-base-patch16, quantisiert) — Embedding pro Thumb → IDB-Store embeddings (Float32Array)
- Clustering: chronologisch sortiert, greedy — Cosinus ≥ 0.92 UND Zeitabstand < 10 min → selber Cluster (verhindert semantische Fehl-Merges über Tage hinweg)
- Repräsentant: bester Score (0.6×mittlerer tech-Score + 0.4×(kein blink)); andere: repr=false, rejectReason 'duplicate'
- Grid: Badge "N ähnliche" auf Repräsentanten; Modell nach Stufe entladen

Zusätzlich zwingend (DoD §11): Registry-Eintrag embeddings ('embeddings-v1',
validateEmbeddings, resetEmbeddings §10.8 — IDB-Embeddings bleiben beim Reset
erhalten!, invalidates ['vlm','select']); Foto-Idempotenz: vorhandenes IDB-Embedding
→ keine Re-Inferenz, nur Re-Clustering; stageFails.embeddings; StageError.

Output: deploybares ZIP des Gesamtstands.
```

---

### Etappe 7 — Review-UI
**Modell:** Sonnet · **Denktiefe:** mittel

```
Browser-lokales Foto-Kuratierungs-Tool. KONZEPT.md (verbindlich: §5 Screen 4, §9, §10) + aktueller Stand als ZIP beigefügt.

Bitte Etappe 7 umsetzen: Review-UI Grundgerüst.

NEU: js/components/PickCard.js, js/components/ClusterOverlay.js, js/components/RejectedView.js
ÄNDERN: screens/ReviewScreen.js (Stub ersetzen), selectors.js (Auswahl-/Verworfen-Gruppierungen), app.js (TOGGLE_PICK-, SWAP_PICK-Actions via ADD_OVERRIDE protokolliert)
NICHT ANFASSEN: Pipeline, db.js-API

Inhalt:
- Buchansicht: Kapitel als horizontale Scroll-Streifen, chronologisch (§3 Ordnungsprinzip!), M-Bilder visuell hervorgehoben, Budget-Zähler "X / Ziel"
- PickCard: Thumb, P/S/M-Chip, Technik-/Blink-Flags, Cluster-Größe, Platzhalter für Caption + Beat (Etappen 8/9)
- ClusterOverlay: Klick auf "N ähnliche" → Mitglieder, 1-Tap-Swap (Repräsentant tauschen, Override loggen)
- RejectedView: Tab, Filter nach rejectReason, 1-Tap "wieder aufnehmen"
- Hoch/Runter-Reordering innerhalb des Kapitels; Override-Zähler im Header
- Da Stufe 6 noch fehlt: vorläufige Auswahl = alle Repräsentanten (picked=true), damit die UI testbar ist. WICHTIG: Dieser Zustand ist rein temporär — pipelineState.select bleibt 'skipped'/'pending', wird NIE als done persistiert, und validateSelect (Etappe 9) darf ihn nicht als gültig akzeptieren

Output: deploybares ZIP des Gesamtstands.
```

---

### Etappe 8 — Florence-2 VLM

> **HINWEIS (v3.8):** Dieser Prompt-Block ist historisch. Die verbindliche Umsetzung von Stufe 5 liegt in zwei selbsttragenden externen Dokumenten:
> - **`E8-ENDFASSUNG.md`** — Inferenz-/Persistenzarchitektur (Florence-2, zwei Task-Tokens, `vlmRaw`-Store, Idempotenz, Fehlerebenen, Registry/Validator/Reset). **Gilt unverändert.**
> - **`E8_2-ENDFASSUNG-v2.md`** — ersetzt den Ableitungsteil (§5) vollständig: `place`/`activity` per Zero-Shot über CLIP-Embeddings statt Keyword-Matching. **Verbindlich für die laufende Umsetzung.**
>
> Der ursprüngliche Caption-Keyword-Ansatz unten ist durch E8.2 abgelöst (Begründung im Changelog v3.8, P11–P19). Nicht mehr als Vorlage verwenden.

**Modell:** Opus · **Denktiefe:** hoch

```
Browser-lokales Foto-Kuratierungs-Tool. KONZEPT.md (verbindlich: §9, §10) + aktueller Stand als ZIP beigefügt.

Bitte Etappe 8 umsetzen: Stufe 5 (VLM-Tagging).

NEU: js/pipeline/s5_vlm.js
ÄNDERN: stages.js, PickCard.js (Caption + Tags anzeigen)
NICHT ANFASSEN: runner-Kontrakt, models.js-API, db.js-API

Inhalt:
- Florence-2-base-ft via transformers.js (onnx-community), über models.js laden, fp16/WebGPU, WASM-Fallback
- NUR Photos mit repr===true && status==='ok'
- WICHTIG — Florence-2-Realität: Das Modell hat KEINEN JSON-Mode und KEIN freies VQA. Es akzeptiert ausschließlich feste Task-Tokens (<CAPTION>, <DETAILED_CAPTION>, <MORE_DETAILED_CAPTION>, <OD>, <DENSE_REGION_CAPTION>, …). Die strukturierten Felder werden NICHT vom Modell erfragt, sondern DETERMINISTISCH aus dessen Ausgaben abgeleitet.
- Aufrufe pro Repräsentant: <MORE_DETAILED_CAPTION> (immer) + <OD> (immer). Daraus ableiten:
  caption: die Caption direkt
  shotType (wide/medium/detail): aus OD-Bbox-Geometrie (Summe/Größe der Objektboxen relativ zum Frame) + Caption-Keywords (z. B. "panorama", "close-up")
  activity / mood / place: Keyword-/Synonym-Mapping über die Caption (Wortlisten als dokumentierte Konstanten; mood nur positiv/neutral/negativ; bei keinem Treffer null)
  momentScore (0–1): Heuristik aus Aktivitäts-Verben in der Caption + faces.smile + Anzahl Personen in Interaktion (Gewichte als Konstanten dokumentieren)
  Strom-Spezifik: P/M nutzt zusätzlich faces-Daten aus Stufe 3; S nutzt OD-Objektklassen für place
- Robustheit: Ausgabe-Postprocessing in try/catch pro Bild; bei leerer/abgebrochener Generierung 1 Retry, danach Fallback-Objekt {caption: roher Text oder '', Rest null}
- Idempotent (vlm!==null überspringen), batchweise persistieren, Modell entladen
- WICHTIG: Dies ist die längste Stufe — onProgress pro Bild, Restzeit-Anzeige nutzt reale Per-Bild-Dauer (gleitender Mittelwert)

Zusätzlich zwingend (DoD §11): Registry-Eintrag vlm ('vlm-v1', validateVlm, resetVlm
§10.8 — Reset nur für Fotos mit geändertem stream/neuer Repräsentanz, invalidates
['select']); stageFails.vlm; StageError bei Modell-Ladefehler.

Output: deploybares ZIP des Gesamtstands.
```

---

### Mini-Auftrag G0.5 — EXIF-Geo/Optik/Zeit (nach E9-Abnahme, vor v1-Abschluss)
**Modell:** Sonnet · **Denktiefe:** niedrig
*(Vorbereitung §12 / Forschungspapier. Begründung: Originale sind session-gültig (§9.3) — ohne G0.5 kostet jede spätere Geo-Funktion Re-Attach + Re-Parse pro Bestand. KEINE Netzwerkfunktion. **Bewusste Beschränkung auf ROHFELDER:** abgeleitete Werte wie `inferredUtc`/`timeConfidence` gehören NICHT hierher — sie sind aus den konservierten Rohfeldern jederzeit reproduzierbar und werden erst im v2-SunEvidence-Modul berechnet. Ein Ingest-Auftrag konserviert, er interpretiert nicht.)*

```
Browser-lokales Foto-Kuratierungs-Tool. KONZEPT.md (verbindlich: §9, §10.2 gps-/exifOptics-/exifTime-Typedef) + aktueller Stand als ZIP beigefügt.

Bitte Mini-Auftrag G0.5 umsetzen: EXIF-Geo/Optik/Zeit-ROHFELDER beim Ingest miterfassen.

ÄNDERN: js/workers/ingest.worker.js UND js/ingest.js (beide EXIF-Lesepfade — Worker und Main-Thread-Fallback), js/ctx.js (Typedefs gemäß §10.2)
NICHT ANFASSEN: db.js-API, Pipeline-Stufen, Screens, deps.js

Inhalt (NUR Rohfelder, additiv im Photo-Record):
- gps additiv: {lat, lon, alt:number|null, dir:number|null}
  (alt = GPSAltitude/+Ref, dir = GPSImgDirection/+Ref)
- exifOptics: {focalLength, focalLength35mm, digitalZoomRatio, lensModel, make, model} — fehlende Tags null
- exifTime: {dateTimeOriginalRaw, offsetTimeOriginal, gpsDateStamp, gpsTimeStamp} — fehlende Tags null
- Alle Tags im SELBEN exifr.parse(file, {pick:[…]})-Durchlauf wie die bestehenden Datums-Tags lesen, kein zusätzlicher Datei-Scan.
- NICHT erfassen: inferredUtc, timeConfidence (= v2-Ableitungen, nicht roh).
- KEIN DB_VERSION-Bump (additive Felder im Photo-Record).
- Bestehende Leser (s2_chapters etc.) bleiben unverändert lauffähig. Leser-Regel: undefined wie null behandeln. Kein Backfill.

Abnahme: je ein Foto mit/ohne Richtungs-Tag und mit/ohne Optik-Tags ingesten, Record in DevTools prüfen; Foto ohne GPS → gps null wie bisher; Altbestände ohne die neuen Felder verursachen keinen Fehler.

Output: deploybares ZIP des Gesamtstands.
```

---

### Etappe 9 — Constraint-Solver
**Modell:** Fable · **Denktiefe:** hoch *(Fallback: Opus · Denktiefe extra)*

```
Browser-lokales Foto-Kuratierungs-Tool. KONZEPT.md (verbindlich: §3 Erzählmodell + Ordnungsprinzip, §4 Presets, §10) + aktueller Stand als ZIP beigefügt.

Bitte Etappe 9 umsetzen: Stufe 6 (narrative Selektion).

NEU: js/pipeline/s6_select.js
ÄNDERN: stages.js, selectors.js (Begründungen), PickCard.js (Beat-Badge)
NICHT ANFASSEN: runner-Kontrakt, db.js-API, Review-Reihenfolge-Logik (chronologisch!)

Kandidaten: repr===true && status==='ok'. Kombinierter Basis-Score:
  score = w_tech×mean(tech) + w_moment×(vlm.momentScore ?? 0.5) + w_smile×(stream==='P' ? faces.smile : 0) + bonus_kein_blink
  w_tech: Preset Technik-Strenge (strict 1.5 / moment 0.5); übrige Gewichte ausbalancieren und als Konstanten dokumentieren.

Beat-Zuordnung je Kandidat aus vlm.shotType + stream:
  establishing: S+wide · action: P+Aktivität · detail: S+detail · hero: M · transition: S, spät im Kapitel

Auswahl zweiphasig (Preset Auswahlprinzip):
  Phase 1 (chronicle/balanced): Floor — bestes Bild pro Kapitel, sofern score > Mindestschwelle (Konstante, dokumentieren)
  Phase 2: globaler Greedy mit Konzentrations-Malus
    score_eff(p) = score(p) − λ×(bereits gewählte im selben Kapitel)
    λ: chronicle hoch / balanced mittel / highlights ≈ 0 (Konstanten dokumentieren)
  Harte Constraints in jeder Phase: kein zweites Bild desselben Clusters im Kapitel; Strom-Balance-Ziel je Fokus-Preset (people 60/20/20 P/S/M · places 20/60/20 · balanced 40/30/30) als weiche Strafe; Budget = targetCount.
  Beat-Härte: chronicle: fehlender establishing/hero im Kapitel wird vorrangig gefüllt · highlights: Beats nur als Score-Bonus.

Personen-Coverage: personIds noch leer → Fallback: Diversität über faces.count-Klassen (0 / 1–2 / 3+) als weiche Strafe.

Ausgabe: picked, beat, reason (lesbarer String, z. B. "Hero-Anker Kapitel 3 — bestes M-Bild, Moment 0.8"); Nicht-Gewählte: rejectReason ('budget'/'redundant'/'stream'). REIHENFOLGE: niemals umsortieren — Auswahl wird chronologisch ausgegeben (§3).

Zusätzlich zwingend (DoD §11): Registry-Eintrag select ('select-v1', validateSelect,
resetSelect §10.8 — Override-Log bleibt, include/exclude-Overrides nach Re-Selektion
erneut anwenden, reorder verfällt; invalidates []); Re-Run bei Preset-Änderung läuft
über runner-Invalidierung ohne jede Re-Inferenz.

Output: deploybares ZIP des Gesamtstands.
```

---

### Etappe 10 — Coverage-Panel + Overrides
**Modell:** Sonnet · **Denktiefe:** mittel

```
Browser-lokales Foto-Kuratierungs-Tool. KONZEPT.md (verbindlich: §5, §10) + aktueller Stand als ZIP beigefügt.

Bitte Etappe 10 umsetzen: Coverage-Panel + Override-Logging.

NEU: js/components/CoveragePanel.js
ÄNDERN: ReviewScreen (Sidebar), selectors.js (Coverage-Berechnung, Override-Quote), app.js (Override-Payload vereinheitlichen: {type:'swap'|'include'|'exclude'|'reorder', photoId, ts, prevReason})
NICHT ANFASSEN: Pipeline, db.js-API

Inhalt:
- Panel (ausklappbar): Beat-Abdeckung pro Kapitel (Farbpunkte je Beat), Strom-Verteilung vs. Ziel, Gesichts-Klassen-Diversität (Fallback-Modus, mit Hinweis "ohne Personenerkennung"), Gesamtstatistik
- Override-Quote live im Review-Header: "N Overrides — X%" (X = Overrides / Auswahlgröße)
- Beat-Lücke rot → Tooltip "Kein Establishing in Kapitel 4 — in Verworfenen suchen?" mit Sprunglink in gefilterte RejectedView
- Overrides zusätzlich in meta persistieren (Resume-fest)

Output: deploybares ZIP des Gesamtstands.
```

---

### Etappe 11 — Face-Clustering
**Modell:** Sonnet · **Denktiefe:** hoch

```
Browser-lokales Foto-Kuratierungs-Tool. KONZEPT.md (verbindlich: §3 Personen-Coverage, §10) + aktueller Stand als ZIP beigefügt.

Bitte Etappe 11 umsetzen: Personen-Identität (zwischen Stufe 3 und 4 einhängen, Key 'persons').

NEU: js/pipeline/s3b_persons.js
ÄNDERN: stages.js (Stufe einfügen), CoveragePanel (echte Personen statt Fallback), s6_select.js (Personen-Coverage auf personIds umstellen, Fallback behalten), ctx.js (Person-Typedef)
NICHT ANFASSEN: runner-Kontrakt, db.js-API

Inhalt:
- Kleines Face-Embedding-ONNX über models.js: VOR der Implementierung per Websuche verifizieren, welches frei verfügbare Modell ≤10 MB aktuell zuverlässig via onnxruntime-web läuft (HF-Hub-Pfad + Version in deps.js pinnen; NICHT aus dem Gedächtnis raten). Falls keines verlässlich verfügbar: Stufe als no-op mit UI-Hinweis ausliefern — der Fallback-Pfad existiert bereits
- Face-Crops aus MediaPipe-Bboxen (nur Gesichter > 40px) → Embeddings → IDB faceEmbeddings
- Agglomeratives Clustering (cosine, Schwelle ~0.6 Ähnlichkeit) → persons in meta: {id, label:'Person A', sampleThumbId, photoIds}
- photo.personIds befüllen; CoveragePanel: Beispiel-Thumb, Bildanzahl in Auswahl, Ampel (≥2 grün / 1 gelb / 0 rot), Umbenennen + Mergen (zwei Cluster vereinen, persistieren)

Zusätzlich zwingend (DoD §11): Registry-Eintrag persons ('persons-v1', validatePersons,
resetPersons, invalidates ['select']); No-op-Fall (kein Modell verfügbar) bleibt
status 'skipped', nie 'done'; stageFails.persons; StageError.

Output: deploybares ZIP des Gesamtstands.
```

---

### Etappe 12 — Presets verdrahten + Export
**Modell:** Sonnet · **Denktiefe:** mittel

```
Browser-lokales Foto-Kuratierungs-Tool. KONZEPT.md (verbindlich: §4, §5 Screen 5, §10) + aktueller Stand als ZIP beigefügt.

Bitte Etappe 12 umsetzen: Presets vollständig verdrahten + Export.

ÄNDERN: PresetsScreen (an state.presets binden — UI existiert), ReviewScreen ("Neu berechnen"-Button bei Preset-Änderung), ExportScreen (Stub ersetzen), deps.js (JSZip pinnen), ingest.js (Re-Attach-Flow)
NICHT ANFASSEN: Pipeline-Stufen 1–5, db.js-API

Inhalt:
- Preset-Änderung nach Lauf läuft über den Invalidierungsmechanismus (§10.4/§10.8): Umfang/Technik-Strenge/Auswahlprinzip → invalidate('select'); Fokus → stream-Neuableitung aus vorhandenen faces-Daten (reine Schwellen-Logik, kein Modell) + Downstream-Invalidierung. In keinem Fall Re-Inferenz (MediaPipe/CLIP/VLM bleiben unangetastet)
- Export: ZIP der ORIGINALE der Auswahl via fileMap; wenn fileMap leer (Reload): Hinweis + erneute Ordnerwahl, Abgleich über IDs (§9.3)
- selection.json: [{id, filename, chapter, beat, stream, scores:{tech, moment, smile}, reason, overridden:boolean}] in chronologischer Reihenfolge
- Kontaktbogen: neues Fenster, Print-CSS, Thumbnails chronologisch mit Kapitel-Trennern, Dateiname unter jedem Bild
- Abnahmekriterium (§6) im ExportScreen anzeigen: Override-Quote + Bestanden/Nicht bestanden

Output: finales deploybares ZIP.
```

---

## 12. v2-Ausblick: Geo/POI-Anreicherung & Bildunterschriften (vorbereitet, nicht beauftragt)

**Ziel:** Aus vorhandenen GPS-Daten und Florence-Captions (`vlmRaw`) Standorte und Sehenswürdigkeiten identifizieren; daraus Bildunterschriften und Begleittexte ableiten. **v1-Scope bleibt unverändert** — dieser Abschnitt fixiert die Entscheidungen, die eine spätere Nachrüstung ohne Umbau ermöglichen, und konserviert den Recherchestand.

### 12.1 In v1 umgesetzte Vorbereitungen
1. **Mini-Auftrag G0** (§11): GPSAltitude/GPSImgDirection beim Ingest miterfassen — einzige Vorbereitung mit Zeitdruck, weil Originale session-gültig sind (§9.3).
2. **§9.6 Netzwerk-Grundsatz:** Opt-in, nur gerundete Cluster-Zentroiden, nur CORS-fähige Dienste mit Cache-erlaubenden Bedingungen.
3. **Geplanter IDB-Store `geo`** (§10.3): dokumentiert; Anlage erst mit DB_VERSION-Bump bei Umsetzung.

### 12.2 Architektur-Skizze (Recherchestand 06/2026 — Verfügbarkeit/Policies vor Umsetzung erneut verifizieren)

**Zwei neue Stufen im bestehenden Vertrag (§10.4):**
- `geo` (nach `chapters`): Reverse-Geocoding + POI-Kandidaten pro Orts-Cluster-Zentroid. Offline/Opt-out → `{status:'skipped'}` (vorhandene Skip-Semantik trägt das ohne Sonderfall); Netzwerk-Einzelfehler → `stageFails.geo`.
- `captions` (nach `vlm`): Formulierung von Bildunterschriften/Begleittexten aus geo + vlmRaw + Kapitelkontext.
- invalidates-Ketten bei Umsetzung explizit nachziehen (Registry-Regel: wer eine Abhängigkeit ergänzt, schreibt die ganze Kette) — mindestens `chapters.invalidates += 'geo'`, `geo.invalidates ⊇ ['captions']`.

**Quellen (frei, CORS-fähig, direkt aus dem Browser):**
- **Nominatim `/reverse`** — Ortsname pro Cluster-Zentroid. Policy: max. 1 Request/s, gültiger Referer/User-Agent (der Browser sendet den Referer), sichtbare Attribution, Daten unter ODbL. 10–30 Cluster pro Reise → unkritisch. Pro Foto geocoden ist policy-widrig UND unnötig.
- **Wikipedia GeoSearch** (`de.wikipedia.org`, `generator=geosearch`, Radius ≤ 10 km, kombinierbar mit `prop=description|extracts|coordinates`, CORS via `origin=*`) — liefert Artikel + Kurztexte = Rohmaterial für Begleittexte.
- **Overpass API** — strukturierte POIs (`tourism=*`, `historic=*`, `natural=peak`); liefert `wikidata`/`wikipedia`-Tags als Brücke zur Quelle darüber. Browserfähig; moderate Nutzung öffentlicher Instanzen zulässig, keine harten Limits, aber Lastmanagement (429-Backoff einplanen).

**Disambiguierung (Kernproblem: GPS = Standort des Fotografen, nicht des Motivs — Rom: 50 POIs in 300 m):**
E8.2-Zero-Shot-Maschinerie wiederverwenden — POI-Kandidatennamen/-typen als CLIP-Text-Embeddings gegen die vorhandenen E6-Bild-Embeddings scoren (TAU/EPS-Disziplin aus P17/P18 übernehmen); Florence-`odLabels` als Plausibilitätsfilter; `gps.dir` (G0) als geometrisches Zusatzsignal. **Keine neue ML-Infrastruktur.**

**Cache-Politik:** `geo`-Einträge sind extern beschaffte, rate-limitierte Artefakte → Kosten-Regel §10.4 analog `vlmRaw`: überleben Stage-Resets; Schlüssel `quelle:latGerundet,lonGerundet:radius:version` (Rundung ~3 Dezimalstellen ≈ 100 m); Invalidierung nur über Schlüssel-Mismatch.

### 12.3 Bewusst offene Entscheidungen (erst bei Beauftragung)
- **Textformulierung:** Florence-Captions sind englisch, Zieltexte deutsch. Optionen: (a) Template aus strukturierten Daten — lokal, deterministisch, begrenzte Qualität; (b) lokales LLM via WebGPU — Qualitäts-/Lade-Risiko; (c) externe LLM-API — beste Texte, aber zweiter Prinzipienbruch gegen §9.6 + Kosten. `vlmRaw` konserviert alle Eingangsdaten, daher keine Datenvorbereitung nötig.
- **GPX-Track-Interpolation** für Bestände ohne EXIF-GPS (`takenAt` × Track-Position): rein additiv, keine Vorbereitung nötig.
- **Lizenz:** OSM-Attribution („© OpenStreetMap contributors") in der App-UI Pflicht, sobald geo aktiv ist. Wikipedia-Extracts CC BY-SA: als Faktenbasis für eigene Formulierungen unkritisch; wörtliche Übernahme in ein *veröffentlichtes* Buch hätte Share-alike-Folgen.

---

## 13. v2-Architekturmuster (aus Infinite-Edge-Agent-Analyse; nicht beauftragt)

Selektive Übernahme von **Mustern** (nicht der Codebasis — jenes Projekt ist TS/pnpm/Vite/WebLLM, das Gegenteil von zero-build). Übernommen werden nur Muster, die Prüfbarkeit, Erklärbarkeit oder Erweiterbarkeit verbessern, ohne den lokal-first/zero-build-Charakter aufzugeben.

### 13.1 Backend-Broker-Light — **mit E11 umzusetzen** (nicht v2, vorgezogen)
Jede Pipeline-Stufe deklariert explizit ihre Backend-Rolle und kommuniziert sie sichtbar: `production` (erwarteter Pfad, z. B. WebGPU mit gepinntem Modell), `fallback` (erlaubt, aber langsamer/eingeschränkt — z. B. WASM), `experimental`, `skipped` (bewusst nicht verfügbar). **Kein Fallback gilt still als Produktivpfad.** Minimal umzusetzen: Status-Feld pro Stufe + UI-Hinweis (z. B. „Personen: übersprungen — kein Modell", „VLM: WASM-Fallback, langsamer"). Vorhandene Bausteine: `models.js` WebGPU→WASM-Fallback (E6), Registry-`done`/`skipped`/`error`, `validatePersons→false`. Begründung der Vorziehung: E11 ist die Etappe mit dem größten Fallback-Risiko (Face-Modell evtl. nicht browser-reif) — die ehrliche Statusanzeige ist genau dort nötig und verhindert die Wiederholung des E11-No-op-Vorgriffs (Fallback fast als vollwertige Etappe verbucht). **Nicht** das volle Broker-Konstrukt des Repos übernehmen, nur das Rollen-/Status-Prinzip.

### 13.2 Proof Layer (`curation-proof.json`) — nach E12, optional
Maschinenlesbarer Laufnachweis: Plattform/WebGPU-Verfügbarkeit, Pipeline-/Stage-Versionen, Modell-IDs/Revisionen, genutzter Backend-Pfad je Stufe, Laufzeiten, Anzahl Fotos/Cluster/Kapitel/Picks, Fehlerquoten, `skipped`-/Fallback-Stufen, Override-Quote, Abnahmekriterium bestanden/nicht, Warnungen. Fast alle Daten existieren bereits (`pipelineState`, `implVersion`, `stageFails`, E10-Override-Quote, E9-Abnahmekriterium) — primär Einsammeln/Serialisieren. **Einordnung:** Abnahme-/Entwicklerwerkzeug, kein Nutzer-Feature; gehört nicht in den v1-Auslieferungsumfang.

### 13.3 Context Pack Builder — v2, mit §12-`captions` zusammenführen
Deterministische Ableitungsschicht pro Kapitel: `{timeRange, photoCount, selectedPhotos, rejectedCandidates, beatsCoverage, personsCoverage, streamDistribution, dominantPlaces, activities, missingBeats, overrideHistory, warnings}`. Kein Modell, keine Netzwerkfunktion. Grundlage für bessere Review-Begründungen, Kapiteltexte und Bildunterschriften — überschneidet sich mit dem §12-`captions`-Strang und ist dort zu integrieren, nicht separat zu planen.

### 13.4 Lokaler Buchdramaturg (LLM) — v2-Spike, nachrangig
Optionales kleines Browser-LLM (WebGPU) als assistive Text-/Review-Schicht („Warum diese Auswahl?", „Was fehlt dem Buch?", Kapitelüberschriften, Captions aus Metadaten). **Harte Leitplanke:** arbeitet NUR auf strukturierten Metadaten, bewertet keine Bilder neu, ändert keine Auswahl still; erzeugt nur bestätigungspflichtige Vorschläge (facts-only, deckt sich mit der §12-captions-Regel). Erst nach Proof Layer + Backend-Ehrlichkeit + Context Packs.

### 13.5 Bewusst NICHT übernommen
Kein generischer Chat-Agent, kein Remote-Memory, kein Telemetrie-Server, keine eigenen WebGPU-Kernel, **kein stilles Active-Learning aus Overrides** (würde den in E8.2/E9 bewusst hart gemachten Determinismus brechen), kein autonomes Umstellen der Auswahl durch ein LLM. Diese erhöhen Komplexität/Modelllast/Erklärungsrisiko ohne proportionalen v1-Nutzen.

---

## 14. v2 Semantic Curation Layer (dokumentiert, nicht beauftragt)

**Kernerkenntnis:** Der v1-Solver optimiert *messbare* Kriterien (Schärfe, Stream, Cluster, Beats, Budget) und erzeugt plausible, aber *mechanische* Auswahlen. Die nächste Qualitätsstufe entsteht nicht durch mehr Heuristik-Tuning (das löst es nicht), sondern durch eine **semantische Kurationsschicht**, die Nutzerabsicht + Kapitelkontext + Bildbedeutung verbindet. Beobachtete Fehlfälle: unscharfes-aber-emotional-zentrales Bild verworfen; technisch gutes-aber-redundantes Bild gewählt; einzige Aufnahme einer wichtigen Personen-Konstellation unterschätzt. Das ist eine Lücke im **Produktmodell**, kein Parameterfehler.

**PO-Risiko-Trennung (wichtig):** Das Quellpapier bündelt alles als „Semantic Curation Layer". Hier bewusst aufgespalten in zwei Risikoklassen:

### 14.A Deterministische Bausteine (kein LLM, risikoarm, hoher Wert)
- **Diagnose-Metriken / Proof-Layer-Kern** (Phase 0, JETZT beauftragt als Diagnose-Panel): Override-Quote, Reject-Grund-Verteilung, wiederaufgenommene Rejects, entfernte Auto-Picks, Kapitel/Cluster-Hotspots, Lauf-Metadaten. Export `diagnose.json` (rich, aber ohne Bilddaten/GPS/EXIF/Embeddings; mit sichtbarem Datenschutz-Hinweis). Deckt §13.2 Proof Layer mit ab.
- **Candidate Expansion** (§6.3 Quellpapier): pro Cluster mehrere Kandidaten weiterreichen (technisch bestes / emotional stärkstes P / bestes M-Hero / erstes+letztes der Sequenz / stärkster Intent-Treffer / manuell reaktiviertes) statt nur einen Repräsentanten. **Voraussetzung dafür, dass eine spätere semantische Schicht überhaupt Auswahl hat** — und risikoärmster Einzelbaustein. Wahrscheinlich der größte Qualitätshebel ohne LLM.
- **User Intent Brief** (`meta.intent`): kurze Projektabsicht (Reiseart, Muss-Motive/Personen, Ausschlüsse, Stil). Ohne diese Information kann kein System wissen, ob ein technisch mittelmäßiges Bild wichtiger ist als ein perfektes austauschbares.
- **Evidence Cards + Context Packs** (§13.3): verdichtete Signale pro Bild/Kapitel, kein Rohbild. Vorbereitung für 14.B, aber auch ohne LLM für bessere Review-Begründungen nutzbar.

### 14.B LLM-Kurator (hohe Abhängigkeit, als letzte datengetriebene Eskalation)
LLM bewertet kapitelweise Context Packs → strukturierter Output (include/exclude/swap/keep/uncertain + Rolle + Confidence + Begründung + betroffene Intention). Eine **künftige Kurationsschicht (`select-vNext`)** integriert das als zusätzliche Score-Komponente; **harte Regeln bleiben** (Chronologie dominant, Umfang/Cap sichtbar, manuelle Includes vorrangig, Review final, keine stillen Änderungen, kein Bild-Upload). **PO-Vorbehalte:** (1) lokales Browser-LLM (WebLLM/WebGPU, GB-Bereich) ist eine massiv größere Abhängigkeit als alles bisher und läuft auf dem WASM-Normalfall nicht; (2) der „optionale Remote-Modus" bricht das lokale Datenschutzversprechen auch mit Evidence Cards (Captions/Orte/Personen-Konstellationen sind sensibel) — echte Produktweggabelung, kein Detail; (3) Modus-3 „2–4 h Laufzeit" unterschätzt Browser-Grenzen (Tab-Speicher, Suspend, Akku) — robustes Pause/Resume wäre selbst substantielle Arbeit. Effizienz über progressive Vertiefung (Schnell = Repräsentanten / Gründlich = Cluster-Shortlists, v2-Default / Maximal = alle Bilder).

### 14.C Leitprinzip: Diagnose vor Architektur
**Bevor** 14.A/14.B gebaut wird: mit echten, heterogenen Urlaubsordnern (Stadt/Natur/Familie) messen, *woran* schlechte Auswahlen liegen (Technik/Person/Cluster/Beat/Kontext). Erst diese Evidenz entscheidet die Reihenfolge. **Konkrete Konsequenz für E11:** Die Annahme „fehlende Protagonisten-Erkennung ist ein zentrales Auswahlproblem" ist plausibel, aber unbewiesen. E11 (EdgeFace — aufwendigste/riskanteste Etappe) wird daher hinter die Qualitätsdiagnose gestellt: Zeigt die Diagnose Personen-Unterscheidung als Hauptursache → E11 bestätigt; zeigt sie semantische Redundanz/fehlenden Intent → Candidate Expansion + Intent Brief zuerst. Der EdgeFace-Auftrag bleibt fertig vorbereitet, nur zurückgestellt.

### 14.D Modellstrategie v2
Florence-2 bleibt v1-Baseline (kein Wechsel vor v1-Abschluss). Für v2 Modellklammer: LFM2.5-VL-450M-ONNX als 2026er Herausforderer evaluieren, SmolVLM-Klasse als leichter Caption/VQA-Kandidat. **Modellfrage NICHT vor der Produktarchitektur entscheiden** — erst klären, welche semantischen Rohsignale der Kurationslayer braucht, dann ob Florence reicht. Entscheidung datengetrieben (reale Produktmetriken), nicht über VLM-Benchmarks.

### 14.E Erfolgskriterien
Semantische Schicht muss **Override-Quote** und Zahl **unverzichtbar-verworfener Bilder** messbar senken, sonst Aufwand nicht gerechtfertigt. Weitere Metriken: Anteil reaktivierter Rejects, entfernter Auto-Picks, Kapitel mit semantischer Warnung, Zeit bis Review-Abschluss, Nutzerurteil „Buch fast übernehmbar?".

---

## 15. Zwei-Ebenen-Segmentierung: Szene ⊂ Tag/Kapitel (Etappe 1+2 realisiert, feld-abgenommen — siehe „Ergebnis" unten)

**Auslöser:** Erste Qualitätsdiagnose (~500-Bilder-Urlaubsordner) zeigte eine strukturell unbrauchbare Auswahl: fast inhaltsgleiche Porträts direkt nebeneinander gewählt, erzählerisch wichtige Sequenzen (ganzer Straßenumzug) fehlen, „Kapitel sind eigentlich Szenen". 

**Wurzelursache:** Die aktuelle Pipeline hat EINE Rhythmusebene (`chapters`), die zwei unvereinbare Rollen trägt: erzählerische Einheit (für Budget/Buch) UND zusammengehörige Aufnahme-Situation (die feinen Szenen). Der Solver rechnet Floor/Coverage damit auf der falschen, zu feinen Ebene → Budget wird von Mini-Kapiteln aufgefressen, Sequenzen zerstückelt, redundante Bilder derselben Situation gebündelt (zwei knapp getrennte Cluster im selben Mini-Kapitel passieren die Cluster-Sperre).

**Lösung — zwei Granularitäten** *(Entwurfs-Rationale zum Entscheidungszeitpunkt; die realisierte Ebenen-Zuordnung weicht ab — siehe „Ergebnis (v6)" unten: Floor **und** Beats landeten pro Szene, nicht pro Kapitel; es gibt keinen separaten Tag-Budget-/Coverage-Pass):**
- **Szene** (fein): zusammenhängende Aufnahme-Situation (kurzer Zeitabstand, gleicher Ort/Moment). Entspricht dem, was G1 heute als „Kapitel" erzeugt. **Redundanz-/Near-Dup-Logik gehört hierhin** — zwei fast gleiche Porträts = eine Szene → höchstens eines.
- **Kapitel** (grob): erzählerische Einheit, bündelt mehrere Szenen (z. B. „Altstadt-Tag" = Ankunft + Umzug + Café + Porträts). *(Ursprünglich als Träger von Budget/Beats/Coverage gedacht; **realisiert** liegen Floor und Beats jedoch auf der Szene — das Kapitel/der Tag bleibt chronologischer Container, Tagesabdeckung entsteht emergent über den Szenen-Floor. Kein Budget mehr.)*

**Wirkung auf die Diagnosebefunde:** Doppelporträts → Szenen-Dedup lässt eines durch. Fehlender Umzug → eigene Szene wird über den Szenen-Floor geseedet. Granularitäts-Verschwendung (alt) → behoben, weil der Floor **eine** beste Aufnahme **je Szene** seedet (statt je Mini-Kapitel) und der τ-Greedy + Diversität den Rest begrenzen. *(Realisierte Ebenen exakt: „Ergebnis (v6)".)*

**Layout-Synergie:** Ein Fotobuch hat genau diese zwei Ebenen — Kapitel als Abschnitte/Doppelseiten, Szenen als Bildgruppen auf der Seite. Die Struktur, die jetzt die Auswahl repariert, ist später die Layout-Grundlage.

**Entschiedene Architektur (v5 — Verträge §2/§10 nachgeführt, Etappe 1 beauftragbar):**
- **Tag/Kapitel = Kalendertag** (zeitbasiert, robust): Split mitten am Tag bei GPS-Sprung >5 km oder sehr großer Zeitlücke; Merge sehr stiller Tage in den zeitlich näheren Nachbarn; Mitternacht-Artefakt vermeiden. `chapterId` bezeichnet künftig den **Tag** (kein globales Rename).
- **Szene = inhaltsbasiert** (Ort/Aktivität aus CLIP + GPS, zeitlich zusammenhängend), `sceneId` NEU. Untagged-Fotos (CLIP-Abstention) erben die zeitnächste Szene; Glättung gegen Szenen-Flattern.
- **Pipeline-Reshape (zwingend):** Ort/Aktivität entstehen erst in `vlm` (Stufe 5) → inhaltsbasierte Szenen können NICHT in s2 laufen. Tag-Segmentierung bleibt Stufe 2 (zeitbasiert); **Szenen = NEUE Stufe nach `vlm`, vor `select`**, invalidiert `select`; Reset konservativ (vlm/embeddings überleben).
- **„Inhaltsbasiert" gilt nur für Szenen** — der Tag-Rücken bleibt zeitbasiert/stabil, hängt nicht an Tag-Qualität.

**Datenmodell:** `photo.chapterId` (= Tag, bleibt) + `photo.sceneId` (neu); `meta.chapters` (Tag, +`sceneIds`) + `meta.scenes` ({id, chapterId, start, end, count, place, activity}). Beide Ebenen strikt zeitlich zusammenhängend (§3 Chronologie-Dominanz gewahrt).

**Gestaffelter Zuschnitt (best practice — nicht Big-Bang am gegateten Solver):**
- **Etappe 1 — Segmentierung + Anzeige (Struktur-/Review-Fix, NICHT der vollständige Auswahl-Fix):** Tag-Redefinition in s2; neue Szenen-Stufe `scenes` nach vlm; Datenmodell; Arbeitssicht zeigt Szenen unter Tagen. Solver bleibt tagbasiert. Behebt die Kapitel-Granularität (zu eng/zu weit) und macht Szenen sichtbar/bewertbar — **aber Doppelporträts und fehlende Sequenzen werden erst in Etappe 2 systematisch korrigiert** (Solver nutzt dann Szenen-Coverage/-Redundanz). Abnahmeerwartung entsprechend: Struktur stimmt, Auswahlqualität noch tagbasiert. Determinismus-Gate (§6) auf beiden Segmentierungen.
- **Etappe 2 — Solver auf Szenen *(REALISIERT, select-v4)*:** Floor/Beats/Diversität/Redundanz pro Szene, Coverage pro Tag. **Korrektur des ursprünglichen Forward-Plans:** Der hier vorgesehene „Budget-Regler (v3) re-targeten / `floorCount` pro Szene" wurde **nicht** umgesetzt — das gesamte Budget-/`targetCount`-Modell ist durch den **τ-Grenznutzen** ersetzt (distributions-relativer Qualitäts-Floor, E13.2.1) plus **komposition-adaptive Diversitäts-Constraints** (E13.2.2). Der frühere Budget-Regler wird damit zum **τ-Regler (E13.3)**: ein *relativer* Offset um den Auto-Punkt, kein numerisches Budget. Opus, determinismus-kritisch. Umgesetzt + feld-abgenommen.

**Szenen-Algorithmus (deterministisch, E13-Umsetzungskonzept präzisiert Schwellen):** Szenen werden auf der **Repräsentanten-Sequenz** gebildet (nur Reps tragen `vlm.place/activity` — Stufe `vlm` taggt ausschließlich `repr===true`). Regeln: Grenze bei nachhaltigem `place`/`activity`-Wechsel (Glättung: Wechsel muss über `SCENE_MIN_RUN` Reps halten), GPS-Sprung als Korroboration; **Tagesgrenze ist harte Szenengrenze** (keine Cross-Day-Szene). **Vererbung:** Nicht-Repräsentanten erben die Szene ihres Cluster-Repräsentanten (`clusterId`); ein **untagged Repräsentant** (CLIP-Abstention) erbt die Szene des zeitnächsten getaggten Reps **innerhalb desselben Tags**, nie über Tagesgrenzen. Mindestszene in zeitlich näheren Nachbarn mergen. Alle Schwellen + Tie-Breaks (locale-basiert) fixiert, in `meta.scenes`-Snapshot geschrieben.

**Evidenz vorhanden:** Die frühere „Kapitel-Kontext-Review-Ansicht" ist inzwischen zur vereinheitlichten Arbeitssicht ausgebaut und abgenommen — sie liefert die Bewertungsfläche, auf der diese Architektur aufsetzt. E11 (Personen) und §14.B (LLM) bleiben nachrangig — die Diagnose belegt: das Problem ist strukturell.

**Ergebnis (v6 — realisiert + feld-abgenommen):**
- **E13.1** (Etappe 1): Tag+Szene-Segmentierung (`chapters-v3`, `scenes-v1`), Anzeige Tag→Szene→Items. Abgenommen.
- **E13.2.1** (`select-v3`): `applyMassQualityGuard` entfernt (war Ursache der Über-Restriktion: zwang τ bei `p80<0.6` auf ~0.70 → nukte komprimierte Normal-Bibliotheken). τ_auto **distributions-relativ**: `dryRun.eff`-Grenznutzenserie → normalisieren → Knie (nur echte Kante im mittleren Indexbereich) → sonst Keep-Quantil-Fallback (`TAU_KEEP_RATIO=0.85`), Clamp `[FLOOR_MIN_SCORE, TAU_MAX_SCORE]`. τ = *relativer* Qualitäts-Floor; die eigentliche Adaptivität liefert der Per-Szene-Malus + Cluster-Sperre.
- **E13.2.2** (`select-v4`): komposition-adaptive Diversitäts-Constraints + gedämpfter Szenen-Malus. **Konstanten EINGEFROREN** (kein weiteres τ-/Malus-/Nudge-Tuning ohne neuen Befund): `DIVERSITY_NUDGE=0.10`, `EPS_SHARE=0.01`, `LAMBDA_SCENE_BY_MODE{0.006/0.006/0.004}`; rare-Flag (`candShare ≤ ideal+EPS_SHARE` → Penalty 0, nie gegen Verfügbarkeit); `effTarget=max(ideal, candShare−DIVERSITY_NUDGE)` sonst; `availabilityPool = repr && ok && finite && !duplicate && !exclude`.
- **Feld-Abnahme** (diagnose__2_.json, 468 Fotos, 94 % Scenery): ~266 Auto-Picks → 237 final, Override-Quote 15 %, Richtung 32 Entfernen / 3 Zurückholen (großzügig, nicht unterselektiv); rare-P behalten. PO-Urteil: „Auswahl sehr gut, zurückholen quasi nichts."

**Offen (nach v6) — *Historischer Stand nach v6, durch v7 erledigt bzw. nachgeführt:*** *(E13.3/τ-Regler ist realisiert und browser-abgenommen — siehe Kopf + Changelog v6→v7; die folgenden Punkte sind der damalige Planungsstand und nur noch als Begründungs-/Befundhistorie zu lesen.)*
- **E13.3 — τ-Regler** (nächster Schritt, KONZEPT-first): `tauEffective = clamp(tauAuto + tauOffset, FLOOR_MIN_SCORE, TAU_MAX_SCORE)`, Default = Auto-Punkt; Reglerwert invalidiert NUR `select` (keine Re-Inferenz), persistent über Reload. **`maxPickCap` hart-vs-weich klären** — Ist-Zustand gegen Code (E13.2.2): für die **Auto-Auswahl HART** über alle drei Phasen (`capReached` wird in phaseFloor, phaseBeatHardening **und** phaseGreedy geprüft); **manuelle Includes** werden post-solve angewandt und können den Cap **sichtbar überschreiten** (nur dort weich). E13.3 entscheidet, ob diese Trennung bleibt. Zwei geprüfte Zusatz-Anforderungen: (a) **tote Slider-Hälfte** — sitzt `tauAuto` nahe `FLOOR_MIN_SCORE`, klemmt „mehr behalten" am Floor; „Mehr"-Pfad braucht echten Hebel (TAU_KEEP_RATIO lockern oder Kandidaten-Expansion); E13.3 prüft per Snapshot zuerst, WO `tauAuto` real liegt; (b) **Snapshot-Export** — Diagnose exportiert `selectParams` bislang nicht (nur in IDB), zeigt irreführend das Ideal-Target statt effektiv; E13.3 nimmt `tauAuto/tauOffset/tauEffective` + `effStreamTarget/rareStream` in den Diagnose-Export auf. (b) ist Vorbedingung für (a).
- **Qualitäts-/Redundanz-Follow-up** (§6.3/§14): Score-Kompression (Median ~0.54 / Max ~0.76) ist die Wurzel der schwachen Cross-Library-Adaptivität; `momentScore` (`W_MOMENT=1.0`) ist eng/niedrig. Der τ-Regler adressiert das NICHT (blunter Mengen-Hebel). Echte Qualitätsadaptivität braucht ein trennschärferes Signal (momentScore spreizen / Gewichte rebalancieren / Rank-Norm) — bewusst erst nach E13.3 und mit mehreren echten Bibliotheken. **Candidate Expansion** (§14.A): erst messen, dann entscheiden.

---

## Changelog

**v7 → v8 (Presets-Initial + E4a-Einstellungen-Tab + fokus-inline realisiert & browser-abgenommen; SoT-Reconciliation):**
- **Produktmodell-Standort korrigiert:** Auswahl-Einstellungen leben im **StartScreen** (Sektion `SelectionSettingsPanel mode='initial'`, vor dem Start) **und** im **Review** (Einstellungen-Tab) — nicht mehr „nur im Review". `screenMap` bleibt FROZEN `{start, processing, review}`; **kein** eigener Presets-Screen (Variante A verworfen).
- **Erstlauf-Korrektur:** Der erste Lauf nutzt die **gewählten** Presets statt Default `focus='balanced'`. Beleg: `s3_faces.js:46`/`readFocusFactor` (`:150`) liest `meta.presets.focus`; der StartScreen schreibt `putMeta('presets')` **vor** `SET_SCREEN processing` (`SET_PRESETS` ist reiner UI-Sync). `FOCUS_FACTORS.balanced` greift nur als Fallback bei fehlendem Wert.
- **E4a (Einstellungen-Tab):** `SelectionSettingsPanel` aus der Sidebar-Dauerstapelung in das Tab-Control `Einstellungen | Abdeckung | Diagnose` (`REVIEW_SIDE_TABS`, Default Abdeckung); Dirty-Dot am Tab + collapsed Toggle. Modus-/Recompute-Logik und Panel-Interna unverändert.
- **fokus-inline (Inline-Recompute):** „Auswahl neu berechnen" rechnet den Light-Pfad **inline** (`applySelectionSettings` → `runRecompute({heavy:false})`); nur echte Stage-Invalidierung nimmt den Heavy-Pfad (`recomputeNeedsHeavyPath`). Löst den v7-„offener UX-Punkt" (Sprung auf Processing).
- **§3.3-Vertrag bestätigt:** `meta.presets` ist die Pipeline-Quelle (beide Erstlauf-Consumer `s6_select.js:105` + `s3_faces.js:46` lesen META). Kein neues Schema, kein neuer Meta-Key, kein `app.js`/`screenMap`/Pipeline-Eingriff (reine Präsentations-/Persistenz-Schicht; Quellen: KONZEPT-Presets-Initial-StartScreen-v1.1, KONZEPT-Review-E4-HeaderIA-v1.1).
- **Reconciliation (diese Datei, docs-only):** Kopf-Stand, ABGENOMMEN-Log, §4-IA-Hinweis, §5 (Titel/Intro/Screen 1/2/4) und die v6→v7-Changelog-Klauseln auf den realisierten Stand gezogen. Eingefrorene v5-Prompts (§11, „PresetsScreen") bewusst **unverändert** + im §5-Intro als Altbegriff klargestellt. Dateiname-Hinweis: Datei heißt historisch „v7-v10", inhaltlicher Stand ist **v8**.

**v6 → v7 (E13.3 τ-Regler + Controls-IA realisiert & browser-abgenommen; Workset-Modell adoptiert):**
- **τ-Regler (E13.3, abgenommen):** persistierter **`tauSliderPos ∈ [−1,+1]`** (Default 0=Auto), datenabhängig um τ_auto (−1→`FLOOR_MIN_SCORE`, +1→`TAU_MAX_SCORE`; `floorGate` an `tauEffective`; inert bei Floor-Klemmung). `select-v4 → select-v5`, `selectParamsSchema: 'select-params-v3'`; `validateSelect`/`selectNeedsRecalculation` verlangen v5+v3+finite `tauSliderPos`. Phase 0 (Diagnose-Snapshot) + Phase 1 (Regler) container- und feld-/browser-abgenommen. Verträge §2/§3/§4 mitgezogen. *(Konstanten: `FLOOR_MIN_SCORE=0.35`, `FLOOR_SLACK=0.10`, `TAU_KEEP_RATIO=0.85`, `TAU_MAX_SCORE=0.90` — Solver-Mathe/`estimateTauAuto` eingefroren.)*
- **Controls-IA (Review-Controls v3, abgenommen):** *alle* Auswahl-Einstellungen ins **Review** (inkl. `focus`); `focus` invalidiert gezielt `['vlm','scenes','select']` über neuen `invalidateStages`-Helfer (Re-Derive aus Cache, **kein** Florence-2-Laden — verifiziert: `resetVlm` erhält Roh-Store), behebt zugleich die frühere `embeddings`-Über-Invalidierung. Stream-Klassifikation (`FOCUS_FACTORS`/`classifyStreamFromFaces`) in neutrales Single-Source-Modul `js/pipeline/streamClassification.js`. Draft-basiertes Panel + „Auswahl neu berechnen" (im Lauf gesperrt, kein Run-Stapel). **PresetsScreen auswahl-leer** *(in v8 durch Presets-Initial abgelöst — Einstellungen im StartScreen und Review)*; Flow-Copy „Weiter zur Verarbeitung". §4/§5 mitgezogen. *(Bekannter offener UX-Punkt: Neuberechnen springt auf Processing-Screen statt inline — **in v8 mit fokus-inline erledigt**.)*
- **Workset-Modell adoptiert (Kuratierung Phase A, beauftragbar, noch nicht realisiert):** §10.3-Ordner-Lifecycle ersetzt durch **Arbeitsmengen-Version** (`folderSignature` = `worksetSignature`, „schützt Version, nicht Ordner"); additive Kuratierung pre-processing; atomare Mutation + CAS (`worksetEpoch`/`worksetRevision`), `putPhotos` update-only, `HYDRATE_WORKSET`/Sperre/Recovery, expliziter Reset-Scope, **verlustfreie Legacy-Migration**, §4.9-Lebenszyklusregeln. Mechanik vollständig in KONZEPT-Kuratierung-Phase-A-v6.7 (11 Audit-Runden). §10.3 zeitlich abgegrenzt (BIS/AB Phase A); §11 E13.1 historisch markiert + „Nächste Etappe: Phase A — A-Core" vorangestellt; Lifecycle-Tests auf Arbeitsmengen-Semantik (A–H) umgestellt. §10.3/§10.5 als Zielvertrag markiert; operativ bis zur Realisierung weiter replace-basierter Ingest.

**v5 → v6 (E13.1 + E13.2-Kette realisiert/feld-abgenommen; Produktmodell Budget→τ; Design-Runde):**
- **Produktmodell der Selektion umgestellt:** fester `targetCount`/Budget → **τ-Grenznutzen** (distributions-relativer Qualitäts-Floor) **+ komposition-adaptive Diversitäts-Constraints** pro Szene. Solver szenenbasiert. `select-v1 → select-v4`. *(Verträge §2/§3/§4/§5/§10 mitgezogen; §15 Etappe 1+2 als realisiert markiert, Forward-Plan „Budget-Regler v3 / floorCount pro Szene" als überholt korrigiert.)*
- **§2 Pipeline:** Stufe 6 `select` neu beschrieben (globaler τ-Gate; Floor+Beats pro Szene modusabhängig; Greedy global mit Szenen-Malus + komposition-adaptiver Diversität; kein Tag-Budget-Pass; kein `targetCount`, optionales `maxPickCap` für Auto hart).
- **§3 Erzählmodell:** Ebenen-Split präzisiert (globaler τ-Grenznutzen gatet Greedy; Floor+Beats pro Szene; Konzentrations-Malus + Diversität/Redundanz szenen-/strombezogen; Tagesabdeckung emergent, kein Tag-Budget-Pass); Punkt 3 „select-v4 Floor/Beats pro Szene"; „beide Budgets" → „beide Ströme".
- **§4 Presets:** Preset 1 „Budget-Allokation" → Floor/λ(`LAMBDA_SCENE_BY_MODE`)/Beat-Härte, Floor jetzt pro Szene (`floorGate`); Preset 4 „Umfang/Zielanzahl→Budget" → **Auswahlmenge = Auto-Umfang via τ**, E13.3-Relativregler, optionales `maxPickCap`.
- **§5 Screen 4:** „Budget-Zähler picked/target" → Auswahl-Zähler (Umfang τ-bestimmt; Cap-Überschreitung durch manuelle Includes sichtbar).
- **§10.2:** `rejectReason 'budget'` annotiert (= hartes `maxPickCap`, nicht mehr `targetCount`). **§10 Re-Selektion:** Include-Vorrang gegen `maxPickCap` statt gegen Budget umformuliert.
- **§15:** Ergebnis-Block (E13.1/E13.2.1/E13.2.2) + eingefrorene Konstanten (`DIVERSITY_NUDGE=0.10`, `EPS_SHARE=0.01`, `LAMBDA_SCENE_BY_MODE{0.006/0.006/0.004}`, `TAU_KEEP_RATIO=0.85`) + Feld-Abnahme (468 Fotos → 237 final, Override 15 %) + offene Threads (E13.3 mit toter Slider-Hälfte + Snapshot-Export; Qualitäts-Follow-up Score-Kompression).
- **Stage-Versionen:** `select-v3` (τ distributions-relativ, Guard entfernt) → `select-v4` (komposition-adaptive Diversität). `chapters-v3`/`scenes-v1` unverändert.
- **Design-Runde abgenommen** (reine UI/CSS, vom Solver getrennt): Light-Mode Flächen-/Border-Kontrast, Dark minimal nachgeschärft, Caption auf Space Grotesk + Fade-Truncation + inline aufklappbar.
- **Befund festgehalten:** Auto-Punkt sitzt; nächster Bedarf = Nutzer-Mengensteuerung (E13.3), danach Qualitätsfilter. Slider ist bewusst *vor* den Qualitätsfilter gewählt; adressiert Qualität (Quasi-Dubletten/Fehlauslösungen) NICHT.
- **Review-Korrekturen (vor E13.3, gegen ZIP verifiziert):** (1) §15 Lösung/Wirkung-Block als Entwurfs-Rationale markiert + die jetzt-falschen „Budget/Floor auf Kapitel-Ebene"-Sätze korrigiert. (2) **`maxPickCap`-Ist-Zustand korrigiert** — für Auto **hart** über Floor/Beat/Greedy (`capReached` in allen drei Phasen), nur manuelle Includes weich; der Handover trug eine veraltete „nur Greedy/weich"-Falschbeschreibung. (3) §14 „Select-v2" → „select-vNext". **Zusätzlich selbst gefangen:** eigener v6-Fehler „Beats/Coverage pro Tag" in §2/§3 gegen Code richtiggestellt (Floor+Beats laufen **pro Szene**, Greedy global, kein Tag-Budget-Pass). **Noch offen (Code-Labels, in E13.3 mitnehmen, kein Logik-Eingriff):** `ExportScreen.js` user-facing „Select-v2-Parametern" → neutral; `selectors.js` Label-Map `budget:'Budget'` → extern „Mengenlimit/Cap" (interner Token `'budget'` bleibt).

**v4.6 → v5 (Segmentierungs-Verträge nachgeführt — Etappe 1 beauftragbar):**
- **§2 Pipeline:** neue Stufe `5b scenes` nach `vlm`, vor `select` (Szenenbildung aus Tag + Zeit + GPS + vlm.place/activity auf der Repräsentanten-Sequenz).
- **§10.1:** `js/pipeline/s5b_scenes.js`. **§10.2:** `sceneId: string|null` (`'scene-<chapterId>-<index>'`). **§10.3:** `meta.scenes`; Ordnerwechsel löscht es mit.
- **§10.4 Registry:** `scenes`-Eintrag (`implVersion:'scenes-v1'`, validateScenes, resetScenes, isStub:false, invalidates:`['select']`); **Invalidierungsketten** nachgezogen: chapters→`['scenes','select']`, technical→`[…'scenes','select']`, faces→`[…'scenes','select']`, embeddings→`['vlm','scenes','select']`, vlm→`['scenes','select']`. `chapters` implVersion→`chapters-v3` (v1/v2-Altzustände, inkl. G1-v2, werden invalidiert). Rhythmus-Regel auf `meta.chapters`+`meta.scenes` erweitert.
- **§10.5:** `SET_SCENES` (analog SET_CHAPTERS; Szenen-Gruppen frisch in selectors). **§10.8:** `scenes`-Reset (sceneId, meta.scenes, stageFails.scenes; vlm/embeddings/vlmRaw bleiben).
- **§5:** Arbeitssicht Tag/Kapitel → Szenen → chronologische Items; Dichte-Regler auf Tag-Ebene. **§6:** Segmentierungs-Determinismus-Gate (identische chapterId/sceneId, Szene strikt im Tag, Reload-identisch).
- **§15 präzisiert:** Etappe 1 = Struktur-/Review-Fix (nicht vollständiger Auswahl-Fix); Szenen auf Repräsentanten-Sequenz (nur Reps getaggt), Nicht-Reps erben via clusterId, untagged Rep via Zeitnähe innerhalb des Tags, keine Cross-Day-Szenen.
- **Scope konsolidiert:** Face-Clustering als s3b-Stub vorbereitet, nachrangig nach Segmentierung (Widerspruch Stand↔Scope-Tabelle aufgelöst).

**v4.5 → v4.6 (Review-Surface neu abgenommen; Segmentierungs-Architektur entschieden):**
- **Review-Surface vereinheitlicht (§5):** drei Tabs (Buchansicht/Kapitel-Kontext/Verworfen) → EINE Arbeitssicht; Picks + Verwürfe chronologisch verwoben, beide aktionierbar; Dichte-Regler (Aus/Knapp/Alle, Standard Knapp); Dubletten als Gruppen-Box mit Tausch (nie freie Strom-Items); Lightbox + Metadaten-Panel; Dark/Light-Theme-Toggle (persistiert); Hochformat ohne Crop; Aufnahmedatum auf Karten. Globaler Verwurfs-Grundfilter entfallen (kapitel-lokal).
- **Override-Minimalität (§10.8):** Aktion = Solver-Ursprung → kein Override (max. ein include/exclude pro Foto, Reset zum Ursprung statt „manuell"); swap/reorder unberührt.
- **EXIF erweitert (§10.2):** exifOptics um fNumber/iso/exposureTime (rohe Kamera-Trias) fürs Metadaten-Panel; Re-Ingest für Altbestand, kein DB_VERSION-Bump (additiv).
- **§15 Architektur entschieden:** Zwei-Ebenen-Segmentierung Tag (Kalendertag + Split/Merge) + Szene (inhaltsbasiert, NEUE Stufe nach VLM); gestaffelt (Etappe 1 Segmentierung+Anzeige, Etappe 2 Solver auf Szenen). Architektur-Konzept liegt, pending Audit. KONZEPT-Bump auf v5 mit Etappe 1.
- Budget-Regler (v3-Konzept, freigegeben) wartet hinter der Segmentierung; floorCount wird nach Etappe 2 pro Szene → re-targeten.


**v4.4 → v4.5 (Diagnose-Panel abgenommen; erste Qualitätsdiagnose; §15 Zwei-Ebenen-Rhythmus):**
- **Diagnose-Panel abgenommen:** deterministisches Panel + `diagnose.json` (rich, Whitelist-Export — laufzeitverifiziert ohne GPS/EXIF/vlmRaw/Embeddings/Thumbnails; Datenschutz-Hinweis sichtbar; ermöglicht Diagnose-Sammlung durch Dritte). Format `photobook-diagnose-v1`.
- **Erste Qualitätsdiagnose (Phase 1, ~500-Bilder-Ordner):** Auswahl auf den ersten Blick unbrauchbar. Befunde: (a) fast inhaltsgleiche Porträts gewählt UND direkt nebeneinander platziert; (b) erzählerisch wichtige Sequenz (ganzer Straßenumzug) fehlt; (c) „Kapitel sind eigentlich Szenen"; (d) Verworfene nicht im Kapitelkontext bewertbar. Solver-Code-Analyse bestätigt Mechanismus: phaseFloor zieht ein Bild PRO Kapitel → bei zu feinen Kapiteln Budget aufgefressen + Sequenzen zerstückelt; betterBase bevorzugt Score → Porträts schlagen erzählerisch wichtige, technisch unruhige Bilder; Cluster-Sperre greift nicht bei knapp getrennten Clustern.
- **§15 Zwei-Ebenen-Rhythmus (Szene ⊂ Kapitel)** als Vorhaben dokumentiert: Wurzelursache ist EINE überladene Rhythmusebene. Lösung: Dedup auf Szene, Budget/Beats/Coverage auf Kapitel. Layout-Synergie. Wird E13 (eigene Strukturetappe mit Vorkonzept).
- **Reihenfolge:** (1) Kapitel-Kontext-Review-Ansicht (knapp Verworfene einblendbar pro Kapitel eingewoben) — liefert Bewertungsfläche + Evidenz; (2) E13 Zwei-Ebenen; (3) Solver-Feintuning. **E11 + §14-LLM bestätigt nachrangig** — Diagnose belegt strukturelles, kein Personen-/Modellproblem. EdgeFace-Auftrag bleibt zurückgestellt.


**v4.3 → v4.4 (Diagnose-Panel beauftragt; §14 v2 Semantic Curation dokumentiert):**
- **§14 v2 Semantic Curation Layer** aufgenommen (aus Produkterkenntnis-Papier): Kernlücke ist das Produktmodell (mechanische vs. redaktionelle Auswahl), nicht ein größeres Modell. PO-Risiko-Trennung: 14.A deterministische Bausteine (Diagnose-Metriken, Candidate Expansion, Intent Brief, Evidence Cards/Context Packs — kein LLM, hoher Wert) vs. 14.B LLM-Kurator (hohe Abhängigkeit, Vorbehalte: Browser-LLM-Größe, Remote-Datenschutzbruch, Laufzeit-Grenzen — als letzte datengetriebene Eskalation). Leitprinzip 14.C „Diagnose vor Architektur".
- **Reihenfolge-Korrektur E11:** E11 (EdgeFace) hinter die Qualitätsdiagnose gestellt. Die Annahme „fehlende Protagonisten-Erkennung = zentrales Auswahlproblem" ist unbewiesen; ein billiger Mess-Schritt entscheidet E11 vs. Candidate Expansion, bevor die aufwendigste Etappe gebaut wird. EdgeFace-Auftrag bleibt fertig, zurückgestellt.
- **Diagnose-Panel beauftragt** (Abnahme ausstehend): deterministisches Panel + Export `diagnose.json` (rich: pro Bild Evidenz inkl. Caption/Tags/Scores/Cluster/Override-Historie; bewusst OHNE GPS/EXIF-Optik-Zeit/vlmRaw/Embeddings/Thumbnails/Bilddaten). Sichtbarer Datenschutz-Hinweis beim Export (informierte Zustimmung, kein technischer Zwang) — ermöglicht Diagnose-Sammlung durch Dritte. Liefert zugleich den §13.2-Proof-Layer-Kern.
- Nächster Ablauf: Diagnose-Panel abnehmen → Phase 1 Qualitätsdiagnose (echte Ordner, auch Dritte) → datenbasierte Entscheidung E11 vs. Candidate Expansion.


**v4.2 → v4.3 (Abnahme G0.5 + E12 — v1-Kernpipeline abgeschlossen):**
- **v1-Kernpipeline (E1–E12) funktional komplett.** Vollständige Kette Ingest → Technik → Kapitel → Faces → Embeddings → VLM → Selektion → Review/Coverage → Export, lokal/zero-build. Browser-abgenommen.
- **G0.5 abgenommen:** EXIF-Rohfelder additiv im Ingest (beide Lesepfade) — gps.alt/dir, exifOptics (focalLength/35mm/digitalZoom/lens/make/model), exifTime (dateTimeOriginalRaw/offsetTimeOriginal/gpsDateStamp/gpsTimeStamp). Kein DB_VERSION-Bump. inferredUtc/timeConfidence bewusst ausgelassen (v2-Ableitung). Konserviert die nur zur Ingest-Zeit verfügbaren Rohdaten für v2-Geo/POI.
- **E12 abgenommen:** Presets an state.presets gebunden + persistiert; Preset-Änderung nach Lauf invalidiert nur select (bzw. ab Fokus-Stufe), nie Re-Inferenz; „Neu berechnen"-Button. Export: Original-ZIP via fileMap mit Kapitel-Ordnern, Re-Attach nach Reload mit ID-Abgleich + Meldung fehlender Originale, selection.json (chronologisch, Schema {id,filename,chapter,beat,stream,scores:{tech,moment,smile},reason,overridden}, fehlende Felder null), druckbarer Kontaktbogen mit Kapitel-Trennern (Beat-Label via beats.js), Abnahmekriterium §6 (Override-Quote ≤ 30% → Bestanden/Nicht bestanden). JSZip 3.10.1 gepinnt. Sprachpolitur „N Picks → N Bild(er)".
- **E11-Modellentscheidung final** (Recherche ausgewertet): EdgeFace-XS (~6.9 MB, edgeface_xs_gamma_06.onnx) via onnxruntime-web (eigener Ladepfad, NICHT transformers.js). Lizenz CC-BY-NC-SA-4.0 — für privat + nicht-kommerzielle Veröffentlichung akzeptiert (kein Jurist; bei Release Lizenzkette prüfen). Vorverarbeitung 112×112, 5-Punkt-Alignment aus MediaPipe-Landmarks (Hauptrisiko), L2-norm 512-d, Cosine-Similarity ≥ 0.4 = Distanzschwelle 0.6 (KORREKTUR der alten 0.6-Annahme). AuraFace verworfen (261 MB), SFace-int8 verworfen (Reife-Warnsignal). Backend-Broker-Light (§13.1) in E11 integriert: persons-Stufe Rolle 'experimental', bei Modell-/Backend-Ausfall 'skipped' + Fallback + UI-Hinweis, nie still 'done'.
- Produktname: Arbeitstitel „Buchkurator" bleibt bis Release; finale Namenswahl (Verfügbarkeitsprüfung npm/GitHub/Domain) als Release-Aufgabe vertagt.


**v4.1 → v4.2 (Abnahme E10 + Privacy-Clear; v2-Architekturmuster dokumentiert):**
- **Etappe 10 (Coverage-Panel + Overrides) abgenommen:** CoveragePanel (Beat-Abdeckung pro Kapitel, Strom-Verteilung vs. Fokus-Ziel, Gesichts-Klassen-Diversität im Fallback-Modus mit Hinweis „ohne Personenerkennung"), Override-Quote live im Header (Warnung > 30 %), Beat-Lücken-Tooltip mit Sprung in gefilterte RejectedView, Override-Schema vereinheitlicht `{type, photoId, ts, prevReason}`, Overrides resume-fest in `meta.overrides`. Browser-Abnahme bestätigt.
- **Privacy-Clear-Button abgenommen:** StartScreen-Button (nur bei vorhandenen Daten), zweistufige Bestätigung ohne window.confirm, `clearAll()` + vollständiger State-Reset (inkl. RESET_PIPELINE gegen Desync), ObjectURL-Freigabe. Neue Reducer-Actions SET_OVERRIDES, RESET_PRESETS. Kein Auto-Clear — Resume-Betrieb unberührt. Klarstellung: Tool hat keinen Service Worker / keine Cache-Storage-API; einziger Persistenzort ist IndexedDB.
- **Beat-Terminologie zentralisiert:** neues `js/beats.js` als Single Source of Truth (BEATS-Reihenfolge + deutsche Labels); PickCard, CoveragePanel, ReviewScreen, selectors, s6_select importieren daraus. Beendet die wiederkehrende DE/EN-Label-Drift strukturell.
- **§13 v2-Architekturmuster** (aus Infinite-Edge-Agent-Analyse): Backend-Broker-Light (Rollen-/Status-Ehrlichkeit) **mit E11 vorgezogen**; Proof Layer (`curation-proof.json`) als Werkzeug nach E12; Context Pack Builder als v2 mit §12-captions zusammengeführt; lokaler Buchdramaturg als nachrangiger v2-Spike (facts-only). Explizite Streichliste (kein Chat-Agent, kein stilles Active-Learning aus Overrides → Determinismus-Schutz). Codebasis bewusst NICHT übernommen (Stack-Inkompatibilität).
- **E11-Produktentscheidung:** echtes Face-Clustering ist v1-relevant (Protagonisten vs. Fremde = erzählerische Hauptachse, §3-Soll), daher Option B (echte Umsetzung) statt No-op→v2 — vorbehaltlich Modell-Recherche (Browser-Reife eines freien ≤10 MB Face-Embedding-Modells via onnxruntime-web). Reihenfolge: G0.5 + E12 zuerst (v1 exportierbar), E11 als letzte große Etappe, damit ihr Modellrisiko v1 nicht blockiert.
- Parkliste: Sprachlabel-Politur (z. B. „N Picks" → „N Bilder") ergänzt; gebündelt bei/nach E12.


**v4.0 → v4.1 (Abnahme Etappe 9 + G1; G0→G0.5-Erweiterung):**
- **Etappe 9 (narrative Selektion) abgenommen:** s6_select.js (`select-v1`), zweiphasige Auswahl (Floor + Greedy mit Konzentrations-Malus λ), Score-Normalisierung pro erreichbarem Maximum (verhindert systematische S-Bild-Benachteiligung), Beat-Zuordnung (establishing/action/detail/hero/transition), harte Cluster-im-Kapitel-Invariante, Strom-Balance-Strafe, Budget = targetCount. `redundant` als Kapitelsättigung neudefiniert (alte Cluster-Kopplung war vakant). Aussortiert-Reaktivierung: Verworfen-Ansicht filtert nach rejectReason, Solver-Rejects (budget/redundant/stream) reaktivierbar via include-Override (Vorrang vor Budget, Zähler „N manuell zusätzlich"), Duplicate nur via Cluster-Swap. 0-Kandidaten-Semantik `selectDone([])===true` mit Snapshot. Browser-Abnahme: Determinismus, Chronologie, Preset-Re-Run ohne Re-Inferenz, Reaktivierung, Budget-Zähler — alle bestätigt. Verifiziert durch eigene Container-Logiktests (Determinismus, Cluster-Invariante, Budget, 0-Kandidaten, hero-Beat, target≥N).
- **Runner-Sync-Fix:** runPipeline dispatcht nach Abschluss `UPDATE_PHOTOS` mit dem mutierten photos-Array → Solver-Ergebnisse (picked/beat/reason/rejectReason) erreichen state.photos, ohne den Stage-Aufruf zu ändern. (select ist die erste Stufe, deren Ausgabe ausschließlich über state.photos ins UI muss.)
- **Beat-Terminologie vereinheitlicht:** Solver-reason-Strings deutsch (Aufmacher statt Establishing), deckungsgleich mit PickCard-Badges.
- **G1 Kapitel-Härtung abgenommen** (chapters-v2): Min-Gap 60s, lokale Tagesgrenze als hartes Trennsignal, Plausibilitätskorridor ceil(N/200)…ceil(N/3); harte Signale (Tagesgrenze/GPS) können nie durch die Korridor-Obergrenze wegoptimiert werden. Verifiziert durch Container-Vertragstests.
- **G0 → G0.5 erweitert** (Forschungspapier-Empfehlung): zusätzlich zu gps.alt/dir nun exifOptics (focalLength/35mm/digitalZoom/lens/make/model) und exifTime (dateTimeOriginalRaw/offsetTimeOriginal/gpsDateStamp/gpsTimeStamp) — alles ROHFELDER. PO-Entscheidung: inferredUtc/timeConfidence bewusst NICHT im Ingest (Ableitungen → v2-SunEvidence, aus Rohfeldern reproduzierbar). Begründung: Ingest konserviert, interpretiert nicht; hält den Ingest versions-/abhängigkeitsstabil.
- **v2 Geo/POI-Forschungspaket dokumentiert:** Evidenz-Scoring (accept/cautious/generic/none), OSINT-Methodentransfer, externe Quellen (Nominatim/Wikipedia/Wikidata/Overpass — Re-Verifikation bei Beauftragung zwingend), False-POI-Claim-Rate < 5% als harte v2-Metrik, lokales LLM nur als facts-only Polisher. v1-Pipeline unverändert.
- **Parkliste:** Embeddings-Init-Anzeige-Glitch (kosmetisch) ergänzt; E7-Review-Anforderung (Aussortiert-Tab) durch E9 erfüllt.


**v3.9 → v4.0 (Abnahme E8.2 + E8.5 + Chip-Fix):**
- **E8.2 Zero-Shot-Ableitung abgenommen** (Browser): Text-Tower (`text_model_fp16.onnx`, Checkpoint `Xenova/clip-vit-base-patch16@342fdf2`) lädt; P19-Single-Model-Disziplin verifiziert (Text-Tower vor Florence erzeugt+entladen); `vlm-v3` → `done`; Re-Ableitung ohne Re-Inferenz (vlmRaw + meta-Assets bleiben); Determinismus bestätigt (zweiter Lauf identisch, kein Text-Tower-Re-Download). Schwellen-Kalibrierung am realen Foto-Mix: TAU_ABS 0.22 / TAU_MARGIN 0.01 / EPS_DECISION 0.005 bestätigt — Margin-Gate greift korrekt (Portrait `indoor` 0.235 > TAU_ABS, aber Margin < 0.01 → null). `imgEmbeddingNorm` = 1.0 (sauber normalisiert). Keine Schwellen-Änderung; bei künftig zu hoher Null-Rate ist TAU_ABS 0.21 der erste Justierungsschritt.
- **E8.5 Pipeline-Reset abgenommen:** `RESET_PIPELINE`-Action; Re-Ingest setzt `pipeline.status` zurück → Auto-Start im ProcessingScreen greift wieder. Binärer folderSignature-Mechanismus bewusst unverändert (inkrementelles Mergen = spätere Etappe).
- **PickCard-Chip-Fix abgenommen:** doppelter „M-Anker"-Chip entfernt (redundanter `pick-anchor`-Span gelöscht).
- **PO-Entscheidungen Roadmap:** E9 mit Fable (hoch), Opus (extra) als dokumentierte Eskalation bei Nicht-Determinismus/Constraint-Verletzung. G0 + G1 getrennte Sessions (parallelisierbar; nur G1 blockiert E9). Aussortiert-Tab (E7-Review-Anforderung) wird in E9 gebündelt, da er Solver-`rejectReason`-Werte braucht.


**v3.8 → v3.9 (v2-Vorbereitung Geo/POI — kein v1-Scope-Change):**
- Neuer §12 (v2-Ausblick): Geo/POI-Anreicherung + Bildunterschriften. Architektur-Skizze: zwei künftige Stufen `geo`/`captions` im bestehenden §10.4-Vertrag; Quellen Nominatim (1 req/s, Attribution, ODbL), Wikipedia GeoSearch (Extracts als Textrohmaterial), Overpass (POIs + wikidata-Brücke); Disambiguierung über E8.2-Zero-Shot gegen E6-Bild-Embeddings statt neuer ML-Infrastruktur.
- Neuer §9.6 (Netzwerk-Grundsatz): Opt-in, nur gerundete Cluster-Zentroiden, nur CORS-fähige Dienste mit Cache-erlaubenden Bedingungen (schließt Google Places aus).
- Mini-Auftrag G0 (vor E9, Sonnet, niedrig): exifr liest zusätzlich GPSAltitude/GPSImgDirection; gps-Objekt additiv {lat, lon, alt, dir}; kein DB_VERSION-Bump. Begründung: Originale session-gültig (§9.3) — spätere Nachrüstung kostete Re-Attach + Re-Parse pro Bestand. GPSHPositioningError bewusst weggelassen (YAGNI).
- §10.2 gps-Typedef erweitert (Leser-Regel: undefined wie null); §10.3 um geplanten Store `geo` annotiert; §1-Tabelle: Reverse-Geocoding bleibt in v1 draußen, Verweis auf §12.
- Bewusst offen (12.3): Textformulierungs-Weg (Template / lokales LLM / externe API), GPX-Interpolation, Lizenzfolgen.

**v3.7 → v3.8 (E8-Inferenzarchitektur + E8.2-Freigabe; v3.8 wurde nicht separat als reine E8-Fassung publiziert):**
- E8 Florence-2-Inferenzarchitektur steht und ist code-reviewed: zwei Task-Tokens `<MORE_DETAILED_CAPTION>` + `<OD>`, neuer IDB-Store `vlmRaw` (DB_VERSION 2), zweistufige Idempotenz (vlm/stageFails überspringt Photo, vlmRaw überspringt Inferenz), Batch-/Abort-Semantik, Fehlerebenen §5.6, Registry `vlm-v1`, konservativer Reset (vlmRaw bleibt). models.js-Ein-Modell-Regel eingehalten.
- E8.1-Diagnose: Caption-Keyword-Matching für `place`/`activity` strukturell unterlegen (Plurale/fehlende Begriffe: `mountains≠mountain`, `bread`, `motorcycle`). Jede Diagnoserunde findet neue Lücken.
- **E8.2 freigegeben (in Umsetzung, Browser-Abnahme ausstehend):** Umstieg auf Zero-Shot-Klassifikation für `place` (7) und `activity` (11) über die vorhandenen E6-CLIP-Bild-Embeddings. Entscheidungen P11–P19 verbindlich:
  - P11: Zero-Shot statt Keyword-Listen für place/activity (teure Hälfte — Bild-Embeddings — ist via E6 bereits bezahlt; nur 65 einmalige Text-Encodings + 18 Skalarprodukte/Bild).
  - P12/P19: Text-Embeddings einmalig im Browser mit dem E6-Checkpoint erzeugt, im meta-Store persistiert; CLIP-Text-Tower vor Florence-Load erzeugen/entladen (nie zwei Modelle parallel).
  - P13: `shotType` bleibt geometrie-/caption-basiert (Bildausschnitt ist CLIP-Schwäche).
  - P14: `mood` bleibt hybrid (faces.smile + kleine Caption-Listen).
  - P15: `momentScore` gewichtete Form mit `visualRoleScore`; kein Aesthetic-Kopf.
  - P16: Asset-Schlüssel = modelId:revision:transformersVersion:textDtype:promptsVersion; Mismatch → Neuerzeugung, sonst StageError (fail-fast statt stiller Müll-Tags).
  - P17: TAU_ABS/TAU_MARGIN getrennt pro Feld kalibriert (activity unschärfer → höhere Null-Rate erlaubt).
  - P18: Epsilon-Stabilitätsregel (EPS_DECISION) — Entscheidungen nahe Schwelle → null; Determinismus-Gate auf persistierte Tags, nicht Float-Werte.
  - implVersion-Ziel `vlm-v3`; `embeddings.invalidates += 'vlm'`.
  - **Diese Begründung ist festgehalten, damit der Zero-Shot-Ansatz bei künftigen Diagnoserunden nicht versehentlich auf Keyword-Matching rückabgewickelt wird.**
- Bekannte akzeptierte Verzerrung: Landmark-/Sightseeing-Bilder clustern im momentScore hoch (Mehrfachzählung über activity/place/visualRole) — von E9-Coverage-/Redundanz-Zwängen aufgefangen.


- Etappe 7 abgenommen: Review-UI-Grundgerüst (ReviewScreen, PickCard, ClusterOverlay, RejectedView), Buchansicht + Verworfen-Tab, Override-Actions (TOGGLE_PICK/SWAP_PICK/MOVE_PICK), Override-Quote-Anzeige.
- select bleibt Stub; temporäre Auswahl aus repr=true, im UI klar gekennzeichnet. Keine Pipeline-/DB-Änderung.
- Neue E9-Anforderung aus Review: dritter „Aussortiert"-Tab mit Reaktivierung von Solver-Rejects (siehe Parkliste).

**v3.5 → v3.6 (Abnahme Etappe 6):**
- Etappe 6 abgenommen: CLIP-Embeddings (clip-vit-base-patch16), greedy Near-Dup-Clustering (cosine ≥ 0.92, < 10 min), Repräsentantenwahl, `N ähnlich`-Badge.
- models.js eingeführt: loadModel/unloadModel/hasWebGPU, WebGPU→WASM-Fallback, max. ein Modell gleichzeitig (§10.6).
- Transformers.js 3.8.1 gepinnt.

**v3.4 → v3.5 (Abnahme Etappe 5):**
- Etappe 5 abgenommen: MediaPipe FaceLandmarker, P/S/M-Split, Blink/Smile, GPU→CPU-Fallback, Fokus-Faktor aus meta.presets.
- faces.invalidates um `persons` ergänzt (logisch korrekte Abhängigkeit, in Implementierung entdeckt).
- runner.js: stage.reset() wird vor stage.run() aufgerufen wenn implVersion-Mismatch — verhindert Per-Foto-Idempotenz-Blockade bei Version-Bumps (hotfix2).
- s1_technical.js: sharpnessScore() auf 3×3-Grid-Max umgestellt (hotfix1), implVersion → technical-v2.

**v3.3 → v3.4 (Abnahme Etappe R):**
- Etappe R abgenommen: alle v3.3-Verträge verifiziert (Registry, Runner-Skip-Logik, StageError, Stubs=skipped, stageFails-Disziplin, Catch-Fix, Kapitel-Rekonstruktion).
- Pending-Marker-Muster der R-Session als §10.3-Vertrag kodifiziert (schließt die Abbruchkante beim Ordnerwechsel, die der reine Signatur-Vergleich nicht erkennt).

**v3.2 → v3.3 (viertes Review — Konsistenz-Nachführung, freigegeben):**
- §10.1: s3b_persons.js in Dateistruktur (Stub ab R, echte Logik E11); Etappe R registriert persons als Stub.
- 6-Stufen-Altformulierungen (E3-Prompt, R-Prompt) auf 7-Stufen-Registry-Sprache korrigiert.
- stageFails-Lösch-Regel: nur eigener Key per delete, Objekt nie als Ganzes überschreiben.
- technical.invalidates-Begründung ergänzt (faces bewusst ausgenommen).

**v3.1 → v3.2 (drittes Review — final für Etappe R):**
- §9.5 Idempotenz auf BERECHNET-Vertrag korrigiert (letzter Alt-Wortlaut).
- `persons` (3b) als Stub-Stufe in §2-Tabelle und Registry aufgenommen — bis E11 `skipped`.
- `technical.invalidates` auf ['embeddings','vlm','select'] korrigiert; invalidates-Listen explizit und vollständig, keine transitive Auflösung im Runner (bewusst: Graph-Resolver wäre eigene Fehlerquelle).
- Kapitel-Regel: keine persistierten Kapitelgruppen außerhalb meta.chapters; Ableitungen frisch via selectors.js.
- `reset(photos, db, context?)`: optionaler Kontext {reason, changedPhotoIds}; ohne Kontext konservativ, aber korrekt (resetVlm definiert beide Pfade).
- Deterministische Re-Selektions-Reihenfolge + Budget-Regel: Include-Overrides haben Vorrang vor Budget, sichtbare Überschreitung statt stillem Verdrängen.
- E7: vorläufiges picked=true explizit als Nicht-select-done markiert; E4 als historisch gekennzeichnet; Lifecycle-Test E (Persistenzfehler) ergänzt.

**v3.0 → v3.1 (Konsolidierung nach zweitem Review):**
- §9.4/§10.4-Widerspruch beseitigt: Einzelbildfehler einheitlich via stageFails (Ergebnisfeld bleibt null); photo.status schreibt nur der Ingest.
- STAGES-Registry als einzige Wahrheit: implVersion, validate, reset, isStub, invalidates pro Eintrag; Rückgabevertrag {done|skipped} + StageError.
- Downstream-Invalidierung mit Kosten-Regel: Resets löschen nur Ableitungen, nie pixel-basierte IDB-Artefakte — verhindert Stunden-Re-Inferenz nach billigen Änderungen.
- Neuer §10.8: Cleanup-Tabelle pro Stufe inkl. Override-Politik (include/exclude erneut anwenden, reorder verfällt).
- Ingest-Persistenzfehler als eigener Ingest-Fehlerzustand (keine Pipeline-Stufe); stageFails als Record<string,string> (bewusst ohne ts/recoverable — YAGNI).
- DoD-Blöcke konkret in Etappen 5/6/8/9/11; E12 über Invalidierungsmechanismus; E4-Wiederabnahme mit Robustheits-Mindestkriterien.

**v2.3 → v3.0 (Rebaseline nach externem Review):**
- Externes Review verifiziert und im Kern bestätigt: 5 Blocker, davon 4 auf zu schwache Konzept-Verträge zurückführbar (Per-Stage-Zustand, Stub-Semantik, Ordner-Lifecycle, Persistenzfehler-Semantik fehlten), 1 lokaler Bug.
- §10.2: generisches `stageFails`-Feld (statt N Status-Felder pro Stufe) — löst die null-Mehrdeutigkeit einheitlich.
- §10.3: Ordner-Lifecycle-Regel (Signatur schützt den Datenbestand, nicht nur den Pipeline-State) + Persistenzfehler = Stufenfehler.
- §10.4: Per-Stage-pipelineState mit implVersion + Validatoren; Stubs nie `done`, nur `skipped`; Legacy-Invalidierung.
- §11: Definition-of-Done-Block + Lifecycle-Abnahmetests für alle Pipeline-Etappen; Etappe R (Opus, hoch) als Einschub vor Etappe 5; Kapitel-Tuning auf Parkliste vor Etappe 9.

**v2.2 → v2.3 (Abnahme Etappe 3):**
- §10.3: `pipelineState` an `folderSignature` gebunden (Fund der E3-Session als Vertragsregel).
- §10.7: Typedef-Ergänzungen in ctx.js in jeder Etappe zulässig.
- E4-Prompt: Retry-Button bei Pipeline-Fehler ergänzt.
- Stubs-ohne-Verzögerung und chronologische Sortierung der Vorschau abgenommen.

**v2.1 → v2.2 (Abnahme Etappe 2):**
- §10.2: Feld `failReason` ergänzt — lesbarer Ingest-/Verarbeitungsfehler pro Bild, Resume-fest, getrennt von `rejectReason` (Selektionssemantik). Kein DB_VERSION-Bump nötig.
- §10.7: Worker-Regel kodifiziert — kein `deps.js`-Import im Worker; CDN-URLs per init-Message aus deps.js-Konstanten (Abweichung 1 der E2-Session als Vertragsbestandteil übernommen).
- Abweichung 2 (voller Decode statt resizeWidth) akzeptiert: schema-korrekt, Prompt war überspezifisch.
- Offene Auflage: libheif-URL/Export-Form im Browser verifizieren (Abnahme-Checkliste).

**v2.0 → v2.1 (Modell-/Denktiefen-Kalibrierung):**
- Denktiefen-Skala (niedrig/mittel/hoch/extra/max) pro Etappe vergeben; nirgends max/extra als Default — Design ist per Vertrag geschlossen, Quota gehört in zweite Anläufe statt Über-Reasoning.
- Etappe 2 auf Denktiefe hoch: libheif-WASM im Worker als riskanteste Integration erkannt; Prompt um dreistufige HEIC-Fallback-Leiter ergänzt, exifr verbindlich gepinnt.
- Etappe 8: sachliche Lücke geschlossen — Florence-2 hat keinen JSON-/VQA-Mode; strukturierte Felder werden deterministisch aus <MORE_DETAILED_CAPTION> + <OD> abgeleitet (Ableitungsregeln im Prompt spezifiziert).
- Etappe 9: Fable mit Denktiefe hoch statt max (Algorithmus liegt spezifiziert vor); Fallback Opus mit extra.
- Etappe 11: Modell-Verfügbarkeit per Websuche in der Session verifizieren statt raten.
- Etappe 6 auf hoch (transformers.js-Versions-/Backend-Fallen).

**v1.4 → v2.0 (Architektur-Baseline):**
- Etappe-1-Code als verbindliche Baseline übernommen (deps.js/ctx.js/app.js-Reducer/Tokens).
- Neu §9 Grundsatzentscheidungen: nur Ingest im Worker (ML auf Main-Thread), Metadaten-only-State, Session-Gültigkeit der Originale, Fehler pro Bild, Idempotenz.
- Neu §10 Verträge: finale Dateistruktur mit Etappen-Zuordnung, vollständiges Photo-Datenmodell mit schreibender Etappe, IndexedDB-Schema, Pipeline-Stufen-Kontrakt, State-Regeln, Modell-Loader, Konventionen.
- Alle Etappen-Prompts (2–12) neu geschrieben: explizite NEU/ÄNDERN/NICHT-ANFASSEN-Listen, Vertragsverweise, konkrete Konstanten.
- Etappen umgeschnitten: Runner-Skelett in E3 vorgezogen; Face-Clustering als eigene Pipeline-Stufe s3b.

**v1.0 → v1.4:** siehe frühere Stände (Funnel-Reihenfolge, HEIC, Abnahmekriterium, Auswahlprinzip-Preset, Chronologie-Ordnungsprinzip).
