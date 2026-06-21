# KONZEPT — Review Header-/Sidebar-IA (E4)

**Version:** v1.1 (Reviewer-Audit eingearbeitet)
**Status:** E4a freigegeben — beauftragbar. E4b sinnvoll, danach. E4c erst nach korrigierter Override-Affordance (siehe §3c/§4).
**Basis (maßgeblicher Stand):** `photobook-review-e3-tabs-v1`
**Scope:** Präsentation/Review (`js/screens/ReviewScreen.js`, `css/main.css`). Keine Pipeline-/Solver-/Schema-Eingriffe.

---

## 1 — Problem / Ziel
Header und Sidebar des Review-Bildschirms wirken unruhig, und die Sidebar erzwingt unnötigen Scroll (vom PO benannt). E4 konsolidiert die IA von Header und Sidebar — Anordnung/Optik, keine Funktionsänderung.

## 2 — Ist-Diagnose (verifiziert, Stand e3)

### 2.1 Header (`review-header`, Z1704)
`<div class="review-counters">` (Z1715) mischt drei Funktionsklassen in einer Reihe: *Info* (zwei Zähler, Z1716-1724), *Ansichts-Werkzeug* (`GalleryViewControl` Fit/Größe, Z1726), *Aktionen* (bedingter „Neu berechnen" Z1729 + „Export" Z1732). Links ein langer `screen-subtitle` (Z1709-1712). Status-Kanal korrekt darunter (Z1740).

### 2.2 Ansichts-Steuerungen örtlich getrennt
Galerie-Controls im Header (Z1726); Dichte-Regler `off/near/all` im Content — globaler Regler über der Kapitelliste (`ContextModeControl value=globalContextMode`, Z1785) plus Pro-Kapitel-Override je Kapitel-Header (Z744). Modus-Logik sauber: `globalContextMode` (Default `near`, Z1362) + `contextModeByChapter` (Z1361); effektiv `contextModeByChapter[key] || globalContextMode` (Z1669); globaler Regler resettet Overrides (Z1679-1680). Logik bleibt unangetastet; Thema ist die getrennte Verortung zweier verwandter Ansichts-Steuerungen.

### 2.3 Sidebar (`review-sidebar`, Z1810) — Scroll-Ursache
Responsiver Container aus E2.1: **angedockt ≥1160px, Overlay darunter, Toggle** (`sideCollapsed`, Z1813). Im `review-side-stack` (Z1823) dauerhaft gestapelt: `SelectionSettingsPanel` (langer Einstellungs-Block, Z1824) **über** dem E3-Tab-Control `Abdeckung | Diagnose` (Z1834). Da der Einstellungs-Block immer über den Tabs steht, addiert sich die Höhe → Scroll.

### 2.4 Recompute-Duplikat (vom Reviewer ergänzt)
Bei `needsRecalc` existiert „Neu berechnen" zweifach: im Header (Z1729) **und** im Status-Kanal (Z1751, `action='recalculate'`). Redundanz, die E4b auflösen muss.

## 3 — IA-Vorschlag (Etappen)

