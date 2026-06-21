// js/screens/StartScreen.js
// Phase A-UI: additive Arbeitsmenge, Dateien+Ordner, Kuratierungs-Grid in CURATING.
// L1: Laden-Screen zustandsabhängig verdichtet; reine Präsentation/IA.

import { h, useContext, useRef, useState, useEffect, useMemo, htm as _htm } from '../deps.js';
const html = _htm.bind(h);
import { AppContext } from '../ctx.js';
import { addFilesToWorkset, clearAllWorkset, removePhotoFromWorkset, startNewWorkset } from '../ingest.js';
import { IngestCurationGrid } from '../components/IngestCurationGrid.js';
import { SelectionSettingsPanel, normalizePresets } from '../components/SelectionSettingsPanel.js';
import { isPipelineActive } from '../pipeline/runner.js';
import { computeDiagnostics, detectWebGPU, estimateRuntime, sortChronologically } from '../selectors.js';
import { putMeta } from '../db.js';

function startErrorHelp(state, pipeline) {
  if (!state.worksetStartError) return null;
  if (state.worksetLocked && pipeline.status === 'done') return 'Die fertige Bildauswahl bleibt erhalten. Du kannst den Review öffnen.';
  if (state.worksetLocked && ['paused', 'error'].includes(pipeline.status)) return 'Die Bildauswahl ist gesperrt. Du kannst die Verarbeitung fortsetzen.';
  if (!state.worksetLocked) return 'Die Bildauswahl bleibt bearbeitbar. Du kannst Fotos hinzufügen oder entfernen und erneut starten.';
  return 'Die Bildauswahl bleibt geschützt. Setze sie nur zurück, wenn du neu beginnen willst.';
}

function runtimeNotice(runtime) {
  if (!runtime?.seconds) return null;
  if (runtime.seconds >= 28800) {
    return {
      level: 'warn',
      text: `Geschätzte Dauer ${runtime.text}. Der Browser-Tab muss geöffnet bleiben; ein Mehrstundenlauf sollte bewusst gestartet werden.`
    };
  }
  if (runtime.seconds >= 7200) {
    return {
      level: 'hint',
      text: `Geschätzte Dauer ${runtime.text}. Lass den Tab während der Verarbeitung geöffnet; Pausieren und Fortsetzen sind möglich.`
    };
  }
  return null;
}

function statusCopy({ state, pipeline, diag }) {
  if (state.hydration === 'recovery') {
    return {
      eyebrow: 'Recovery',
      title: 'Lokale Bildauswahl inkonsistent',
      body: state.recoveryReason || 'Die lokale Bildauswahl ist nicht konsistent. Laden und Verarbeitung bleiben gesperrt, bis eine neue Bildauswahl gestartet wird.'
    };
  }
  if (state.worksetLocked && pipeline.status === 'done') {
    return {
      eyebrow: 'Bereit zur Prüfung',
      title: `Fertige Bildauswahl · ${diag.count} ${diag.count === 1 ? 'Foto' : 'Fotos'}`,
      body: 'Die Verarbeitung ist abgeschlossen. Die nächste sinnvolle Aktion ist der Review.'
    };
  }
  if (state.worksetLocked && pipeline.status === 'paused') {
    return {
      eyebrow: 'Verarbeitung pausiert',
      title: `Fixierte Bildauswahl · ${diag.count} ${diag.count === 1 ? 'Foto' : 'Fotos'}`,
      body: 'Die Arbeitsmenge ist gesperrt. Setze die Verarbeitung fort oder starte bewusst neu.'
    };
  }
  if (state.worksetLocked && pipeline.status === 'error') {
    return {
      eyebrow: 'Verarbeitung mit Fehler',
      title: `Fixierte Bildauswahl · ${diag.count} ${diag.count === 1 ? 'Foto' : 'Fotos'}`,
      body: 'Die Arbeitsmenge ist geschützt. Öffne die Verarbeitung, um den Fehlerpfad fortzusetzen.'
    };
  }
  if (state.worksetLocked) {
    return {
      eyebrow: 'Gesperrt',
      title: `Fixierte Bildauswahl · ${diag.count} ${diag.count === 1 ? 'Foto' : 'Fotos'}`,
      body: 'Fotos können nur über „Neue Bildauswahl starten“ geändert werden.'
    };
  }
  return null;
}

