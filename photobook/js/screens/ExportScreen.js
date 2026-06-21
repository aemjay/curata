// js/screens/ExportScreen.js
// Etappe 12: Export-Artefakte der v1-Auswahl.

import { h, useContext, useEffect, useMemo, useRef, useState, htm as _htm, JSZip } from '../deps.js';
const html = _htm.bind(h);
import { AppContext } from '../ctx.js';
import { buildDiagnosisReport, buildReviewData, computeOverrideQuote, detectWebGPU, sortChronologically } from '../selectors.js';
import { beatLabel } from '../beats.js';
import * as db from '../db.js';
import {
  attachOriginalFiles,
  getOriginalFile,
  missingOriginalIds,
  originalFileMapSize
} from '../ingest.js';

function ExportCard({ icon, title, desc, badge, disabled, busy, onExport, buttonLabel = 'Herunterladen', extra }) {
  return html`
    <div class=${'card flex items-center gap-6 ' + (disabled ? '' : '')}
      style=${disabled ? 'opacity:0.45;' : ''}>
      <div style="
        width:52px; height:52px; flex-shrink:0;
        background:var(--bg-elevated); border:1px solid var(--border-mid);
        border-radius:var(--r-lg);
        display:flex; align-items:center; justify-content:center;
        color:var(--text-secondary);
      ">
        ${icon}
      </div>
      <div class="flex-1" style="min-width:0;">
        <p class="font-display font-semibold" style="margin-bottom:4px;">${title}</p>
        <p class="text-sm text-muted">${desc}</p>
        ${extra || null}
      </div>
      ${badge && html`<span class="badge badge-neutral mono">${badge}</span>`}
      <button
        class="btn btn-secondary"
        disabled=${disabled || busy}
        onClick=${onExport}
        type="button"
        style="flex-shrink:0;"
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <path d="M7.5 1v9M4 7l3.5 3.5L11 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M1 12h13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        ${busy ? 'Erzeuge …' : buttonLabel}
      </button>
    </div>
  `;
}

function iconFolder() {
  return html`
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M3 4a1 1 0 0 1 1-1h6l2 2h8a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4Z"
        stroke="currentColor" stroke-width="1.5"/>
      <path d="M12 11v6M9 14l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

function iconJson() {
  return html`
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"
        stroke="currentColor" stroke-width="1.5"/>
      <path d="M14 2v6h6M8 13h8M8 17h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  `;
}

function iconSheet() {
  return html`
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/>
      <rect x="6" y="6" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/>
      <rect x="13" y="6" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/>
      <rect x="6" y="13" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/>
      <rect x="13" y="13" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/>
    </svg>
  `;
}