### E4a — Einstellungen in den Tab-Container (reduziert Summen-Scroll)
`SelectionSettingsPanel` wandert aus der Dauer-Stapelung in das bestehende Tab-Control: **`Einstellungen | Abdeckung | Diagnose`** (drei Tabs, eines sichtbar).
- **Wirkung korrekt formuliert:** die Sidebar-Höhe reduziert sich auf das aktive Einzelpanel; der unnötige Summen-Scroll (Settings + Coverage/Diagnose gestapelt) entfällt. Auf kleinen Viewports/bei langem Settings-Panel kann *innerhalb* des aktiven Panels weiterhin Scroll nötig sein — das ist kein Regress.
- **E2.1 bleibt unangetastet:** Docked/Overlay/Collapse-Verhalten byte-/verhaltensgleich. E4a ändert **nur den Inhalt** der Sidebar (Content-IA), nicht den responsiven Container. Einzige Drawer-nahe Änderung: das Toggle-Label von „Einstellungen ein-/ausblenden" zu „Werkzeuge ein-/ausblenden" (bzw. „Inspektor …").
- Default-Tab: **Abdeckung** (Inspektor-Information ist der erste Blick; Einstellungen sind Arbeitsmittel, über Dirty-Dot auffindbar). Kein Meta-Key, kein Sticky über Reload — Session-State im gemounteten Review genügt.
- Dirty-Zustand (`settingsDirty`/`needsRecalc`) am Einstellungen-Tab **und** am collapsed Toggle; der Dot braucht zugänglichen Text (nicht nur visuell).

### E4b — Header entzerren (danach)
Header + kompakte Toolbar statt einer gemischten Reihe: Titel/kurzer Subtitle oben; darunter Toolbar mit Info-Zählern, Ansichts-Werkzeugen, Export. Reduziert Höhe und semantische Mischung. **Recompute-Duplikat auflösen:** „Neu berechnen" primär im Status-Kanal (bzw. Settings) halten; im Header nur als sekundäre Aktion, wenn kein Status-Banner sichtbar ist. `screen-subtitle` kürzen (Kerngedanke), Detailtext in dezenten Info-Hinweis.

### E4c — Ansichts-Steuerungen zusammenführen (erst mit korrigierter Affordance)
Globalen Dichte-Regler (Z1785) in die Header-/Toolbar-Werkzeugzone neben die Galerie-Controls ziehen.
- **Korrektur (Reviewer):** Der Pro-Kapitel-Override darf **nicht** „nur bei Abweichung sichtbar" sein — sonst kann der Nutzer keine *neue* Abweichung setzen (Funktionsverlust, widerspräche §5). Stattdessen: pro Kapitel bleibt **immer ein kleiner Auslöser** sichtbar (Icon/Button „Dichte für dieses Kapitel"); die volle Segmentleiste erscheint bei Fokus/Klick/expanded **oder** wenn das Kapitel vom globalen Modus abweicht. Hover-only reicht nicht (Touch + Tastatur).

## 4 — Entscheidungen (nach Reviewer-Audit festgelegt)
1. **E4a Default-Tab:** Abdeckung. Kein Sticky/Meta-Key.
2. **E4a vs. E2.1:** beibehalten, **nicht** ersetzen. Nur Content-IA + Toggle-Label.
3. **E4c Override:** immer kleiner Auslöser pro Kapitel; volle Leiste bei Fokus/Klick/Abweichung. (Macht E4c erst nach dieser Definition beauftragbar.)
4. **Reihenfolge:** E4a jetzt, eigenständig. E4b danach. E4c zuletzt.

## 5 — FROZEN / Scope
Keine Änderung an Modus-Logik (`globalContextMode`/`contextModeByChapter`/`normalizeContextMode`), `recomputeNeedsHeavyPath`/Inline-Recompute, `SelectionSettingsPanel`-Interna (Form/Props), Solver, Pipeline, `db.js`, Schema, `FOLDER_META_KEYS`. E4a/b/c sind Umhängungen vorhandener Komponenten + CSS. Tab-Optik konsistent mit dem polierten Segment-/Tab-Stil (flach, eckig, kein erhöhter Schatten-Block). Responsive Drawer-/Overlay-Verhalten byte-/verhaltensgleich.

## 6 — DoD für E4a
Ändern nur: `js/screens/ReviewScreen.js`, `css/main.css`. (`CoveragePanel.js` nicht nötig — bleibt `collapsible={false}` im Tab wie aus E3.)
1. `REVIEW_SIDE_TABS` enthält `settings`, `coverage`, `diagnostics`.
2. `SelectionSettingsPanel` wird **nicht** mehr oberhalb der Tabs gerendert, sondern nur im `settings`-Tab-Panel.
3. Props und interne Logik von `SelectionSettingsPanel` unverändert.
4. `activeSideTab`-Default `coverage`; `normalizeReviewSideTab`-Fallback `coverage`.
5. Dirty-Zustand am Settings-Tab **und** am collapsed Toggle; Dot mit zugänglichem Text (z. B. visually-hidden Label / aria), nicht nur visuelles Zeichen.
6. `CoveragePanel` bleibt `collapsible={false}` im Tab.
7. `DiagnosticsPanel` unverändert.
8. Sidebar-Toggle-Label nicht mehr „Einstellungen", sondern „Werkzeuge"/„Inspektor" (aria-label + title + sichtbarer Text konsistent).
9. Responsive Docked-/Overlay-/Collapse-Verhalten unverändert.
10. `node --check` grün; Diff-Scope exakt ReviewScreen + CSS; FROZEN byte-identisch (insb. Modus-/Recompute-Logik, SelectionSettingsPanel-Interna).