export function StartScreen() {
  const { state, dispatch } = useContext(AppContext);
  const { photos, pipeline } = state;
  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const [ingest, setIngest] = useState({ active: false, done: 0, total: 0, error: null });
  const [privacyClear, setPrivacyClear] = useState({ confirm: false, active: false, message: null, error: null });
  const [resetting, setResetting] = useState(false);
  const [backend, setBackend] = useState(null);
  const [starting, setStarting] = useState(false);
  const [draftPresets, setDraftPresets] = useState(() => normalizePresets(state.presets));
  const [draftTouched, setDraftTouched] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => { detectWebGPU().then(setBackend); }, []);
  useEffect(() => () => { if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current); }, []);
  useEffect(() => {
    if (!draftTouched) setDraftPresets(normalizePresets(state.presets));
  }, [state.presets, draftTouched]);

  const photosLoaded = photos.length > 0;
  const diag = useMemo(() => computeDiagnostics(photos), [photos]);
  const orderedPhotos = useMemo(() => sortChronologically(photos), [photos]);
  const runtime = useMemo(() => (photosLoaded ? estimateRuntime(diag.ok, backend || 'wasm') : null), [photosLoaded, diag.ok, backend]);
  const runtimeWarning = runtimeNotice(runtime);
  const startErrorText = startErrorHelp(state, pipeline);
  const allowedResetStatus = ['idle', 'paused', 'done', 'error'].includes(pipeline.status);
  const localRunnerActive = isPipelineActive();
  const isCurating = state.hydration === 'ready'
    && !state.worksetLocked
    && state.worksetSessionStartToken === null;
  const canMutate = isCurating
    && !localRunnerActive
    && !ingest.active
    && !resetting
    && !starting
    && !privacyClear.active;
  const canReset = (state.hydration === 'ready' || state.hydration === 'recovery')
    && allowedResetStatus
    && state.worksetSessionStartToken === null
    && !localRunnerActive
    && !ingest.active
    && !resetting
    && !starting
    && !privacyClear.active;

  async function startIngest(fileList) {
    if (!fileList?.length || !canMutate) return;
    setPrivacyClear({ confirm: false, active: false, message: null, error: null });
    setIngest({ active: true, done: 0, total: fileList.length, error: null });
    try {
      await addFilesToWorkset(fileList, {
        dispatch,
        onProgress: (done, total) => setIngest({ active: done < total, done, total, error: null })
      });
    } catch (error) {
      console.error('[StartScreen] Add fehlgeschlagen:', error);
      setIngest((previous) => ({ ...previous, active: false, error: error?.message || String(error) }));
    } finally {
      setIngest((previous) => ({ ...previous, active: false }));
    }
  }

  function onFolderSelect(event) {
    const files = event.currentTarget.files;
    startIngest(files).finally(() => { event.currentTarget.value = ''; });
  }

  function onFileSelect(event) {
    const files = event.currentTarget.files;
    startIngest(files).finally(() => { event.currentTarget.value = ''; });
  }

  function openFolderInput() { if (canMutate) folderInputRef.current?.click(); }
  function openFileInput() { if (canMutate) fileInputRef.current?.click(); }
  function onDropZoneClick() { openFolderInput(); }
  function onDragOver(event) { if (!canMutate) return; event.preventDefault(); event.currentTarget.classList.add('drag-over'); }
  function onDragLeave(event) { event.currentTarget.classList.remove('drag-over'); }
  function onDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    if (canMutate && event.dataTransfer?.files?.length) startIngest(event.dataTransfer.files);
  }

  function onPresetChange(key, value) {
    setDraftTouched(true);
    setDraftPresets((prev) => normalizePresets({ ...prev, [key]: value }));
  }

  async function removePhoto(photo) {
    if (!photo?.id || !canMutate) return;
    try {
      await removePhotoFromWorkset(photo.id, { dispatch });
    } catch (error) {
      setIngest((previous) => ({ ...previous, active: false, error: error?.message || String(error) }));
    }
  }

  async function proceedToProcessing() {
    if (!photosLoaded || !canMutate) return;
    setStarting(true);
    try {
      const next = normalizePresets(draftPresets);
      await putMeta('presets', next);
      dispatch({ type: 'SET_PRESETS', payload: next });
      dispatch({ type: 'RESET_PIPELINE' });
      dispatch({ type: 'SET_SCREEN', screen: 'processing' });
    } catch (error) {
      console.error('[StartScreen] Einstellungen konnten nicht gespeichert werden:', error);
      const message = 'Einstellungen konnten nicht gespeichert werden. Verarbeitung nicht gestartet.';
      setIngest((previous) => ({ ...previous, active: false, error: message }));
      dispatch({ type: 'PIPELINE_ERROR', error: message });
    } finally {
      setStarting(false);
    }
  }

  async function resetWorkset() {
    if (!canReset) return;
    setResetting(true);
    try {
      await startNewWorkset({ dispatch });
      setDraftTouched(false);
      setIngest({ active: false, done: 0, total: 0, error: null });
    } catch (error) {
      setIngest((previous) => ({ ...previous, error: error?.message || String(error) }));
    } finally {
      setResetting(false);
    }
  }

  function requestPrivacyClear() {
    if (!canReset) return;
    setPrivacyClear({ confirm: true, active: false, message: null, error: null });
  }
  function cancelPrivacyClear() {
    if (!privacyClear.active) setPrivacyClear({ confirm: false, active: false, message: null, error: null });
  }
  async function confirmPrivacyClear() {
    if (!canReset) return;
    setPrivacyClear({ confirm: true, active: true, message: null, error: null });
    try {
      await clearAllWorkset({ dispatch });
      setDraftTouched(false);
      if (folderInputRef.current) folderInputRef.current.value = '';
      if (fileInputRef.current) fileInputRef.current.value = '';
      setPrivacyClear({ confirm: false, active: false, message: 'Alle lokalen Daten gelöscht.', error: null });
      noticeTimerRef.current = window.setTimeout(() => setPrivacyClear((old) => ({ ...old, message: null })), 4500);
    } catch (error) {
      setPrivacyClear({ confirm: true, active: false, message: null, error: error?.message || String(error) });
    }
  }

  const pct = ingest.total > 0 ? Math.round((100 * ingest.done) / ingest.total) : 0;
  const webgpuCell = backend == null ? '…' : backend === 'gpu' ? 'aktiv' : 'CPU';
  const webgpuClass = backend === 'gpu' ? 'ok' : backend === 'wasm' ? 'warn' : '';
  const lockText = state.worksetSessionStartToken !== null
    ? 'Verarbeitungsstart wird abgesichert. Die Bildauswahl ist bis zum Speichern gesperrt.'
    : state.worksetLocked
      ? 'Bildauswahl ist für die Verarbeitung gesperrt. Fotos können nur über „Neue Bildauswahl starten“ geändert werden.'
      : null;
  const status = statusCopy({ state, pipeline, diag });
  const showStatusHero = status && (state.hydration === 'recovery' || state.worksetLocked || state.worksetSessionStartToken !== null);
  const showDropZone = isCurating;
  const showLockedDropNote = !showDropZone && state.hydration !== 'hydrating';
  const showReviewCta = state.hydration === 'ready' && state.worksetLocked && pipeline.status === 'done';
  const showResumeCta = state.hydration === 'ready' && state.worksetLocked && ['paused', 'error'].includes(pipeline.status);
  const showCuratingActions = isCurating;
  const showPreview = photosLoaded && isCurating;

  if (state.hydration === 'hydrating') {
    return html`<div class="screen"><header class="screen-header"><p class="screen-eyebrow">Bildauswahl</p><h1 class="screen-title">Lokale Daten werden geprüft …</h1><p class="screen-subtitle">Lokale Daten und Verarbeitungsstand werden geladen.</p></header></div>`;
  }

  return html`
    <div class="screen start-screen">
      <header class="screen-header start-screen-header">
        <p class="screen-eyebrow">Schritt 1 / 4</p>
        <h1 class="screen-title">Fotos laden</h1>
        <p class="screen-subtitle">
          ${state.hydration === 'recovery'
            ? 'Die lokale Bildauswahl ist nicht konsistent. Zur Sicherheit sind Laden und Verarbeitung gesperrt.'
            : state.worksetLocked
              ? 'Die Bildauswahl ist verarbeitet bzw. angehalten und daher schreibgeschützt.'
              : 'Bildauswahl: Fotos vor der Verarbeitung hinzufügen, prüfen und bei Bedarf entfernen.'}
        </p>
      </header>

      ${state.hydration === 'recovery' ? html`
        <div class="info-banner warn-banner start-banner">
          <span>Wiederherstellung: ${state.recoveryReason || 'Die lokale Bildauswahl ist inkonsistent.'} „Neue Bildauswahl starten“ oder Privacy-Clear bleiben verfügbar.</span>
        </div>
      ` : null}
      ${lockText ? html`<div class="info-banner start-banner"><span>${lockText}</span></div>` : null}
      ${state.worksetStartError ? html`
        <div class="info-banner start-banner" style="background:var(--red-dim); border-color:var(--red);">
          <span><strong>Start-/Verarbeitungsfehler:</strong> ${state.worksetStartError}${startErrorText ? html`<br />${startErrorText}` : ''}</span>
        </div>
      ` : null}

      <input ref=${folderInputRef} type="file" class="sr-only" webkitdirectory multiple accept="image/*,.heic,.heif" disabled=${!canMutate} onChange=${onFolderSelect} />
      <input ref=${fileInputRef} type="file" class="sr-only" multiple accept="image/*,.heic,.heif" disabled=${!canMutate} onChange=${onFileSelect} />

      ${showStatusHero ? html`
        <section class="start-status-hero">
          <div class="start-status-copy">
            <p class="start-status-eyebrow">${status.eyebrow}</p>
            <h2>${status.title}</h2>
            <p>${status.body}</p>
          </div>
          <div class="start-status-actions">
            ${showReviewCta ? html`<button class="btn btn-primary btn-lg" type="button" onClick=${() => dispatch({ type:'SET_SCREEN', screen:'review' })}>Review öffnen</button>` : null}
            ${showResumeCta ? html`<button class="btn btn-primary btn-lg" type="button" onClick=${() => dispatch({ type:'SET_SCREEN', screen:'processing' })}>Verarbeitung fortsetzen</button>` : null}
            <button class="btn btn-secondary" type="button" disabled=${!canReset} onClick=${resetWorkset}>${resetting ? 'Setze zurück …' : 'Neue Bildauswahl starten'}</button>
          </div>
        </section>
      ` : null}

      ${showDropZone ? html`
        <div class="drop-zone drop-zone-active" role="button" tabIndex="0" aria-disabled=${canMutate ? 'false' : 'true'}
          onClick=${onDropZoneClick} onKeyDown=${(event) => (event.key === 'Enter' || event.key === ' ') && onDropZoneClick()}
          onDragOver=${onDragOver} onDragLeave=${onDragLeave} onDrop=${onDrop}>
          <svg class="drop-zone-icon" viewBox="0 0 52 52" fill="none"><rect x="6" y="18" width="40" height="28" rx="4" stroke="currentColor" stroke-width="2"/><path d="M16 18v-4a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v4" stroke="currentColor" stroke-width="2"/><path d="M26 28v10M21 33l5-5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <p class="drop-zone-title">${photosLoaded ? 'Bildauswahl erweitern' : 'Bildauswahl starten'}</p>
          <p class="drop-zone-hint">JPEG · PNG · WebP · HEIC — Ordner oder einzelne Dateien hinzufügen; Drag-and-drop ist additiv.</p>
          <div class="input-action-row">
            <button class="btn btn-primary" onClick=${(event) => { event.stopPropagation(); openFolderInput(); }} type="button" disabled=${!canMutate}>Ordner hinzufügen</button>
            <button class="btn btn-secondary" onClick=${(event) => { event.stopPropagation(); openFileInput(); }} type="button" disabled=${!canMutate}>Dateien hinzufügen</button>
          </div>
        </div>
      ` : null}

      ${showLockedDropNote ? html`
        <div class="drop-zone-note" aria-live="polite">
          <span>${state.hydration === 'recovery' ? 'Laden ist im Recovery-Zustand gesperrt.' : 'Fotos hinzufügen ist für diese Bildauswahl gesperrt.'}</span>
          <span>Änderungen an der Arbeitsmenge nur über „Neue Bildauswahl starten“.</span>
        </div>
      ` : null}

      ${ingest.active ? html`<section class="start-section"><div class="card"><div class="flex items-center justify-between"><span class="label">Bildauswahl wird ergänzt</span><span class="badge badge-neutral mono">${ingest.done} / ${ingest.total}</span></div><div class="progress-bar" style="margin-top:var(--s3);"><div class="progress-fill" style=${'width:' + pct + '%'}></div></div></div></section>` : null}
      ${ingest.error ? html`<div class="info-banner start-banner" style="background:var(--red-dim); border-color:var(--red);"><span>Fehler der Bildauswahl: ${ingest.error}</span></div>` : null}

      <section class="start-section start-stats-section">
        <div class="start-section-title-row">
          <p class="label">Bildauswahl</p>
          <span class="badge badge-neutral mono">${diag.count} ${diag.count === 1 ? 'Foto' : 'Fotos'}</span>
        </div>
        <div class="start-stat-strip" aria-label="Eingangsdiagnose">
          <div class="start-stat-chip"><span class=${'start-stat-value ' + (photosLoaded ? 'loaded' : '')}>${photosLoaded ? diag.count : '0'}</span><span class="start-stat-label">Fotos</span></div>
          <div class="start-stat-chip"><span class="start-stat-value">${diag.heicPct == null ? '—' : diag.heicPct + '%'}</span><span class="start-stat-label">HEIC</span></div>
          <div class="start-stat-chip"><span class="start-stat-value">${diag.gpsPct == null ? '—' : diag.gpsPct + '%'}</span><span class="start-stat-label">GPS</span></div>
          <div class="start-stat-chip"><span class="start-stat-value">${state.worksetLocked ? 'fixiert' : 'offen'}</span><span class="start-stat-label">Status</span></div>
          <div class="start-stat-chip"><span class=${'start-stat-value ' + webgpuClass}>${webgpuCell}</span><span class="start-stat-label">Beschleunigung</span></div>
        </div>
      </section>

      ${showCuratingActions ? html`
        <section class="start-section start-presets-section" aria-label="Auswahl-Einstellungen vor der Verarbeitung">
          <${SelectionSettingsPanel}
            mode="initial"
            draftPresets=${normalizePresets(draftPresets)}
            disabled=${!canMutate}
            onChange=${onPresetChange}
          />
        </section>
      ` : null}

      ${showCuratingActions ? html`
        <div class="start-action-row">
          <button class="btn btn-secondary" type="button" disabled=${!canReset} onClick=${resetWorkset}>${resetting ? 'Setze zurück …' : 'Neue Bildauswahl starten'}</button>
          <button class="btn btn-primary btn-lg" disabled=${!photosLoaded || !canMutate || starting} onClick=${proceedToProcessing} type="button">${starting ? 'Speichere …' : 'Weiter zur Verarbeitung'}</button>
        </div>
      ` : null}

      <section class="start-section start-runtime-section">
        <div class="start-runtime-card">
          <div>
            <p class="font-display font-semibold text-sm">Laufzeitschätzung</p>
            <p class="text-xs text-muted" style="margin-top:4px;">${runtime ? `${diag.ok} Fotos · ${backend === 'gpu' ? 'Grafikbeschleunigung aktiv' : 'CPU-Modus'}` : 'Berechnung startet nach Auswahl'}</p>
          </div>
          <span class="badge badge-neutral mono">${runtime?.text || '—'}</span>
        </div>
        ${runtimeWarning ? html`<div class=${'info-banner runtime-banner ' + (runtimeWarning.level === 'warn' ? 'warn-banner' : '')}><span>${runtimeWarning.text}</span></div>` : null}
      </section>

      ${showPreview ? html`
        <section class="start-section start-preview-section">
          <div class="start-section-title-row">
            <p class="label">Vorschau</p>
            <span class="text-xs text-muted">Einzelne Fehlimporte können vor der Verarbeitung entfernt werden.</span>
          </div>
          <${IngestCurationGrid} photos=${orderedPhotos} canRemove=${canMutate} onRemove=${removePhoto} />
        </section>
      ` : null}

      <section class="privacy-clear-panel" aria-live="polite">
        ${privacyClear.message ? html`<div class="privacy-clear-note">${privacyClear.message}</div>` : null}
        ${privacyClear.error ? html`<div class="privacy-clear-error">Löschen fehlgeschlagen: ${privacyClear.error}</div>` : null}
        <div class="privacy-clear-copy">Privacy-Clear löscht alle lokalen Foto- und Analyseartefakte einschließlich Einstellungen.</div>
        ${privacyClear.confirm ? html`<div class="privacy-clear-confirm"><span>Wirklich löschen?</span><button class="btn btn-danger btn-sm" type="button" disabled=${!canReset} onClick=${confirmPrivacyClear}>${privacyClear.active ? 'Lösche …' : 'Ja, löschen'}</button><button class="btn btn-secondary btn-sm" type="button" disabled=${privacyClear.active} onClick=${cancelPrivacyClear}>Abbrechen</button></div>` : html`<button class="btn btn-ghost btn-sm privacy-clear-trigger" type="button" disabled=${!canReset} onClick=${requestPrivacyClear}>Alle lokalen Daten löschen</button>`}
      </section>
    </div>
  `;
}