export function ExportScreen() {
  const { state, dispatch } = useContext(AppContext);
  const { presets, overrides, photos, chapters } = state;
  const review = useMemo(() => buildReviewData(photos, chapters, overrides, presets), [photos, chapters, overrides, presets]);
  const selection = state.selection && state.selection.length ? state.selection : review.selection;
  const sortedSelection = useMemo(() => sortChronologically(selection), [selection]);
  const selectedIds = useMemo(() => sortedSelection.map((p) => p.id), [sortedSelection]);
  const byId = useMemo(() => new Map((photos || []).map((p) => [p.id, p])), [photos]);
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [reattachReport, setReattachReport] = useState(null);
  const [attachRevision, setAttachRevision] = useState(0);
  const [pipelineState, setPipelineState] = useState(null);
  const [selectParams, setSelectParams] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([db.getMeta('pipelineState'), db.getMeta('selectParams')])
      .then(([pipeline, select]) => {
        if (!cancelled) {
          setPipelineState(pipeline || null);
          setSelectParams(select || null);
        }
      })
      .catch((err) => { console.warn('[ExportScreen] Analyse-/Auswahl-Parameter konnten nicht gelesen werden:', err); });
    return () => { cancelled = true; };
  }, [photos.length]);

  const hasSelection = sortedSelection.length > 0;
  const quote = computeOverrideQuote(overrides, sortedSelection.length);
  const overrideQuote = quote.pct;
  const passed = hasSelection && overrideQuote <= 30;
  void attachRevision;
  const missingIds = hasSelection ? missingOriginalIds(selectedIds) : [];
  const missingPhotos = missingIds.map((id) => byId.get(id)).filter(Boolean);
  const needsReattach = hasSelection && (originalFileMapSize() === 0 || missingIds.length > 0);

  function chooseFolder() {
    setError(null);
    inputRef.current?.click?.();
  }

  async function onReattachFiles(event) {
    const files = event?.target?.files;
    if (!files || files.length === 0) return;
    setBusy('reattach');
    setError(null);
    try {
      const report = await attachOriginalFiles(files, selectedIds);
      setReattachReport(report);
      setAttachRevision((n) => n + 1);
      if (report.missing.length) {
        setError(`${report.missing.length} Originaldatei(en) fehlen im neu gewählten Ordner.`);
      }
    } catch (err) {
      console.error('[ExportScreen] Re-Attach fehlgeschlagen:', err);
      setError('Ordner konnte nicht abgeglichen werden. Bitte denselben Originalordner erneut wählen.');
    } finally {
      setBusy(null);
      if (event?.target) event.target.value = '';
    }
  }

  async function onExportZip() {
    if (!hasSelection) return;
    const missing = missingOriginalIds(selectedIds);
    if (missing.length) {
      setError('Originaldateien sind nach einem Reload nicht verfügbar oder unvollständig. Bitte den ursprünglichen Ordner erneut wählen.');
      setAttachRevision((n) => n + 1);
      return;
    }

    setBusy('zip');
    setError(null);
    try {
      const zip = new JSZip();
      for (let i = 0; i < sortedSelection.length; i++) {
        const photo = sortedSelection[i];
        const file = getOriginalFile(photo.id);
        if (!file) throw new Error(`Original fehlt: ${photo.name || photo.id}`);
        const folder = chapterFolder(photo);
        const filename = `${pad(i + 1, 3)}_${safeFilename(photo.name || file.name || photo.id)}`;
        zip.file(`${folder}/${filename}`, file, {
          date: new Date(file.lastModified || photo.lastModified || Date.now()),
          createFolders: true
        });
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      downloadBlob(blob, 'curata-originale.zip');
    } catch (err) {
      console.error('[ExportScreen] ZIP-Export fehlgeschlagen:', err);
      setError(err?.message || 'ZIP-Export fehlgeschlagen.');
    } finally {
      setBusy(null);
    }
  }

  async function onExportJson() {
    if (!hasSelection) return;
    setBusy('json');
    setError(null);
    try {
      const params = selectParams || await db.getMeta('selectParams');
      const manifest = buildSelectionManifest(sortedSelection, overrides || [], params);
      const json = JSON.stringify(manifest, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      downloadBlob(blob, 'selection.json');
    } catch (err) {
      console.error('[ExportScreen] selection.json fehlgeschlagen:', err);
      setError('selection.json konnte nicht erzeugt werden.');
    } finally {
      setBusy(null);
    }
  }


  async function onExportDiagnosis() {
    if (!hasSelection && !(photos || []).length) return;
    setBusy('diagnosis');
    setError(null);
    try {
      const backend = await detectWebGPU();
      const params = selectParams || await db.getMeta('selectParams');
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      const diagnosis = buildDiagnosisReport({
        photos,
        chapters,
        overrides,
        presets,
        review,
        selectParams: params || null,
        pipelineState: pipelineState || state.pipeline || null,
        backend: backend === 'gpu' ? 'Grafikbeschleunigung' : 'CPU-Modus',
        browser: nav?.userAgent || null,
        platform: nav?.platform || null
      });
      const blob = new Blob([JSON.stringify(diagnosis, null, 2)], { type: 'application/json' });
      downloadBlob(blob, 'diagnose.json');
    } catch (err) {
      console.error('[ExportScreen] Diagnose-Export fehlgeschlagen:', err);
      setError('Diagnose-Export konnte nicht erzeugt werden.');
    } finally {
      setBusy(null);
    }
  }

  async function onExportContactSheet() {
    if (!hasSelection) return;
    setBusy('sheet');
    setError(null);
    try {
      const rows = [];
      const urls = [];
      let lastChapter = Symbol('initial');
      for (const photo of sortedSelection) {
        const chapter = photo.chapterId ?? null;
        if (chapter !== lastChapter) {
          rows.push({ type: 'chapter', label: chapter === null ? 'Ohne Kapitel' : `Kapitel ${chapter + 1}` });
          lastChapter = chapter;
        }
        const blob = await db.getThumb(photo.id);
        const url = blob ? URL.createObjectURL(blob) : null;
        if (url) urls.push(url);
        rows.push({ type: 'photo', photo, url });
      }
      openContactSheet(rows, urls);
    } catch (err) {
      console.error('[ExportScreen] Kontaktbogen fehlgeschlagen:', err);
      setError('Kontaktbogen konnte nicht erzeugt werden.');
    } finally {
      setBusy(null);
    }
  }

  return html`
    <div class="screen" style="max-width:780px;">

      <header class="screen-header">
        <p class="screen-eyebrow">Schritt 4 / 4</p>
        <h1 class="screen-title">Export</h1>
        <p class="screen-subtitle">
          Exportiert die bestätigte Auswahl chronologisch als Original-ZIP, Manifest und druckbaren Kontaktbogen.
        </p>
      </header>

      <input
        ref=${inputRef}
        type="file"
        multiple
        webkitdirectory=${true}
        directory=${true}
        style="display:none;"
        onChange=${onReattachFiles}
      />

      ${!hasSelection && html`
        <div class="info-banner" style="margin-bottom:var(--s6);">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style="flex-shrink:0;margin-top:1px;">
            <circle cx="9" cy="9" r="7.5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M9 8v5M9 6h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span>Schließe zuerst das Review (Schritt 4) ab, um die Exporte freizuschalten.</span>
        </div>
      `}

      ${hasSelection && needsReattach && html`
        <div class="info-banner warn-banner" style="margin-bottom:var(--s6);">
          <span>
            Original-Dateien sind nur in der aktuellen Sitzung verfügbar. Für das ZIP bitte den ursprünglichen Foto-Ordner erneut wählen;
            der Abgleich erfolgt über Dateiname, Größe und Änderungsdatum.
          </span>
          <button class="btn btn-secondary" type="button" disabled=${busy === 'reattach'} onClick=${chooseFolder} style="margin-left:auto;">
            ${busy === 'reattach' ? 'Prüfe …' : 'Ordner erneut wählen'}
          </button>
        </div>
      `}

      ${error && html`
        <div class="info-banner warn-banner" style="margin-bottom:var(--s6);">
          <span>${error}</span>
        </div>
      `}

      ${reattachReport && html`
        <div class="info-banner" style="margin-bottom:var(--s6);">
          <span>
            Erneut zugeordnet: ${reattachReport.attached.length} Originale,
            ${reattachReport.missing.length} fehlen (${reattachReport.scanned} Dateien geprüft).
          </span>
        </div>
      `}

      ${missingPhotos.length > 0 && html`
        <div class="card" style="margin-bottom:var(--s6); border-color:var(--yellow);">
          <p class="font-semibold" style="margin-bottom:var(--s2);">Fehlende Originale</p>
          <p class="text-sm text-muted" style="margin-bottom:var(--s3);">Diese Dateien werden nicht still übersprungen; Der ZIP-Export bleibt bis zur Zuordnung gesperrt.</p>
          <div class="flex-col gap-2" style="max-height:160px; overflow:auto;">
            ${missingPhotos.slice(0, 30).map((p) => html`<span class="mono text-xs" key=${p.id}>${p.name || p.id}</span>`)}
            ${missingPhotos.length > 30 ? html`<span class="text-xs text-muted">… ${missingPhotos.length - 30} weitere</span>` : null}
          </div>
        </div>
      `}

      ${hasSelection && html`
        <div class="card card-elevated flex items-center gap-6" style="margin-bottom:var(--s6);">
          <div style="text-align:center; min-width:80px;">
            <p class="mono font-bold" style="font-size:var(--text-2xl); color:var(--accent-text);">
              ${sortedSelection.length}
            </p>
            <p class="text-xs text-muted label">Bilder</p>
          </div>
          <div style="width:1px; height:40px; background:var(--border-mid);"></div>
          <div style="text-align:center; min-width:80px;">
            <p class="mono font-bold" style="font-size:var(--text-2xl); color:${passed ? 'var(--green)' : 'var(--yellow)'};">
              ${overrideQuote} %
            </p>
            <p class="text-xs text-muted label">Manuelle Anpassungen</p>
          </div>
          <div style="width:1px; height:40px; background:var(--border-mid);"></div>
          <div style="text-align:center; min-width:80px;">
            <p class="mono font-bold" style="font-size:var(--text-2xl); color:var(--text-secondary);">
              ${formatTau(selectParams?.tauEffective)}
            </p>
            <p class="text-xs text-muted label">Auswahlschärfe</p>
          </div>
          <div style="margin-left:auto;">
            <span class="badge badge-neutral" style=${passed ? '' : 'background:rgba(232,200,56,0.15);color:var(--yellow);'}>
              ${passed ? 'Bestanden' : 'Nicht bestanden'} · Abnahmekriterium ≤ 30 %
            </span>
          </div>
        </div>
      `}

      <div class="flex-col gap-4">

        <${ExportCard}
          icon=${iconFolder()}
          title="Originalfotos als ZIP"
          desc="Alle ausgewählten Bilder in Originalauflösung, chronologisch nummeriert und nach Kapiteln gruppiert."
          badge=${hasSelection ? sortedSelection.length + ' Dateien' : null}
          disabled=${!hasSelection || needsReattach}
          busy=${busy === 'zip'}
          onExport=${onExportZip}
          extra=${needsReattach ? html`<p class="field-hint" style="margin-top:var(--s2);">Originale nach Reload erneut anhängen.</p>` : null}
        />

        <${ExportCard}
          icon=${iconJson()}
          title="selection.json"
          desc="Manifest mit ID, Dateiname, Kapitel, Schlüsselmoment, Kategorie, Bewertung, Begründung, manueller Anpassung und Auswahlparametern."
          badge="JSON"
          disabled=${!hasSelection}
          busy=${busy === 'json'}
          onExport=${onExportJson}
        />


        <${ExportCard}
          icon=${iconJson()}
          title="diagnose.json"
          desc="Maschinenlesbare Qualitätsdiagnose mit Kennzahlen und Begründungsdaten für Auswahl und verworfene Bilder — ohne Bilder, Thumbnails, Base64, Embeddings, GPS oder EXIF-Rohfelder."
          badge="JSON"
          disabled=${!hasSelection && !(photos || []).length}
          busy=${busy === 'diagnosis'}
          onExport=${onExportDiagnosis}
          buttonLabel="Diagnose exportieren"
          extra=${html`<p class="field-hint" style="margin-top:var(--s2);">Enthält Bildbeschreibungen, Dateinamen und abgeleitete Tags aus deinem Fotoordner. Nur mit Personen teilen, denen du diese Einsicht gewähren willst.</p>`}
        />

        <${ExportCard}
          icon=${iconSheet()}
          title="Druckbarer Kontaktbogen"
          desc="Öffnet ein neues Fenster mit Print-CSS — Thumbnails in Reihenfolge, Kapitel-Trenner, Dateinamen."
          badge="Print"
          disabled=${!hasSelection}
          busy=${busy === 'sheet'}
          onExport=${onExportContactSheet}
        />

      </div>

      <div class="flex items-center justify-between" style="margin-top:var(--s8);">
        <button
          class="btn btn-ghost"
          onClick=${() => dispatch({ type: 'SET_SCREEN', screen: 'review' })}
          type="button"
        >
          ← Zurück zu Review
        </button>
        ${hasSelection && html`
          <p class="text-xs text-muted">
            Abnahmekriterium: manuelle Anpassungen ≤ 30 % — aktuell ${overrideQuote} % · ${passed ? 'Bestanden' : 'Nicht bestanden'}
          </p>
        `}
      </div>

    </div>
  `;
}

function buildSelectionManifest(selection, overrides, selectParams) {
  const overridden = new Set((overrides || []).map((ov) => ov?.photoId).filter(Boolean));
  return {
    schema: 'photobook-selection-v2',
    select: {
      implVersion: selectParams?.implVersion || null,
      tauAuto: numberOrNull(selectParams?.tauAuto),
      tauEffective: numberOrNull(selectParams?.tauEffective),
      tauSliderPos: numberOrNull(selectParams?.tauSliderPos),
      tauOffset: numberOrNull(selectParams?.tauOffset),
      floorGate: numberOrNull(selectParams?.floorGate),
      maxPickCap: selectParams?.maxPickCap ?? null,
      candidateCount: Number.isFinite(Number(selectParams?.candidateCount)) ? Number(selectParams.candidateCount) : null,
      pickedCount: Number.isFinite(Number(selectParams?.pickedCount)) ? Number(selectParams.pickedCount) : null
    },
    selection: (selection || []).map((photo) => ({
    id: photo.id ?? null,
    filename: photo.name ?? null,
    chapter: photo.chapterId ?? null,
    beat: photo.beat ?? null,
    stream: photo.stream ?? null,
    scores: {
      tech: techMean(photo),
      moment: numberOrNull(photo.vlm?.momentScore),
      smile: photo.stream === 'P' && photo.faces ? numberOrNull(photo.faces.smile) : null
    },
    reason: photo.reason ?? null,
    overridden: overridden.has(photo.id)
  }))
  };
}

function formatTau(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : 'auto';
}

function techMean(photo) {
  if (!photo || !photo.tech) return null;
  const sharpness = numberOrNull(photo.tech.sharpness);
  const exposure = numberOrNull(photo.tech.exposure);
  if (sharpness == null || exposure == null) return null;
  return round4((sharpness + exposure) / 2);
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? round4(n) : null;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function chapterFolder(photo) {
  const n = Number.isInteger(photo.chapterId) ? photo.chapterId + 1 : null;
  return n == null ? 'Ohne_Kapitel' : `${pad(n, 2)}_Kapitel_${n}`;
}

function pad(value, len) {
  return String(value).padStart(len, '0');
}

function safeFilename(name) {
  return String(name || 'foto')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'foto';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openContactSheet(rows, urls) {
  const win = window.open('', '_blank');
  if (!win) {
    for (const url of urls) URL.revokeObjectURL(url);
    throw new Error('Popup blockiert');
  }

  const body = rows.map((row) => {
    if (row.type === 'chapter') return `<h2 class="chapter-break">${escapeHtml(row.label)}</h2>`;
    const photo = row.photo;
    const label = photo.beat ? beatLabel(photo.beat) : '';
    return `<figure class="thumb-card">
      ${row.url ? `<img src="${escapeAttr(row.url)}" alt="${escapeAttr(photo.name || photo.id || '')}">` : '<div class="missing-thumb">kein Thumb</div>'}
      <figcaption>${escapeHtml(photo.name || photo.id || '')}</figcaption>
      ${label ? `<small>${escapeHtml(label)}</small>` : ''}
    </figure>`;
  }).join('\n');

  win.document.write(`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Kontaktbogen</title>
<style>
  :root { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:#1f2933; }
  body { margin: 24px; background:#fff; }
  header { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; margin-bottom:24px; }
  h1 { margin:0; font-size:24px; }
  .meta { color:#5f6b7a; font-size:12px; }
  .toolbar { margin-bottom:18px; }
  button { border:1px solid #c8d0d8; border-radius:8px; padding:8px 12px; background:#fff; cursor:pointer; }
  .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap:14px; }
  .chapter-break { grid-column:1 / -1; break-after: avoid; border-top:2px solid #d7dde4; padding-top:14px; margin:18px 0 4px; font-size:16px; }
  .thumb-card { margin:0; border:1px solid #e1e6eb; border-radius:10px; padding:8px; break-inside: avoid; page-break-inside: avoid; }
  .thumb-card img, .missing-thumb { width:100%; aspect-ratio:4 / 3; object-fit:cover; border-radius:6px; background:#eef2f6; display:flex; align-items:center; justify-content:center; color:#6b7280; font-size:12px; }
  figcaption { margin-top:6px; font-size:11px; line-height:1.25; word-break:break-word; }
  small { display:block; margin-top:3px; color:#5f6b7a; font-size:10px; }
  @media print {
    body { margin: 10mm; }
    .toolbar { display:none; }
    .grid { grid-template-columns: repeat(4, 1fr); gap:8px; }
    .thumb-card { padding:5px; border-color:#ccc; }
    h1 { font-size:18px; }
  }
</style>
</head>
<body>
<header>
  <div>
    <h1>Kontaktbogen</h1>
    <div class="meta">${new Date().toLocaleString('de-DE')} · ${rows.filter((r) => r.type === 'photo').length} Bilder</div>
  </div>
</header>
<div class="toolbar"><button onclick="window.print()">Drucken</button></div>
<main class="grid">
${body}
</main>
</body>
</html>`);
  win.document.close();
  try { win.focus(); } catch (_) {}
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
