// js/components/CoveragePanel.js
// Etappe 10: ausklappbares Coverage-Panel für Beat-, Strom- und Fallback-
// Gesichtsdiversität. Keine Personenlogik; personIds bleiben bis E11 ungenutzt.

import { h, useState, htm as _htm } from '../deps.js';
import { beatLabel } from '../beats.js';
const html = _htm.bind(h);

function BeatDot({ item, chapter, onFindRejected }) {
  const cls = 'coverage-beat-dot ' + item.beat + (item.covered ? ' covered' : ' missing');
  const title = item.covered
    ? `${beatLabel(item.beat)} abgedeckt`
    : item.beat === 'establishing'
      ? `Kein ${beatLabel(item.beat)} in ${chapter.label} — in Verworfenen suchen?`
      : `${beatLabel(item.beat)} fehlt`;
  if (!item.covered && item.beat === 'establishing') {
    return html`
      <button
        class=${cls}
        type="button"
        title=${title}
        aria-label=${title}
        onClick=${() => onFindRejected?.(chapter, item.beat)}
      ></button>
    `;
  }
  return html`<span class=${cls} title=${title} aria-label=${title}></span>`;
}

function pickCountLabel(n) {
  const count = Number(n) || 0;
  return `${count} ${count === 1 ? 'Bild' : 'Bilder'}`;
}

function PctBar({ pct, targetPct }) {
  const target = Math.max(0, Math.min(100, Number(targetPct) || 0));
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  return html`
    <div class="coverage-bar" aria-hidden="true">
      <span class="coverage-bar-fill" style=${'width:' + value + '%'}></span>
      <span class="coverage-bar-target" style=${'left:' + target + '%'}></span>
    </div>
  `;
}

export function CoveragePanel({ coverage, onFindRejected, collapsible = true }) {
  const [open, setOpen] = useState(true);
  if (!coverage) return null;
  const stats = coverage.stats || {};
  const expanded = collapsible ? open : true;

  return html`
    <aside class=${'coverage-panel ' + (expanded ? 'open' : 'closed') + (collapsible ? '' : ' no-toggle')} aria-label="Abdeckungs-Panel">
      ${collapsible ? html`
        <button class="coverage-toggle" type="button" onClick=${() => setOpen(!open)} aria-expanded=${open ? 'true' : 'false'}>
          <span>Abdeckung</span>
          <span>${open ? '−' : '+'}</span>
        </button>
      ` : null}

      ${expanded ? html`
        <div class="coverage-body">
          <section class="coverage-section">
            <div class="coverage-section-head">
              <h3>Schlüsselmoment-Abdeckung</h3>
              <span>${stats.beatsCovered || 0}/${stats.beatsTotal || 0}</span>
            </div>
            <div class="coverage-chapters">
              ${(coverage.chapters || []).map((chapter) => html`
                <div class="coverage-chapter" key=${chapter.id == null ? 'none' : chapter.id}>
                  <div class="coverage-chapter-line">
                    <span class="coverage-chapter-name">${chapter.label}</span>
                    <span class="text-xs text-muted">${pickCountLabel(chapter.count)}</span>
                  </div>
                  <div class="coverage-beats" aria-label=${chapter.label + ' Schlüsselmomente'}>
                    ${(chapter.beats || []).map((item) => html`
                      <${BeatDot} key=${item.beat} item=${item} chapter=${chapter} onFindRejected=${onFindRejected} />
                    `)}
                  </div>
                </div>
              `)}
            </div>
          </section>

          <section class="coverage-section">
            <div class="coverage-section-head">
              <h3>Kategorie-Verteilung</h3>
              <span class="text-xs text-muted">vs. Fokus-Ziel</span>
            </div>
            <div class="coverage-metrics">
              ${(coverage.streams || []).map((row) => html`
                <div class="coverage-metric" key=${row.stream}>
                  <div class="coverage-metric-line">
                    <span class=${'badge ' + (row.stream === 'P' ? 'badge-p' : row.stream === 'M' ? 'badge-m' : 'badge-s')}>${row.label}</span>
                    <span>${row.count} · ${row.pct}% / ${row.targetPct}%</span>
                  </div>
                  <${PctBar} pct=${row.pct} targetPct=${row.targetPct} />
                </div>
              `)}
            </div>
          </section>

          <section class="coverage-section">
            <div class="coverage-section-head">
              <h3>Gesichts-Klassen</h3>
              <span class="coverage-fallback-note">ohne Personenerkennung</span>
            </div>
            <p class="coverage-note">Ohne Personenerkennung: Diversität wird nur über Klassen 0 / 1–2 / 3+ Gesichter geschätzt.</p>
            <div class="coverage-face-grid">
              ${(coverage.faceClasses || []).map((row) => html`
                <div class="coverage-face-cell" key=${row.key}>
                  <strong>${row.count}</strong>
                  <span>${row.label}</span>
                  <small>${row.pct}%</small>
                </div>
              `)}
            </div>
          </section>

          <section class="coverage-section coverage-summary">
            <div>
              <strong>${stats.selectionSize || 0}</strong>
              <span>Auswahl</span>
            </div>
            <div>
              <strong>${stats.chapterCount || 0}</strong>
              <span>Kapitel</span>
            </div>
            <div>
              <strong>${stats.overrideCount || 0}</strong>
              <span>manuell · ${stats.overrideQuote?.pct || 0}%</span>
            </div>
          </section>
        </div>
      ` : null}
    </aside>
  `;
}
