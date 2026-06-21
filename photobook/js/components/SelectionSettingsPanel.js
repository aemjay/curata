// js/components/SelectionSettingsPanel.js
// Shared selection settings panel for Review and initial StartScreen presets.

import { h, htm as _htm } from '../deps.js';
const html = _htm.bind(h);

export function normalizePresets(raw) {
  const selectionMode = ['chronicle', 'balanced', 'highlights'].includes(raw?.selectionMode) ? raw.selectionMode : 'balanced';
  const focus = ['people', 'places', 'balanced'].includes(raw?.focus) ? raw.focus : 'balanced';
  const techStrict = ['strict', 'moment'].includes(raw?.techStrict) ? raw.techStrict : 'moment';
  const maxPickCap = normalizeMaxPickCap(raw);
  const tauSliderPos = normalizeTauSliderPos(raw?.tauSliderPos);
  return { selectionMode, focus, techStrict, maxPickCap, tauSliderPos };
}

export function samePresets(a, b) {
  return a.selectionMode === b.selectionMode &&
    a.focus === b.focus &&
    a.techStrict === b.techStrict &&
    (a.maxPickCap ?? null) === (b.maxPickCap ?? null) &&
    normalizeTauSliderPos(a.tauSliderPos) === normalizeTauSliderPos(b.tauSliderPos);
}

export function RadioGroup({ name, value, options, onChange, disabled = false }) {
  return html`
    <div class="radio-group" role="group">
      ${options.map((opt) => html`
        <input
          type="radio"
          class="radio-option"
          id=${name + '-' + opt.value}
          name=${name}
          value=${opt.value}
          checked=${value === opt.value}
          disabled=${disabled}
          onChange=${() => onChange(opt.value)}
        />
        <label class="radio-label" for=${name + '-' + opt.value} title=${opt.hint ?? ''}>
          ${opt.label}
        </label>
      `)}
    </div>
  `;
}

export function tauSliderLabel(pos) {
  const p = normalizeTauSliderPos(pos);
  if (Math.abs(p) < 0.001) return 'Auto';
  const pct = Math.round(Math.abs(p) * 100);
  return p < 0 ? `${pct}% mehr behalten` : `${pct}% strenger`;
}

export function normalizeDraftMaxPickCap(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.min(10000, Math.trunc(n)));
}

export function selectionSettingsSummary(presets) {
  const p = normalizePresets(presets);
  return [
    p.selectionMode === 'chronicle' ? 'Chronik' : p.selectionMode === 'highlights' ? 'Höhepunkte' : 'Ausgewogen',
    p.focus === 'people' ? 'Menschen' : p.focus === 'places' ? 'Orte' : 'Ausgewogen',
    p.techStrict === 'strict' ? 'Streng' : 'Moment',
    tauSliderLabel(p.tauSliderPos),
    p.maxPickCap ? `Obergrenze ${p.maxPickCap}` : 'keine Obergrenze'
  ].join(' · ');
}

export function moreKeepExhausted(selectParams) {
  if (!selectParams) return false;
  const tauAuto = Number(selectParams.tauAuto);
  const floorMin = Number(selectParams.constants?.FLOOR_MIN_SCORE);
  const atFloor = Number.isFinite(tauAuto) && Number.isFinite(floorMin) && Math.abs(tauAuto - floorMin) < 0.0001;
  return atFloor || Number(selectParams.keepHeadroom) === 0;
}

export function normalizeTauSliderPos(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

export function normalizeMaxPickCap(raw) {
  if (!raw || !Object.prototype.hasOwnProperty.call(raw, 'maxPickCap')) return null;
  const n = Number(raw.maxPickCap);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.min(10000, Math.trunc(n)));
}

function focusOptions(mode) {
  if (mode === 'initial') {
    return [
      { value: 'people', label: 'Menschen', hint: 'Menschen stärker gewichten' },
      { value: 'balanced', label: 'Ausgewogen', hint: 'Ausgewogener Mix aus Menschen und Orten' },
      { value: 'places', label: 'Orte', hint: 'Szenerie stärker gewichten' }
    ];
  }
  return [
    { value: 'people', label: 'Menschen', hint: 'Kategorien aus vorhandenen Gesichtern neu abgeleitet; keine erneute Gesichtsanalyse' },
    { value: 'balanced', label: 'Ausgewogen', hint: 'Standard-Fokus' },
    { value: 'places', label: 'Orte', hint: 'Szenerie stärker gewichten' }
  ];
}

