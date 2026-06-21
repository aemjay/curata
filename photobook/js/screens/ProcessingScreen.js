// js/screens/ProcessingScreen.js
import { h, useContext, useRef, useState, useEffect, useMemo, htm as _htm } from '../deps.js';
const html = _htm.bind(h);
import { AppContext } from '../ctx.js';
import { STAGES } from '../pipeline/stages.js';
import { startPipeline, pausePipeline, resumePipeline } from '../pipeline/runner.js';
import { computeDiagnostics, humanizeDuration } from '../selectors.js';
import { getMeta, putMeta } from '../db.js';

const STAGE_DETAIL = {
  technical:  'Prüft Schärfe und Belichtung der Fotos.',
  chapters:   'Ordnet Fotos nach Tagen und größeren Aufnahmeabschnitten.',
  faces:      'Erkennt Gesichter und grobe Bildtypen.',
  persons:    'Wird in dieser Version übersprungen.',
  embeddings: 'Findet ähnliche Fotos und wählt das beste der Gruppe.',
  vlm:        'Analysiert Bildinhalte und erstellt Beschreibungen.',
  scenes:     'Bildet Szenen innerhalb der Tage.',
  select:     'Bewertet die Fotos und erstellt die vorläufige Auswahl.'
};

function StageIcon({ status }) {
  if (status === 'done') {
    return html`<svg width="12" height="10" viewBox="0 0 12 10" fill="none">
      <path d="M1 5l4 4 6-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  if (status === 'active') {
    return html`<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="8 4">
        <animateTransform attributeName="transform" type="rotate" from="0 6 6" to="360 6 6" dur="1.2s" repeatCount="indefinite"/>
      </circle>
    </svg>`;
  }
  if (status === 'skipped') return html`<span aria-hidden="true">—</span>`;
  if (status === 'error') {
    return html`<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 1l5 10H1L6 1Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>`;
  }
  return null;
}

export function ProcessingScreen() {
  const { state, dispatch } = useContext(AppContext);
  const { pipeline, photos, chapters, scenes, presets } = state;

  const isRunning = pipeline.status === 'running';
  const isPaused  = pipeline.status === 'paused';
  const isDone    = pipeline.status === 'done';
  const isError   = pipeline.status === 'error';

  const hasPhotos = photos.length > 0;
  const diag = useMemo(() => computeDiagnostics(photos), [photos]);
  const stageStates = pipeline.stages || {};
  const activeKey = pipeline.activeKey || STAGES[pipeline.stage]?.key || null;

  const completedCount = STAGES.filter((stage) => {
    const s = stageStates[stage.key]?.status;
    return s === 'done' || s === 'skipped';
  }).length;
  const activeStage = STAGES.find((stage) => stage.key === activeKey) || null;
  const activeIndex = activeStage ? STAGES.indexOf(activeStage) : -1;
  const activeProg = activeStage
    ? (pipeline.progress?.[activeStage.key] || pipeline.progress?.[activeIndex] || { done: 0, total: 0 })
    : { done: 0, total: 0 };
  const activeFrac = activeProg.total > 0 ? activeProg.done / activeProg.total : 0;
  const overall = isDone ? 1 : Math.min(1, (completedCount + (isRunning ? activeFrac : 0)) / Math.max(1, STAGES.length));
  const overallPct = Math.round(overall * 100);

  const startedRef = useRef(false);
  const startTimeRef = useRef(null);
  const rateEwmaRef = useRef(0);
  const lastSampleRef = useRef(null);
  const sampleCountRef = useRef(0);
  const wakeRef = useRef(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (pipeline.status === 'idle') {
      startedRef.current = false;
      startTimeRef.current = null;
      rateEwmaRef.current = 0;
      lastSampleRef.current = null;
      sampleCountRef.current = 0;
    }
  }, [pipeline.status]);

  // Auto-Start nur aus idle. Error-Retry bleibt explizit.
  useEffect(() => {
    if (startedRef.current) return;
    if (!hasPhotos) return;
    if (pipeline.status === 'idle') {
      startedRef.current = true;
      startWithPersistedPresets();
    }
  }, [pipeline.status, hasPhotos]);

  useEffect(() => {
    if (isRunning && startTimeRef.current == null) startTimeRef.current = Date.now();
  }, [pipeline.status, isRunning]);

  useEffect(() => {
    if (!isRunning) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  useEffect(() => {
    let cancelled = false;
    async function acquire() {
      try {
        if ('wakeLock' in navigator) {
          const lock = await navigator.wakeLock.request('screen');
          if (cancelled) { lock.release().catch(() => {}); return; }
          wakeRef.current = lock;
        }
      } catch (_) { /* Wake Lock nicht verfügbar — unkritisch */ }
    }
    async function release() {
      try { if (wakeRef.current) { await wakeRef.current.release(); wakeRef.current = null; } } catch (_) {}
    }
    if (isRunning) acquire(); else release();
    return () => { cancelled = true; release(); };
  }, [isRunning]);

  const now = Date.now();
  const prevSample = lastSampleRef.current;
  if (isRunning && prevSample) {
    const dt = (now - prevSample.t) / 1000;
    const dOverall = overall - prevSample.overall;
    if (dt > 0 && dt < 5 && dOverall > 0) {
      const inst = dOverall / dt;
      const ALPHA = 0.25;
      rateEwmaRef.current = rateEwmaRef.current > 0
        ? ALPHA * inst + (1 - ALPHA) * rateEwmaRef.current
        : inst;
      sampleCountRef.current += 1;
    }
  }
  if (isRunning) lastSampleRef.current = { t: now, overall };

  let remainingText = null;
  if (isRunning && overall > 0.02 && rateEwmaRef.current > 0 && sampleCountRef.current >= 3) {
    const remaining = (1 - overall) / rateEwmaRef.current;
    if (Number.isFinite(remaining) && remaining >= 0) remainingText = humanizeDuration(remaining);
  }

  async function startWithPersistedPresets() {
    try {
      const saved = await getMeta('presets');
      if (!saved || typeof saved !== 'object') await putMeta('presets', presets);
      await startPipeline({ dispatch });
    } catch (error) {
      console.error('[ProcessingScreen] Einstellungen konnten nicht gespeichert werden:', error);
      dispatch({ type: 'PIPELINE_ERROR', error: 'Einstellungen konnten nicht gespeichert werden. Verarbeitung nicht gestartet.' });
    }
  }

  function onPauseResume() {
    if (isRunning) pausePipeline();
    else if (isPaused) resumePipeline({ dispatch });
  }

  function onRetry() {
    startWithPersistedPresets();
  }

  function statusLine() {
    if (isError) return pipeline.error ? `Fehler — ${pipeline.error}` : 'Fehler — Analyse erneut versuchen';
    if (isDone) return 'Verarbeitung abgeschlossen.';
    if (isPaused) return 'Pausiert — aktuelle Analyse wird beim Fortsetzen geprüft und ggf. wiederholt.';
    if (isRunning) return remainingText ? `Restzeit ${remainingText}` : 'Restzeit wird berechnet …';
    return hasPhotos ? 'Startet …' : 'Keine Fotos geladen';
  }

  return html`
    <div class="screen" style="max-width:800px;">

      <header class="screen-header">
        <p class="screen-eyebrow">Schritt 2 / 4</p>
        <h1 class="screen-title">Verarbeitung</h1>
        <p class="screen-subtitle">
          ${hasPhotos
            ? `${photos.length} Fotos · Analyse läuft lokal im Browser.`
            : 'Noch keine Fotos geladen. Bitte zuerst Schritt 1 abschließen.'}
        </p>
      </header>

      <div class="card" style="margin-bottom:var(--s6);">
        <div class="flex items-center justify-between" style="margin-bottom:var(--s3);">
          <span class="label">Gesamtfortschritt</span>
          <span class="mono text-sm" style="color:var(--accent-text);">
            ${isDone ? 'Fertig' : activeStage ? `Aktuell: ${activeStage.label}` : `${completedCount} / ${STAGES.length}`}
          </span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style=${'width:' + overallPct + '%'}></div>
        </div>
        <div class="flex items-center justify-between" style="margin-top:var(--s3);">
          <span class="text-xs text-muted">${statusLine()}</span>
          <span class="mono text-xs text-muted">${overallPct} %</span>
        </div>
        ${chapters && chapters.length > 0 ? html`
          <p class="text-xs" style="margin-top:var(--s2); color:var(--accent-text);">
            ${chapters.length} ${chapters.length === 1 ? 'Kapitel' : 'Kapitel'} erkannt${scenes && scenes.length ? ` · ${scenes.length} Szenen` : ''}
          </p>
        ` : null}
      </div>

      <section style="margin-bottom:var(--s6);">
        <p class="label" style="margin-bottom: var(--s3);">Diagnose</p>
        <div class="diag-grid">
          <div class="diag-cell">
            <span class="diag-value loaded">${diag.count || '—'}</span>
            <span class="diag-label">Fotos</span>
          </div>
          <div class="diag-cell">
            <span class="diag-value">${diag.timedPct == null ? '—' : diag.timedPct + '%'}</span>
            <span class="diag-label">Zeitstempel</span>
          </div>
          <div class="diag-cell">
            <span class="diag-value">${diag.gpsPct == null ? '—' : diag.gpsPct + '%'}</span>
            <span class="diag-label">GPS</span>
          </div>
          <div class="diag-cell">
            <span class=${'diag-value ' + (diag.failed > 0 ? 'warn' : 'ok')}>${diag.failed}</span>
            <span class="diag-label">Fehlerhaft</span>
          </div>
        </div>
      </section>

      <div class="panel" style="margin-bottom:var(--s6);">
        <div class="panel-header">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 4h12M2 8h8M2 12h5" stroke="var(--text-secondary)" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span class="label">Analyseschritte</span>
        </div>
        <div class="stage-list">
          ${STAGES.map((stage, i) => {
            const saved = stageStates[stage.key] || {};
            const status = saved.status || 'pending';
            const prog = pipeline.progress?.[stage.key] || pipeline.progress?.[i] || null;
            const statusText = status === 'done'
              ? 'OK'
              : status === 'skipped'
                ? 'übersprungen'
                : status === 'error'
                  ? 'Fehler'
                  : status === 'active'
                    ? (prog && prog.total ? `Schritt ${prog.done} von ${prog.total}` : 'läuft …')
                    : 'ausstehend';
            const inlineStyle = status === 'error'
              ? 'color:var(--red);'
              : status === 'skipped'
                ? 'color:var(--text-muted);'
                : '';

            return html`
              <div class=${'stage-item ' + status} key=${stage.key}>
                <div class="stage-indicator" style=${inlineStyle}>
                  <${StageIcon} status=${status} />
                  ${status === 'pending' ? i + 1 : ''}
                </div>
                <div class="stage-info">
                  <p class="stage-name">${stage.label}</p>
                  <p class="stage-detail">${STAGE_DETAIL[stage.key] || ''}</p>
                  ${saved.error ? html`<p class="stage-detail" style="color:var(--red);">${saved.error}</p>` : null}
                </div>
                <div class="stage-status" style=${inlineStyle}>${statusText}</div>
              </div>
            `;
          })}
        </div>
      </div>

      <div class="info-banner warn-banner" style="margin-bottom:var(--s6);">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style="flex-shrink:0;margin-top:1px;">
          <path d="M9 2v5M9 11v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M16 9A7 7 0 1 1 2 9a7 7 0 0 1 14 0Z" stroke="currentColor" stroke-width="1.5"/>
        </svg>
        <span>
          Bitte den Tab offen lassen. Ohne Grafikbeschleunigung dauert die Bildanalyse deutlich länger;
          der Lauf bleibt pausierbar und kann nach einem Reload fortgesetzt werden.
        </span>
      </div>

      ${isError && html`
        <div class="info-banner" style="margin-bottom:var(--s6); background: var(--red-dim); border-color: var(--red); color: var(--text-secondary);">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style="flex-shrink:0;margin-top:1px;color:var(--red);">
            <path d="M9 2L1 16h16L9 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M9 7v4M9 13v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span>
            Eine Analyse ist abgebrochen. Bereits gültige Analyseschritte bleiben erhalten;
            „Erneut versuchen" startet bei der fehlerhaften bzw. ersten ungültigen Analyse.
          </span>
        </div>
      `}

      <div class="flex items-center gap-4">
        <button
          class="btn btn-ghost"
          onClick=${() => dispatch({ type: 'SET_SCREEN', screen: 'start' })}
          type="button"
        >
          ← Start
        </button>

        ${(isRunning || isPaused) && html`
          <button class="btn btn-secondary btn-lg" onClick=${onPauseResume} type="button">
            ${isRunning
              ? html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="4" height="12" rx="1" fill="currentColor"/><rect x="9" y="2" width="4" height="12" rx="1" fill="currentColor"/></svg> Pausieren`
              : html`<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 3l9 5-9 5V3Z" fill="currentColor"/></svg> Fortsetzen`
            }
          </button>
        `}

        ${isError && html`
          <button class="btn btn-primary btn-lg" onClick=${onRetry} type="button">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2v3h-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Erneut versuchen
          </button>
        `}

        ${isDone && html`
          <button
            class="btn btn-primary btn-lg"
            onClick=${() => dispatch({ type: 'SET_SCREEN', screen: 'review' })}
            type="button"
          >
            Review öffnen
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M7 5l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        `}
      </div>

    </div>
  `;
}
