# STATUS — photobook-presets-initial-startscreen-v2

Basis: `photobook-review-fokus-inline-v1`.
Branch/Delta: `photobook-presets-initial-startscreen-v2`.

## Umsetzung
- `js/components/SelectionSettingsPanel.js` aus `photobook-presets-initial-startscreen-v1` 1:1 übernommen.
- `js/screens/StartScreen.js` aus `photobook-presets-initial-startscreen-v1` 1:1 übernommen.
- `js/screens/ReviewScreen.js` aus `photobook-review-fokus-inline-v1` genommen und nur die Panel-/Helper-Extraktion auf `../components/SelectionSettingsPanel.js` angewandt.
- `css/main.css` aus `photobook-review-fokus-inline-v1` unverändert übernommen; keine additiven CSS-Regeln nötig.

## Erhaltene E4a-/fokus-inline-Invarianten
- `REVIEW_SIDE_TABS` enthält weiterhin `settings | coverage | diagnostics`.
- `SelectionSettingsPanel` bleibt im `settings`-Tab-Panel; es wurde nicht über die Tabs zurückgehängt.
- Sidebar-Toggle nutzt weiterhin `Werkzeuge einblenden` / `Werkzeuge ausblenden` für `aria-label` und `title`.
- Fokus-Apply bleibt inline: `runRecompute({ heavy: false });` ist erhalten.

## Erstlauf-Lesepfad Presets
- `focus` wird im Erstlauf aus `meta.presets` gelesen: `s3_faces.js` über `readFocusFactor(db)` mit `db.getMeta('presets')`.
- Die übrigen Auswahlparameter werden in der Select-Stufe aus `meta.presets` gelesen: `s6_select.js` über `db.getMeta('presets')`.
- Es wurde keine Pipeline-Logik geändert.

## Verifikation
- Diff vs. Basis: genau neue Datei `js/components/SelectionSettingsPanel.js`; geändert sind `js/screens/ReviewScreen.js` und `js/screens/StartScreen.js`; `css/main.css` identisch.
- `js/screens/StartScreen.js` und `js/components/SelectionSettingsPanel.js` sind byte-identisch zur v1-Lieferung.
- Anti-Schein-Extraktion leer:
  - `grep -nE "function SelectionSettingsPanel|const SelectionSettingsPanel" js/screens/ReviewScreen.js`
  - `grep -nE "from './ReviewScreen.js'|from '../screens/ReviewScreen.js'" js/components/SelectionSettingsPanel.js`
- `node --check` über alle `js/**/*.js` grün.
- FROZEN byte-identisch gegen Basis: `s6_select.js`, `app.js`, `s3_faces.js`, `presetInvalidation.js`, `runner.js`, `streamClassification.js`, `db.js`, `ProcessingScreen.js`.