export function SelectionSettingsPanel({
  draftPresets,
  dirty,
  disabled,
  needsRecalc,
  applyState,
  selectParams,
  onChange,
  onApply,
  mode = 'review'
}) {
  const activeMode = mode === 'initial' ? 'initial' : 'review';
  const p = normalizePresets(draftPresets);
  const isSaving = applyState === 'saving';
  const controlsDisabled = disabled || isSaving;
  const panelClass = 'selection-settings-panel card' + (activeMode === 'initial' ? ' selection-settings-panel-initial' : '');

  return html`
    <section class=${panelClass}>
      ${activeMode === 'review' ? html`
        <div class="selection-settings-header">
          <div>
            <p class="label">Auswahl-Einstellungen</p>
            <h3>Auswahl neu steuern</h3>
            <p class="text-xs text-muted">Änderungen werden erst mit dem Button angewendet. Slider-Drag startet keinen Lauf.</p>
          </div>
          <span class="badge badge-neutral" title=${selectionSettingsSummary(p)}>${dirty ? 'geändert' : needsRecalc ? 'ausstehend' : 'aktuell'}</span>
        </div>
      ` : null}

      <div class="selection-settings-grid">
        <div class="selection-setting-block">
          <div class="selection-setting-label-row">
            <h4>Auswahlprinzip</h4>
            <span class="badge badge-neutral">
              ${p.selectionMode === 'chronicle' ? 'Mindestauswahl an · Szenenbremse hoch' : p.selectionMode === 'highlights' ? 'Mindestauswahl aus · Szenenbremse aus' : 'Mindestauswahl an · Szenenbremse mittel'}
            </span>
          </div>
          <${RadioGroup}
            name=${activeMode + '-selectionMode'}
            value=${p.selectionMode}
            disabled=${controlsDisabled}
            onChange=${(v) => onChange('selectionMode', v)}
            options=${[
              { value: 'chronicle', label: 'Chronik', hint: 'Vollständiger, mit stärkerer Mindestauswahl je Szene' },
              { value: 'balanced', label: 'Ausgewogen', hint: 'Standard: vollständig, aber nicht maximal' },
              { value: 'highlights', label: 'Höhepunkte', hint: 'Schwache Szenen können leer bleiben' }
            ]}
          />
        </div>

        <div class="selection-setting-block">
          <div class="selection-setting-label-row">
            <h4>Fokus</h4>
            <span class="badge badge-neutral">
              ${p.focus === 'people' ? 'P 60 · S 20 · M 20' : p.focus === 'places' ? 'P 20 · S 60 · M 20' : 'P 40 · S 30 · M 30'}
            </span>
          </div>
          <${RadioGroup}
            name=${activeMode + '-focus'}
            value=${p.focus}
            disabled=${controlsDisabled}
            onChange=${(v) => onChange('focus', v)}
            options=${focusOptions(activeMode)}
          />
        </div>

        <div class="selection-setting-block">
          <h4>Technik-Strenge</h4>
          <${RadioGroup}
            name=${activeMode + '-techStrict'}
            value=${p.techStrict}
            disabled=${controlsDisabled}
            onChange=${(v) => onChange('techStrict', v)}
            options=${[
              { value: 'strict', label: 'Streng', hint: 'Technikgewicht ×1.5' },
              { value: 'moment', label: 'Moment vor Technik', hint: 'Technikgewicht ×0.5' }
            ]}
          />
        </div>

        <div class="selection-setting-block">
          <div class="selection-setting-label-row">
            <h4>Auswahlschärfe</h4>
            <span class="badge badge-neutral">${tauSliderLabel(p.tauSliderPos)}</span>
          </div>
          <div class="tau-slider-block">
            <div class="tau-slider-labels"><span class="tau-slider-emphasis">Mehr behalten</span><span>Auto</span><span>Strenger</span></div>
            <input
              class="tau-slider"
              type="range"
              min="-1"
              max="1"
              step="0.05"
              value=${p.tauSliderPos}
              disabled=${controlsDisabled}
              aria-label="Auswahlmenge: mehr behalten bis strenger"
              onInput=${(e) => onChange('tauSliderPos', normalizeTauSliderPos(e.target.value))}
            />
            <div class="tau-slider-scale"><span>-1</span><span>0</span><span>+1</span></div>
            ${activeMode === 'initial' ? html`<p class="field-hint">Legt die grobe Auswahlschärfe für den ersten Lauf fest. Die tatsächliche Bildzahl siehst du nach der Analyse im Review.</p>` : null}
          </div>
        </div>

        <div class="selection-setting-block selection-cap-block">
          <div style="min-width:0; flex:1;">
            <h4>Obergrenze</h4>
            <p class="field-hint">Harte Obergrenze nur für automatisch ausgewählte Bilder; manuelle Aufnahmen können sichtbar darüber liegen.</p>
          </div>
          <input
            class="input"
            type="number"
            min="1"
            max="10000"
            step="5"
            placeholder="keine Obergrenze"
            value=${p.maxPickCap ?? ''}
            disabled=${controlsDisabled}
            onInput=${(e) => onChange('maxPickCap', normalizeDraftMaxPickCap(e.target.value))}
          />
        </div>
      </div>

      ${activeMode === 'review' && applyState === 'error' ? html`
        <div class="info-banner warn-banner selection-settings-note">
          <span>Änderung konnte nicht gespeichert oder neu berechnet werden. Bitte erneut versuchen.</span>
        </div>
      ` : null}

      ${activeMode === 'review' ? html`
        <div class="selection-settings-actions">
          <span class="text-xs text-muted">${controlsDisabled ? 'Verarbeitung läuft — Einstellungen gesperrt.' : dirty ? selectionSettingsSummary(p) : 'Keine ungespeicherten Änderungen.'}</span>
          <button
            class="btn btn-secondary"
            type="button"
            disabled=${controlsDisabled || !dirty}
            onClick=${onApply}
          >${isSaving ? 'Speichere …' : 'Auswahl neu berechnen'}</button>
        </div>
      ` : null}
    </section>
  `;
}
