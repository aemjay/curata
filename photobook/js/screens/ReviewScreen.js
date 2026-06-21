// js/screens/ReviewScreen.js
// Etappe 7: echtes Review-UI-Grundgerüst. Keine Pipeline-/DB-Vertragsänderung.
// Die Auswahl ist bis Etappe 9 temporär: alle Cluster-Repräsentanten gelten als
// gewählt, Overrides werden nur im App-State protokolliert.

import { h, useContext, useEffect, useMemo, useRef, useState, htm as _htm } from '../deps.js';
const html = _htm.bind(h);
import { AppContext } from '../ctx.js';
import { buildChapterContextData, buildDiagnosisReport, buildReviewData, computeCoverage, computeOverrideQuote, detectWebGPU, formatChapterRange, rejectLabel } from '../selectors.js';
import { ContextNearMissCard, PickCard } from '../components/PickCard.js';
import { ClusterOverlay } from '../components/ClusterOverlay.js';
import { CoveragePanel } from '../components/CoveragePanel.js';
import { getMeta, putMeta } from '../db.js';
import { loadThumbUrl, revokeThumbUrl } from '../thumbs.js';
import { startPipeline, invalidateStages } from '../pipeline/runner.js';
import { markStagePending, rederiveStreamsForFocus } from '../pipeline/presetInvalidation.js';
import { VLM_LABELS_DE } from '../pipeline/s5_vlm.js';
import { beatLabel } from '../beats.js';
import { SelectionSettingsPanel, normalizePresets, samePresets, normalizeMaxPickCap, moreKeepExhausted } from '../components/SelectionSettingsPanel.js';



const CONTEXT_MODES = ['off', 'near', 'all'];
const CONTEXT_MODE_LABELS = Object.freeze({
  off: 'Aus',
  near: 'Knapp',
  all: 'Alle Verwürfe'
});

function normalizeContextMode(value) {
  return CONTEXT_MODES.includes(value) ? value : 'near';
}

const REVIEW_SIDE_TABS = Object.freeze([
  { key: 'settings', label: 'Einstellungen' },
  { key: 'coverage', label: 'Abdeckung' },
  { key: 'diagnostics', label: 'Diagnose' }
]);

function normalizeReviewSideTab(value) {
  return REVIEW_SIDE_TABS.some((tab) => tab.key === value) ? value : 'coverage';
}

function ReviewSideTabs({ value, onChange, settingsNeedsAttention = false }) {
  const active = normalizeReviewSideTab(value);

  function activateTab(key) {
    const next = normalizeReviewSideTab(key);
    onChange?.(next);
    if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined') {
      requestAnimationFrame(() => {
        document.getElementById('review-side-tab-' + next)?.focus?.();
      });
    }
  }

  function handleKeyDown(event, index) {
    const last = REVIEW_SIDE_TABS.length - 1;
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = index === last ? 0 : index + 1;
    if (event.key === 'ArrowLeft') nextIndex = index === 0 ? last : index - 1;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = last;
    if (nextIndex == null) return;
    event.preventDefault();
    activateTab(REVIEW_SIDE_TABS[nextIndex].key);
  }

  return html`
    <div class="review-side-tabs" role="tablist" aria-label="Inspektor">
      ${REVIEW_SIDE_TABS.map((tab, index) => {
        const selected = active === tab.key;
        return html`
          <button
            key=${tab.key}
            id=${'review-side-tab-' + tab.key}
            class=${'review-side-tab ' + (selected ? 'active' : '')}
            type="button"
            role="tab"
            aria-selected=${selected ? 'true' : 'false'}
            aria-controls=${'review-side-panel-' + tab.key}
            tabIndex=${selected ? 0 : -1}
            onClick=${() => activateTab(tab.key)}
            onKeyDown=${(event) => handleKeyDown(event, index)}
          >
            <span>${tab.label}</span>
            ${tab.key === 'settings' && settingsNeedsAttention ? html`
              <span class="review-side-tab-dot" aria-hidden="true"></span>
              <span class="sr-only">ungespeicherte Änderungen oder Neuberechnung ausstehend</span>
            ` : null}
          </button>
        `;
      })}
    </div>
  `;
}

function SidebarToggleIcon({ collapsed }) {
  const points = collapsed ? '10.5 4.5 7 8 10.5 11.5' : '5.5 4.5 9 8 5.5 11.5';
  return html`
    <svg class="review-sidebar-toggle-icon" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
      <rect x="2.75" y="3" width="10.5" height="10" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M6 3v10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <path d=${'M' + points} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}

function contextGroupKey(group) {
  return group?.chapter ? 'chapter-' + group.chapter.id : 'chapter-none';
}

function filterContextItems(items, mode) {
  const activeMode = normalizeContextMode(mode);
  return (items || []).filter((item) => {
    if (item.type === 'pick' || item.type === 'exPick') return true;
    if (activeMode === 'all') return item.type === 'nearMiss' || item.type === 'structural';
    if (activeMode === 'near') return item.type === 'nearMiss';
    return false;
  });
}

function ContextModeControl({ value, onChange, label = 'Verworfene anzeigen', disabled = false }) {
  const active = normalizeContextMode(value);
  return html`
    <div class="context-mode-control" role="group" aria-label=${label}>
      ${CONTEXT_MODES.map((mode) => html`
        <button
          key=${mode}
          class=${'context-mode-segment ' + (active === mode ? 'active' : '')}
          type="button"
          disabled=${disabled && mode !== 'off'}
          aria-pressed=${active === mode}
          onClick=${() => onChange(mode)}
        >${CONTEXT_MODE_LABELS[mode]}</button>
      `)}
    </div>
  `;
}


function selectNeedsRecalculation(pipelineState, selectParams, presets) {
  if (!pipelineState || !pipelineState.stages) return false;
  const selectStatus = pipelineState.stages.select?.status || null;
  if (selectStatus !== 'done') return true;
  if (!selectParams || selectParams.implVersion !== 'select-v5') return true;
  if (selectParams?.selectParamsSchema !== 'select-params-v3') return true;
  if (!Number.isFinite(Number(selectParams.tauSliderPos))) return true;
  const snapshot = selectParams.presetsSnapshot || selectParams.presets;
  if (!snapshot) return true;
  return !samePresets(normalizePresets(snapshot), normalizePresets(presets));
}

function stageDoneOrSkipped(stages, key) {
  const status = stages?.[key]?.status || null;
  return status === 'done' || status === 'skipped';
}

function recomputeNeedsHeavyPath(pipelineState) {
  const stages = pipelineState?.stages || {};
  return !stageDoneOrSkipped(stages, 'vlm') || !stageDoneOrSkipped(stages, 'scenes');
}

function selectProgressText(pipeline) {
  const progress = pipeline?.progress?.select || {};
  const done = Number(progress.done);
  const total = Number(progress.total);
  if (Number.isFinite(done) && Number.isFinite(total) && total > 0) {
    const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
    return `${Math.min(done, total)} von ${total} · ${pct}%`;
  }
  if (pipeline?.activeKey && pipeline.activeKey !== 'select') return `Vorbereitung: ${diagnosticStageLabel(pipeline.activeKey)}`;
  return 'Auswahl-Stufe startet …';
}

function buildReviewStatus({
  inlineRun,
  inlineStatus,
  inlineError,
  needsRecalc,
  overBudget,
  capSuffix,
  moreSideExhausted,
  temporarySelection,
  hasPhotos
}) {
  const secondary = [];
  const capLabel = capSuffix || '';

  let primary = null;
  if (inlineRun?.error) {
    primary = {
      key: 'inline-error',
      tone: 'warn',
      role: 'alert',
      ariaLive: null,
      title: 'Auswahl-Neuberechnung fehlgeschlagen',
      detail: inlineError || null,
      action: 'retry'
    };
  } else if (inlineRun?.active) {
    primary = {
      key: 'inline-active',
      tone: 'active',
      role: 'status',
      ariaLive: 'polite',
      title: 'Auswahl wird neu berechnet …',
      detail: inlineStatus || null,
      action: null
    };
  } else if (needsRecalc && hasPhotos) {
    primary = {
      key: 'needs-recalc',
      tone: 'warn',
      role: 'status',
      ariaLive: 'polite',
      title: 'Auswahl ist veraltet',
      detail: 'Einstellungen wurden geändert oder die Auswahlanalyse ist ungültig.',
      action: 'recalculate'
    };
  } else if (overBudget) {
    primary = {
      key: 'over-budget',
      tone: 'warn',
      role: 'status',
      ariaLive: 'polite',
      title: `Auswahlmenge über Budget${capLabel}`,
      detail: null,
      action: null
    };
  } else if (moreSideExhausted) {
    primary = {
      key: 'more-exhausted',
      tone: 'info',
      role: 'status',
      ariaLive: 'polite',
      title: '„mehr behalten“ erschöpft',
      detail: 'Für diesen Lauf sind bereits alle brauchbaren Aufnahmen der regulären Bildauswahl erreicht.',
      action: null
    };
  } else if (temporarySelection) {
    primary = {
      key: 'temporary-selection',
      tone: 'warn',
      role: 'status',
      ariaLive: 'polite',
      title: 'Temporäre Review-Auswahl',
      detail: 'Die Auswahl ist noch nicht final berechnet und speichert kein gültiges Analyseergebnis.',
      action: null
    };
  }

  if (!primary) return null;
  if (overBudget && primary.key !== 'over-budget') secondary.push(`über Budget${capLabel}`);
  if (moreSideExhausted && primary.key !== 'more-exhausted') secondary.push('„mehr behalten“ erschöpft');
  if (temporarySelection && primary.key !== 'temporary-selection') secondary.push('temporäre Auswahl');

  return { ...primary, secondary };
}

function chapterTitle(group, idx) {
  if (!group.chapter) return 'Ohne Kapitel';
  return `Kapitel ${idx + 1}`;
}


const GALLERY_VIEW_META_KEY = 'ui:galleryView';
const DEFAULT_GALLERY_VIEW = Object.freeze({ fit: 'justified', size: 'm' });
const GALLERY_FITS = Object.freeze(['justified', 'uniform']);
const GALLERY_SIZES = Object.freeze(['s', 'm', 'l']);
const JUSTIFIED_TARGET_HEIGHT = Object.freeze({ s: 140, m: 200, l: 280 });
const UNIFORM_CELL_SIZE = Object.freeze({ s: 120, m: 170, l: 240 });
const MIN_JUSTIFIED_ITEM_W = 120;

function normalizeGalleryView(raw) {
  const fit = GALLERY_FITS.includes(raw?.fit) ? raw.fit : DEFAULT_GALLERY_VIEW.fit;
  const size = GALLERY_SIZES.includes(raw?.size) ? raw.size : DEFAULT_GALLERY_VIEW.size;
  return { fit, size };
}

function GalleryViewControl({ value, onChange }) {
  const view = normalizeGalleryView(value);
  const setFit = (fit) => onChange?.({ fit });
  const setSize = (size) => onChange?.({ size });
  return html`
    <div class="gallery-view-controls" aria-label="Galerie-Ansicht">
      <div class="gallery-view-group" role="group" aria-label="Bildanpassung">
        <button
          class=${'gallery-view-segment ' + (view.fit === 'justified' ? 'active' : '')}
          type="button"
          aria-pressed=${view.fit === 'justified'}
          onClick=${() => setFit('justified')}
          title="Justified: volle Bilder in gleichmäßigen Reihen"
        >Justified</button>
        <button
          class=${'gallery-view-segment ' + (view.fit === 'uniform' ? 'active' : '')}
          type="button"
          aria-pressed=${view.fit === 'uniform'}
          onClick=${() => setFit('uniform')}
          title="Raster: gleichmäßige Zellen ohne Crop"
        >Raster</button>
      </div>
      <div class="gallery-view-group gallery-size-group" role="group" aria-label="Galeriegröße">
        ${GALLERY_SIZES.map((size) => html`
          <button
            key=${size}
            class=${'gallery-view-segment ' + (view.size === size ? 'active' : '')}
            type="button"
            aria-pressed=${view.size === size}
            onClick=${() => setSize(size)}
            title=${'Größe ' + size.toUpperCase()}
          >${size.toUpperCase()}</button>
        `)}
      </div>
    </div>
  `;
}

function galleryItemAspect(item) {
  const photo = item?.photo || {};
  const w = Number(photo.width);
  const h = Number(photo.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  return Math.max(0.5, Math.min(2.0, w / h));
}

function rowSizes(aspects, width, gap, targetHeight, stretch) {
  const n = aspects.length;
  if (!n) return [];
  const sum = aspects.reduce((acc, aspect) => acc + aspect, 0) || 1;
  const rawHeight = stretch ? (width - gap * (n - 1)) / sum : targetHeight;
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : targetHeight;
  return aspects.map((aspect) => {
    const rawWidth = Math.round(aspect * height);
    const boundedWidth = n === 1 ? Math.min(Math.max(MIN_JUSTIFIED_ITEM_W, rawWidth), Math.max(MIN_JUSTIFIED_ITEM_W, width)) : Math.max(MIN_JUSTIFIED_ITEM_W, rawWidth);
    return {
      width: boundedWidth,
      height: Math.max(1, Math.round(height))
    };
  });
}

function rowTargetWidth(aspects, gap, targetHeight) {
  if (!aspects.length) return 0;
  return aspects.reduce((acc, aspect) => acc + Math.max(MIN_JUSTIFIED_ITEM_W, aspect * targetHeight), 0) + gap * (aspects.length - 1);
}

function buildJustifiedLayout(items, width, gap, targetHeight) {
  const rows = [];
  let row = [];
  let rowAspect = 0;

  for (const item of items) {
    const aspect = galleryItemAspect(item);
    if (!row.length) {
      row = [aspect];
      rowAspect = aspect;
      continue;
    }

    const nextRow = row.concat(aspect);
    const nextAspect = rowAspect + aspect;

    if (rowTargetWidth(nextRow, gap, targetHeight) > width) {
      rows.push(rowSizes(row, width, gap, targetHeight, false));
      row = [aspect];
      rowAspect = aspect;
      continue;
    }

    const reachesWidth = nextAspect * targetHeight + gap * (nextRow.length - 1) >= width;

    if (!reachesWidth) {
      row = nextRow;
      rowAspect = nextAspect;
      continue;
    }

    const stretchedHeight = (width - gap * (nextRow.length - 1)) / nextAspect;
    const minWidth = Math.min(...nextRow.map((a) => a * stretchedHeight));
    if (Number.isFinite(stretchedHeight) && stretchedHeight > 0 && minWidth >= MIN_JUSTIFIED_ITEM_W) {
      rows.push(rowSizes(nextRow, width, gap, targetHeight, true));
      row = [];
      rowAspect = 0;
    } else {
      rows.push(rowSizes(row, width, gap, targetHeight, false));
      row = [aspect];
      rowAspect = aspect;
    }
  }

  if (row.length) rows.push(rowSizes(row, width, gap, targetHeight, false));
  return rows.flat();
}

function applyJustifiedLayout(strip, items, size) {
  if (!strip) return;
  const nodes = Array.from(strip.children).filter((node) => node.classList?.contains('justified-item'));
  if (!nodes.length) return;
  const width = strip.clientWidth || 0;
  if (width <= 0) return;
  const styles = window.getComputedStyle(strip);
  const gap = Number.parseFloat(styles.columnGap || styles.gap) || 12;
  const targetHeight = JUSTIFIED_TARGET_HEIGHT[size] || JUSTIFIED_TARGET_HEIGHT.m;
  const layout = buildJustifiedLayout(items, width, gap, targetHeight);
  nodes.forEach((node, index) => {
    const item = layout[index] || { width: MIN_JUSTIFIED_ITEM_W, height: targetHeight };
    node.style.width = item.width + 'px';
    node.style.height = item.height + 'px';
  });
  strip.classList.add('justified-ready');
}

function GallerySceneStrip({ sceneGroup, galleryView, mode, review, onInclude, onExclude, onOpenCluster, onOpenLightbox }) {
  const stripRef = useRef(null);
  const view = normalizeGalleryView(galleryView);
  const visibleItems = sceneGroup.visibleItems || [];
  const layoutKey = visibleItems
    .map((item) => [item.type, item.photo?.id, item.photo?.width, item.photo?.height].join(':'))
    .join('|');

  useEffect(() => {
    if (view.fit !== 'justified') return undefined;
    const strip = stripRef.current;
    if (!strip || typeof window === 'undefined') return undefined;
    let frame = 0;
    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        try {
          applyJustifiedLayout(strip, visibleItems, view.size);
        } catch (err) {
          strip.classList.remove('justified-ready');
          console.warn('[Review] Justified-Galerie konnte nicht layouten; CSS-Fallback bleibt aktiv.', err);
        }
      });
    };
    schedule();

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(schedule);
      resizeObserver.observe(strip);
    } else {
      window.addEventListener('resize', schedule);
    }

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      strip.classList.remove('justified-ready');
      Array.from(strip.children).forEach((node) => {
        node.style.width = '';
        node.style.height = '';
      });
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener('resize', schedule);
    };
  }, [view.fit, view.size, layoutKey]);

  function itemClusterSize(item) {
    const photo = item?.photo || {};
    return photo.clusterId ? (review.clusterCounts.get(photo.clusterId) || 1) : 1;
  }

  function renderWrappedItem(item, index) {
    const renderMain = () => item.type === 'pick' ? html`
      <${PickCard}
        key=${'pick-' + item.photo.id}
        photo=${item.photo}
        clusterSize=${itemClusterSize(item)}
        isFirstInChapter=${index === 0}
        isLastInChapter=${index === visibleItems.length - 1}
        onOpenCluster=${onOpenCluster}
        onOpenLightbox=${onOpenLightbox}
        onExclude=${onExclude}
        onMoveUp=${() => {}}
        onMoveDown=${() => {}}
        temporarySelection=${review.temporarySelection}
        isManual=${item.overrideStatus === 'included' || (item.photo.picked !== true && !review.temporarySelection)}
        showReorder=${false}
        actionLabel="Ablehnen"
      />
    ` : html`
      <${ContextNearMissCard}
        key=${item.type + '-' + item.photo.id}
        photo=${item.photo}
        type=${item.type}
        clusterSize=${itemClusterSize(item)}
        onOpenCluster=${onOpenCluster}
        onOpenLightbox=${onOpenLightbox}
        onAction=${onInclude}
        actionLabel="Zurückholen"
      />
    `;
    const body = renderMain();
    return html`
      <div
        key=${view.fit + '-' + item.type + '-' + item.photo.id}
        class=${'gallery-item ' + (view.fit === 'justified' ? 'justified-item' : 'uniform-item')}
        data-layout-aspect=${galleryItemAspect(item).toFixed(4)}
      >${body}</div>
    `;
  }

  return html`
    <div
      ref=${stripRef}
      class=${'story-strip context-story-strip gallery-strip is-' + view.fit + ' gallery-size-' + view.size}
      style=${{ '--gallery-cell-size': (UNIFORM_CELL_SIZE[view.size] || UNIFORM_CELL_SIZE.m) + 'px' }}
    >
      ${visibleItems.map(renderWrappedItem)}
    </div>
  `;
}

function ContextReviewChapter({ group, index, mode, onModeChange, galleryView, review, onInclude, onExclude, onOpenCluster, onOpenLightbox }) {
  const items = group.items || [];
  const sceneGroups = group.scenes && group.scenes.length ? group.scenes : [{ scene: null, items }];
  const visibleSceneGroups = sceneGroups
    .map((sceneGroup) => ({ ...sceneGroup, visibleItems: filterContextItems(sceneGroup.items || [], mode) }))
    .filter((sceneGroup) => sceneGroup.visibleItems.length > 0);
  const nearMissCount = group.nearMissCount || 0;
  const structuralCount = group.structuralCount || 0;
  const hasContextRejects = nearMissCount + structuralCount > 0;


  return html`
    <section class="review-chapter context-chapter">
      <header class="review-chapter-header">
        <div>
          <p class="chapter-index">${chapterTitle(group, index)}</p>
          <h2>${formatChapterRange(group.chapter)}</h2>
        </div>
        <div class="review-chapter-stats context-chapter-stats">
          <span>${nearMissCount} knapp</span>
          <span>${structuralCount} strukturell</span>
          <${ContextModeControl}
            value=${mode}
            onChange=${onModeChange}
            label=${chapterTitle(group, index) + ': Verworfene anzeigen'}
            disabled=${!hasContextRejects}
          />
        </div>
      </header>

      <div class="context-note">
        Eine Arbeitssicht: ausgewählte Bilder ablehnen, verworfene Bilder zurückholen. Manuell abgelehnte Bilder bleiben sichtbar und reversibel.
      </div>

      <div class="context-scenes-stack">
        ${visibleSceneGroups.map((sceneGroup, sceneIdx) => html`
          <section class="context-scene-block" key=${sceneGroup.scene?.id || 'scene-' + sceneIdx}>
            <header class="context-scene-header">
              <div>
                <p>${sceneTitle(sceneGroup.scene, sceneIdx)}</p>
                <h3>${formatSceneRange(sceneGroup.scene)}</h3>
              </div>
              <div class="context-scene-tags">
                ${sceneGroup.scene?.place ? html`<span>${vlmLabel(sceneGroup.scene.place)}</span>` : null}
                ${sceneGroup.scene?.activity ? html`<span>${vlmLabel(sceneGroup.scene.activity)}</span>` : null}
                <span>${sceneGroup.visibleItems.length} sichtbar</span>
              </div>
            </header>
            <${GallerySceneStrip}
              sceneGroup=${sceneGroup}
              galleryView=${galleryView}
              mode=${mode}
              review=${review}
              onInclude=${onInclude}
              onExclude=${onExclude}
              onOpenCluster=${onOpenCluster}
              onOpenLightbox=${onOpenLightbox}
            />
          </section>
        `)}
      </div>
    </section>
  `;
}


function sceneTitle(scene, index) {
  if (!scene || !scene.id) return `Szene ${index + 1}`;
  const n = Number.isInteger(scene.displayIndex) ? scene.displayIndex + 1 : (Number.isInteger(scene.index) ? scene.index + 1 : index + 1);
  return `Szene ${n}`;
}

function formatSceneRange(scene) {
  if (!scene) return 'Noch keine Szenen-Metadaten';
  const start = Number(scene.start);
  const end = Number(scene.end);
  const prefix = [vlmLabel(scene.place), vlmLabel(scene.activity)].filter(Boolean).join(' · ');
  const time = Number.isFinite(start) && Number.isFinite(end)
    ? formatTimeSpan(start, end)
    : null;
  const count = Number.isFinite(Number(scene.count)) ? `${scene.count} Bilder` : null;
  return [prefix || 'Aufnahme-Situation', time, count].filter(Boolean).join(' · ');
}

function formatTimeSpan(start, end) {
  try {
    const fmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `${fmt.format(new Date(start))}–${fmt.format(new Date(end))}`;
  } catch (_) {
    return '';
  }
}



function Lightbox({ photo, action, onClose }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!photo) return undefined;
    let alive = true;
    loadThumbUrl(photo.id).then((loaded) => { if (alive) setUrl(loaded); }).catch((err) => {
      console.warn('[Lightbox] Thumb konnte nicht geladen werden:', err);
    });
    function onKey(event) {
      if (event.key === 'Escape') onClose?.();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      window.removeEventListener('keydown', onKey);
      revokeThumbUrl(photo.id);
    };
  }, [photo?.id]);

  function handleAction() {
    action?.handler?.();
    onClose?.();
  }

  if (!photo) return null;
  return html`
    <div class="overlay-backdrop lightbox-backdrop" role="dialog" aria-modal="true" aria-label=${photo.name + ' Großansicht'} onClick=${onClose}>
      <div class="lightbox-panel" onClick=${(event) => event.stopPropagation()}>
        <button class="lightbox-close" type="button" onClick=${onClose} aria-label="Großansicht schließen">×</button>
        <div class="lightbox-layout">
          <div class="lightbox-main">
            <div class="lightbox-image-frame">
              ${url
                ? html`<img src=${url} alt=${photo.name} decoding="async" />`
                : html`<span class="pick-thumb-skeleton" aria-hidden="true"></span>`}
            </div>
            <p class="lightbox-caption" title=${photo.name}>${photo.name}</p>
          </div>
          <${LightboxMetaPanel} photo=${photo} action=${action} onAction=${handleAction} />
        </div>
      </div>
    </div>
  `;
}

function LightboxMetaPanel({ photo, action, onAction }) {
  const qualityRows = [
    { label: 'Schärfe', value: photo?.tech?.sharpness },
    { label: 'Belichtung', value: photo?.tech?.exposure },
    { label: 'Moment', value: photo?.vlm?.momentScore },
    { label: 'Lächeln', value: photo?.faces?.smile }
  ];
  const contentChips = lightboxContentChips(photo);
  const exif = compactExifItems(photo);
  const tau = parseTauReason(photo?.reason);
  const status = photoStatusLabel(photo) || 'Status offen';
  const reject = photo?._effectiveRejectReason ? rejectLabel(photo._effectiveRejectReason) : (photo?.rejectReason ? rejectLabel(photo.rejectReason) : null);

  return html`
    <aside class="lightbox-meta" aria-label="Bild-Metadaten">
      <header class="lightbox-meta-head">
        <span class=${'pick-status-badge ' + lightboxStatusKind(photo)}>${status}</span>
        ${reject ? html`<span class="lightbox-chip reject">${reject}</span>` : null}
      </header>

      <section class="lightbox-meta-section">
        <h3>Qualität</h3>
        <div class="score-meter-stack">
          ${qualityRows.map((row) => html`<${ScoreMeter} key=${row.label} label=${row.label} value=${row.value} />`)}
        </div>
      </section>

      <section class="lightbox-meta-section">
        <h3>Auswahl-Begründung</h3>
        ${tau ? html`<${TauMeter} gain=${tau.gain} tau=${tau.tau} />` : null}
        ${photo?.reason ? html`<p class="lightbox-reason">${photo.reason}</p>` : html`<p class="lightbox-reason muted">Keine Begründung vorhanden.</p>`}
      </section>

      ${contentChips.length ? html`
        <section class="lightbox-meta-section">
          <h3>Inhalt</h3>
          <div class="lightbox-chip-cloud">
            ${contentChips.map((chip) => html`<span key=${chip.key} class=${chip.className}>${chip.label}</span>`)}
          </div>
        </section>
      ` : null}

      ${photo?.vlm?.caption ? html`
        <section class="lightbox-meta-section">
          <h3>Beschreibung</h3>
          <p class="lightbox-description">${photo.vlm.caption}</p>
        </section>
      ` : null}

      ${exif.length ? html`
        <section class="lightbox-meta-section">
          <h3>EXIF</h3>
          <div class="lightbox-exif-row">
            ${exif.slice(0, 6).map((item) => html`<span key=${item.label} title=${item.label}>${item.icon}<strong>${item.value}</strong></span>`)}
          </div>
          <details class="lightbox-details">
            <summary>Details</summary>
            <dl>
              ${extendedMetaRows(photo).map((row) => html`
                <div key=${row.label} class="lightbox-meta-row">
                  <dt>${row.label}</dt>
                  <dd>${row.value}</dd>
                </div>
              `)}
            </dl>
          </details>
        </section>
      ` : null}

      ${action ? html`
        <div class="lightbox-touch-action">
          <button class=${'btn btn-sm ' + (action.variant === 'danger' ? 'btn-danger' : 'btn-secondary')} type="button" onClick=${onAction}>${action.label}</button>
        </div>
      ` : null}
    </aside>
  `;
}

function ScoreMeter({ label, value }) {
  const n = normalizeUnit(value);
  const width = n == null ? 0 : Math.round(n * 100);
  return html`
    <div class="score-meter">
      <div class="score-meter-label"><span>${label}</span><strong>${n == null ? '—' : width + '%'}</strong></div>
      <div class="score-meter-track" aria-label=${label + ' ' + (n == null ? 'unbekannt' : width + '%')}>
        <span class=${'score-meter-fill ' + scoreClassName(n)} style=${{ width: width + '%' }}></span>
      </div>
    </div>
  `;
}

function TauMeter({ gain, tau }) {
  const g = normalizeUnit(gain) ?? 0;
  const t = normalizeUnit(tau) ?? 0;
  return html`
    <div class="tau-meter" aria-label=${'Grenznutzen ' + Math.round(g * 100) + ' Prozent, Tau ' + Math.round(t * 100) + ' Prozent'}>
      <div class="tau-meter-track">
        <span class="tau-meter-fill" style=${{ width: Math.round(g * 100) + '%' }}></span>
        <span class="tau-meter-marker" style=${{ left: Math.round(t * 100) + '%' }}></span>
      </div>
      <div class="tau-meter-labels"><span>Grenznutzen ${formatPercent(g)}</span><span>τ ${formatPercent(t)}</span></div>
    </div>
  `;
}

function normalizeUnit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}

function scoreClassName(value) {
  if (value == null) return 'neutral';
  return value >= 0.66 ? 'good' : value >= 0.33 ? 'mid' : 'low';
}

function parseTauReason(reason) {
  const text = String(reason || '');
  if (!text) return null;
  const gainMatch = text.match(/Grenznutzen\s*([0-9]+(?:[,.][0-9]+)?)/i);
  const tauMatch = text.match(/τ\s*([0-9]+(?:[,.][0-9]+)?)/i);
  if (!gainMatch || !tauMatch) return null;
  const gain = Number(gainMatch[1].replace(',', '.'));
  const tau = Number(tauMatch[1].replace(',', '.'));
  if (!Number.isFinite(gain) || !Number.isFinite(tau)) return null;
  return { gain, tau };
}

function lightboxStatusKind(photo) {
  if (photo?._overrideStatus === 'included') return 'manual';
  if (photo?._overrideStatus === 'excluded') return 'manual-out';
  if (photo?._effectivePicked || photo?.picked) return 'pick';
  if (photo?._effectiveRejectReason || photo?.rejectReason) return 'structural';
  return 'temporary';
}

function lightboxContentChips(photo) {
  const chips = [];
  const add = (key, label, className = 'lightbox-chip') => { if (label) chips.push({ key, label, className }); };
  add('stream', streamLabel(photo?.stream), 'lightbox-chip');
  add('beat', beatLabel(photo?.beat), 'lightbox-chip beat-chip beat-' + (photo?.beat || 'none'));
  add('place', vlmLabel(photo?.vlm?.place), 'lightbox-chip');
  add('activity', vlmLabel(photo?.vlm?.activity), 'lightbox-chip');
  add('mood', vlmLabel(photo?.vlm?.mood), 'lightbox-chip');
  add('shotType', vlmLabel(photo?.vlm?.shotType), 'lightbox-chip');
  return chips;
}

function compactExifItems(photo) {
  const o = photo?.exifOptics || {};
  return [
    { label: 'Kamera', icon: 'Kamera ', value: joinParts([o.make, o.model], ' ') },
    { label: 'Objektiv', icon: 'Objektiv ', value: o.lensModel },
    { label: 'Brennweite', icon: 'ƒ ', value: formatNumberUnit(o.focalLength, 'mm', 1) || formatNumberUnit(o.focalLength35mm, 'mm', 0) },
    { label: 'Blende', icon: 'Blende ', value: formatFNumber(o.fNumber) },
    { label: 'ISO', icon: 'ISO ', value: formatIso(o.iso) },
    { label: 'Zeit', icon: 'Zeit ', value: formatExposureTime(o.exposureTime) },
    { label: 'GPS', icon: 'GPS ', value: formatCoordinates(photo?.gps) }
  ].filter((item) => item.value);
}

function extendedMetaRows(photo) {
  const rows = [];
  const add = (label, value) => { const clean = cleanMetaValue(value); if (clean) rows.push({ label, value: clean }); };
  add('Aufnahme', formatDateTime(photo?.takenAt));
  add('Datei geändert', photo?.takenAt ? null : formatDateTime(photo?.lastModified));
  add('EXIF Original', photo?.exifTime?.dateTimeOriginalRaw);
  add('EXIF Zeitzone', photo?.exifTime?.offsetTimeOriginal);
  add('GPS-Zeit', joinParts([photo?.exifTime?.gpsDateStamp, photo?.exifTime?.gpsTimeStamp], ' · '));
  add('Koordinaten', formatCoordinates(photo?.gps));
  add('Höhe', formatNumberUnit(photo?.gps?.alt, 'm', 0));
  add('Richtung', formatNumberUnit(photo?.gps?.dir, '°', 0));
  add('Maße', formatDimensions(photo));
  add('Datei', photo?.name);
  add('Kapitel', photo?.chapterId == null ? null : String(photo.chapterId + 1));
  add('Szene', photo?.sceneId || null);
  add('Ähnliche Gruppe', photo?.clusterId || null);
  return rows;
}

function buildLightboxMetaGroups(photo) {
  const groups = [];
  addMetaGroup(groups, 'Zeit', [
    ['Aufnahme', formatDateTime(photo?.takenAt)],
    ['Datei geändert', photo?.takenAt ? null : formatDateTime(photo?.lastModified)],
    ['EXIF Original', photo?.exifTime?.dateTimeOriginalRaw],
    ['EXIF Zeitzone', photo?.exifTime?.offsetTimeOriginal],
    ['GPS-Zeit', joinParts([photo?.exifTime?.gpsDateStamp, photo?.exifTime?.gpsTimeStamp], ' · ')]
  ]);
  addMetaGroup(groups, 'Optik', [
    ['Kamera', joinParts([photo?.exifOptics?.make, photo?.exifOptics?.model], ' ')],
    ['Objektiv', photo?.exifOptics?.lensModel],
    ['Brennweite', formatNumberUnit(photo?.exifOptics?.focalLength, 'mm', 1)],
    ['Brennweite 35mm', formatNumberUnit(photo?.exifOptics?.focalLength35mm, 'mm', 0)],
    ['Digitalzoom', formatNumberUnit(photo?.exifOptics?.digitalZoomRatio, '×', 2)],
    ['Blende', formatFNumber(photo?.exifOptics?.fNumber)],
    ['ISO', formatIso(photo?.exifOptics?.iso)],
    ['Belichtungszeit', formatExposureTime(photo?.exifOptics?.exposureTime)]
  ]);
  addMetaGroup(groups, 'Ort', [
    ['Koordinaten', formatCoordinates(photo?.gps)],
    ['Höhe', formatNumberUnit(photo?.gps?.alt, 'm', 0)],
    ['Richtung', formatNumberUnit(photo?.gps?.dir, '°', 0)]
  ]);
  addMetaGroup(groups, 'Inhalt', [
    ['Ortstyp', vlmLabel(photo?.vlm?.place)],
    ['Aktivität', vlmLabel(photo?.vlm?.activity)],
    ['Stimmung', vlmLabel(photo?.vlm?.mood)],
    ['Ausschnitt', vlmLabel(photo?.vlm?.shotType)],
    ['Momentbewertung', formatPercent(photo?.vlm?.momentScore)],
    ['Beschreibung', photo?.vlm?.caption]
  ]);
  addMetaGroup(groups, 'Technik', [
    ['Schärfe', formatPercent(photo?.tech?.sharpness)],
    ['Belichtung', formatPercent(photo?.tech?.exposure)],
    ['Maße', formatDimensions(photo)]
  ]);
  addMetaGroup(groups, 'Personen', [
    ['Gesichter', numberText(photo?.faces?.count)],
    ['Lächeln', formatPercent(photo?.faces?.smile)],
    ['Blink', photo?.faces?.blink == null ? null : (photo.faces.blink ? 'ja' : 'nein')]
  ]);
  addMetaGroup(groups, 'Struktur', [
    ['Status', photoStatusLabel(photo)],
    ['Verwurfsgrund', photo?._effectiveRejectReason ? rejectLabel(photo._effectiveRejectReason) : (photo?.rejectReason ? rejectLabel(photo.rejectReason) : null)],
    ['Kategorie', streamLabel(photo?.stream)],
    ['Kapitel', photo?.chapterId == null ? null : String(photo.chapterId + 1)],
    ['Szene', photo?.sceneId || null],
    ['Ähnliche Gruppe', photo?.clusterId]
  ]);
  return groups;
}

function addMetaGroup(groups, title, rows) {
  const clean = rows
    .map(([label, value]) => ({ label, value: cleanMetaValue(value) }))
    .filter((row) => row.value != null);
  if (clean.length) groups.push({ title, rows: clean });
}

function cleanMetaValue(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  const text = String(value).trim();
  return text ? text : null;
}

function formatDateTime(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(n));
  } catch (_) {
    return new Date(n).toISOString();
  }
}

function formatNumberUnit(value, unit, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${n.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits > 0 ? 0 : 0 })} ${unit}`;
}

function formatFNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `f/${n.toLocaleString('de-DE', { maximumFractionDigits: 1 })}`;
}

function formatIso(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.round(n));
}

function formatExposureTime(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1) {
    const denom = Math.max(1, Math.round(1 / n));
    return `1/${denom} s`;
  }
  return `${n.toLocaleString('de-DE', { maximumFractionDigits: 2 })} s`;
}

function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n * 100)}%`;
}

function formatCoordinates(gps) {
  const lat = Number(gps?.lat);
  const lon = Number(gps?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function formatDimensions(photo) {
  const w = Number(photo?.width);
  const h = Number(photo?.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return `${Math.round(w)} × ${Math.round(h)} px`;
}

function numberText(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : null;
}

function joinParts(parts, sep) {
  const clean = (parts || []).map(cleanMetaValue).filter(Boolean);
  return clean.length ? clean.join(sep) : null;
}

function vlmLabel(value) {
  return value == null ? null : (VLM_LABELS_DE[value] || value);
}

function streamLabel(stream) {
  return stream === 'P' ? 'Personen' : stream === 'M' ? 'M-Anker' : stream === 'S' ? 'Ort/Szene' : null;
}

function photoStatusLabel(photo) {
  if (!photo) return null;
  if (photo.status === 'failed') return 'nicht verarbeitbar';
  if (photo._effectivePicked === true) return 'ausgewählt';
  if (photo._overrideStatus === 'included') return 'manuell aufgenommen';
  if (photo._overrideStatus === 'excluded') return 'manuell abgelehnt';
  if (photo._effectiveRejectReason || photo.rejectReason) return 'verworfen';
  if (photo.picked === true) return 'ausgewählt';
  return 'verworfen';
}

const DIAGNOSTIC_STAGE_LABELS = {
  technical: 'Technik',
  chapters: 'Tage',
  faces: 'Gesichter',
  persons: 'Personen',
  embeddings: 'Ähnliche Fotos',
  vlm: 'Bildinhalte',
  scenes: 'Szenen',
  select: 'Auswahl'
};

function diagnosticStageLabel(key) {
  return DIAGNOSTIC_STAGE_LABELS[key] || key;
}

function DiagnosticsPanel({ diagnosis, onExport, disabled }) {
  const ag = diagnosis?.aggregates || {};
  const quote = ag.overrideQuote || { count: 0, pct: 0, selectionSize: 0, perChapter: [] };
  const rejects = ag.rejectReasonDistribution || {};
  const streams = ag.streams?.distribution || [];
  const beat = ag.beatCoverage || { covered: 0, possible: 0, pct: null };
  const topChapters = ag.chaptersWithMostOverrides || [];
  const swapClusters = ag.clustersWithFrequentSwaps || [];
  const meta = ag.runMetadata || {};
  const stageEntries = Object.entries(meta.stages || {}).sort((a, b) => a[0].localeCompare(b[0]));

  return html`
    <section class="diagnostics-panel" aria-label="Qualitätsdiagnose">
      <div class="diagnostics-panel-head">
        <span>Qualitätsdiagnose</span>
        <span>${quote.pct ?? 0}% manuelle Anpassungen</span>
      </div>
      <div class="diagnostics-body">
        <p class="diagnostics-privacy">
          Diese Datei enthält Bildbeschreibungen, Dateinamen und abgeleitete Tags aus deinem Fotoordner (keine Bilder).
          Teile sie nur mit Personen, denen du diese Einsicht gewähren willst.
        </p>
        <button class="btn btn-secondary diagnostics-export" type="button" disabled=${disabled} onClick=${onExport}>
          Diagnose exportieren
        </button>

        <div class="diagnostics-grid">
          <div><strong>${quote.count}</strong><span>manuelle Anpassungen</span></div>
          <div><strong>${ag.reincludedRejects ?? 0}</strong><span>verworfene Bilder zurückgeholt</span></div>
          <div><strong>${ag.removedAutoPicks ?? 0}</strong><span>automatisch ausgewählte Bilder entfernt</span></div>
          <div><strong>${beat.covered}/${beat.possible}</strong><span>Schlüsselmomente · ${formatPct(beat.pct)}</span></div>
        </div>

        <section class="diagnostics-section">
          <h3>Manuelle Anpassungen pro Kapitel</h3>
          ${quote.perChapter?.length ? html`
            <ol class="diagnostics-list">
              ${quote.perChapter.slice(0, 8).map((row) => html`<li key=${row.label}><span>${row.label}</span><strong>${row.overrides}/${row.selected} · ${formatPct(row.pct)}</strong></li>`)}
            </ol>
          ` : html`<p class="diagnostics-empty">Keine Kapitelwerte.</p>`}
        </section>

        <section class="diagnostics-section">
          <h3>Gründe für Verwürfe</h3>
          <div class="diagnostics-kv">
            ${['budget', 'redundant', 'stream', 'duplicate'].map((key) => html`
              <p key=${key}><span>${rejectLabel(key)}</span><strong>${rejects[key] || 0}</strong></p>
            `)}
          </div>
        </section>

        <section class="diagnostics-section">
          <h3>Kategorien vs. Fokus-Ziel</h3>
          <div class="diagnostics-kv">
            ${streams.map((s) => html`
              <p key=${s.stream}><span>${s.stream}</span><strong>${s.count} · ${s.pct}% / Ziel ${s.targetPct}%</strong></p>
            `)}
          </div>
        </section>

        <section class="diagnostics-section">
          <h3>Kapitel mit den meisten manuellen Anpassungen</h3>
          ${topChapters.length ? html`
            <ol class="diagnostics-list">
              ${topChapters.slice(0, 5).map((row) => html`<li key=${row.label}><span>${row.label}</span><strong>${row.overrides} · ${formatPct(row.pct)}</strong></li>`)}
            </ol>
          ` : html`<p class="diagnostics-empty">Keine manuellen Anpassungen.</p>`}
        </section>

        <section class="diagnostics-section">
          <h3>Ähnliche Gruppen mit Tausch</h3>
          ${swapClusters.length ? html`
            <ol class="diagnostics-list">
              ${swapClusters.slice(0, 5).map((row) => html`<li key=${row.clusterId}><span class="mono">${row.clusterId}</span><strong>${row.swaps}</strong></li>`)}
            </ol>
          ` : html`<p class="diagnostics-empty">Kein Tausch.</p>`}
        </section>

        <section class="diagnostics-section">
          <h3>Lauf-Metadaten</h3>
          <div class="diagnostics-kv">
            <p><span>Fotos</span><strong>${meta.photoCount ?? 0}</strong></p>
            <p><span>Kapitel</span><strong>${meta.chapterCount ?? 0}</strong></p>
            <p><span>Beschleunigung</span><strong>${meta.backend || 'unbekannt'}</strong></p>
            <p><span>Plattform</span><strong>${meta.platform || '—'}</strong></p>
            <p><span>Browser</span><strong title=${meta.browser || ''}>${shortText(meta.browser || '—', 32)}</strong></p>
            <p><span>Verarbeitung</span><strong>${meta.pipelineVersion == null ? '—' : 'v' + meta.pipelineVersion}</strong></p>
          </div>
          ${stageEntries.length ? html`
            <ol class="diagnostics-list">
              ${stageEntries.map(([key, value]) => html`<li key=${key}><span>${diagnosticStageLabel(key)}</span><strong>${value.status || '—'}</strong></li>`)}
            </ol>
          ` : null}
        </section>
      </div>
    </section>
  `;
}

function formatPct(value) {
  return value == null ? '—' : `${value}%`;
}

function shortText(value, max) {
  const text = String(value || '');
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


function isDockedReviewSidebar() {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 1160px)').matches;
}

function initialSidebarCollapsed() {
  return typeof window !== 'undefined' ? window.matchMedia('(max-width: 1159.98px)').matches : true;
}

function browserEnvironment(backend) {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  return {
    browser: nav?.userAgent || null,
    platform: nav?.platform || null,
    backend: backend || null
  };
}

export function ReviewScreen() {
  const { state, dispatch } = useContext(AppContext);
  const { photos, chapters, scenes, overrides, presets } = state;
  const [activeCluster, setActiveCluster] = useState(null);
  const [activeLightbox, setActiveLightbox] = useState(null);
  const [needsRecalc, setNeedsRecalc] = useState(false);
  const [diagnosticContext, setDiagnosticContext] = useState({ pipelineState: null, selectParams: null, backend: null });
  const [contextModeByChapter, setContextModeByChapter] = useState({});
  const [globalContextMode, setGlobalContextMode] = useState('near');
  const [draftPresets, setDraftPresets] = useState(() => normalizePresets(presets));
  const [applyState, setApplyState] = useState('idle');
  const [inlineRun, setInlineRun] = useState({ active: false, error: false, preview: null });
  const [sideCollapsed, setSideCollapsed] = useState(() => initialSidebarCollapsed());
  const [activeSideTab, setActiveSideTab] = useState('coverage');
  const [galleryView, setGalleryViewState] = useState(DEFAULT_GALLERY_VIEW);
  const galleryViewLoadedRef = useRef(false);
  const sidebarToggleRef = useRef(null);

  useEffect(() => {
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    let alive = true;
    getMeta(GALLERY_VIEW_META_KEY)
      .then((raw) => {
        if (alive) setGalleryViewState(normalizeGalleryView(raw));
      })
      .catch((err) => {
        console.warn('[Review] Galerie-Ansicht konnte nicht gelesen werden:', err);
      })
      .finally(() => {
        if (alive) galleryViewLoadedRef.current = true;
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!galleryViewLoadedRef.current) return;
    const view = normalizeGalleryView(galleryView);
    putMeta(GALLERY_VIEW_META_KEY, view).catch((err) => {
      console.warn('[Review] Galerie-Ansicht konnte nicht gespeichert werden:', err);
    });
  }, [galleryView.fit, galleryView.size]);

  function setGalleryView(patch) {
    setGalleryViewState((prev) => normalizeGalleryView({ ...prev, ...patch }));
  }

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(min-width: 1160px)');
    function syncSidebarMode(event) {
      setSideCollapsed(!event.matches);
    }
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', syncSidebarMode);
      return () => media.removeEventListener('change', syncSidebarMode);
    }
    media.addListener(syncSidebarMode);
    return () => media.removeListener(syncSidebarMode);
  }, []);

  function closeSidebar(returnFocus = true) {
    setSideCollapsed(true);
    if (returnFocus && typeof window !== 'undefined') {
      window.setTimeout(() => sidebarToggleRef.current?.focus?.(), 0);
    }
  }

  function toggleSidebar() {
    if (sideCollapsed) {
      setSideCollapsed(false);
    } else {
      closeSidebar();
    }
  }

  function handleReviewLayoutClick(event) {
    if (!sideCollapsed && !isDockedReviewSidebar() && event.target === event.currentTarget) {
      closeSidebar();
    }
  }

  function openLightbox(photo, action = null) {
    setActiveLightbox({ photo, action });
  }

  const pipelineRunning = state.pipeline?.status === 'running';
  const inlineRecomputeVisible = inlineRun.active || inlineRun.error;
  const liveReview = useMemo(
    () => buildReviewData(photos, chapters, overrides, presets),
    [photos, chapters, overrides, presets]
  );
  const liveChapterContext = useMemo(
    () => buildChapterContextData(photos, chapters, liveReview, presets, scenes),
    [photos, chapters, scenes, liveReview, presets]
  );
  const review = inlineRecomputeVisible && inlineRun.preview?.review ? inlineRun.preview.review : liveReview;
  const chapterContext = inlineRecomputeVisible && inlineRun.preview?.chapterContext ? inlineRun.preview.chapterContext : liveChapterContext;

  useEffect(() => {
    setDraftPresets(normalizePresets(presets));
  }, [presets.selectionMode, presets.focus, presets.techStrict, presets.maxPickCap, presets.tauSliderPos]);

  useEffect(() => {
    if (!inlineRecomputeVisible) return;
    if (state.pipeline?.status === 'done') {
      setInlineRun({ active: false, error: false, preview: null });
    } else if (state.pipeline?.status === 'error') {
      setInlineRun((prev) => prev.active ? { ...prev, active: false, error: true } : prev);
    }
  }, [inlineRecomputeVisible, state.pipeline?.status]);

  useEffect(() => {
    if (sideCollapsed || typeof window === 'undefined' || isDockedReviewSidebar()) return undefined;
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !isDockedReviewSidebar()) {
        event.preventDefault();
        closeSidebar();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sideCollapsed]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pipelineState, selectParams, backend] = await Promise.all([
          getMeta('pipelineState'),
          getMeta('selectParams'),
          detectWebGPU()
        ]);
        if (!cancelled) {
          setNeedsRecalc(selectNeedsRecalculation(pipelineState, selectParams, presets));
          setDiagnosticContext({ pipelineState, selectParams, backend: backend === 'gpu' ? 'Grafikbeschleunigung' : 'CPU-Modus' });
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[ReviewScreen] Rechenbedarf konnte nicht geprüft werden:', err);
          setNeedsRecalc(false);
          setDiagnosticContext((ctx) => ({ ...ctx, pipelineState: state.pipeline || null }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [presets, photos.length, state.pipeline?.stages?.select?.status]);

  // ExportScreen nutzt state.selection/state.rejected. Bis E12 ist dies die
  // einzige harmlose Synchronisierung der abgeleiteten Review-Sicht in den State.
  useEffect(() => {
    dispatch({ type: 'SET_SELECTION', payload: review.selection });
    dispatch({ type: 'SET_REJECTED', payload: review.rejected });
  }, [dispatch, review.selection, review.rejected]);

  const coverage = useMemo(() => computeCoverage(review, presets, overrides), [review, presets, overrides]);
  const diagnosis = useMemo(() => buildDiagnosisReport({
    photos,
    chapters,
    overrides,
    presets,
    review,
    selectParams: diagnosticContext.selectParams || null,
    pipelineState: diagnosticContext.pipelineState || state.pipeline || null,
    ...browserEnvironment(diagnosticContext.backend)
  }), [photos, chapters, overrides, presets, review, diagnosticContext, state.pipeline]);
  const activeSidePanel = normalizeReviewSideTab(activeSideTab);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await putMeta('overrides', overrides || []);
      } catch (err) {
        if (!cancelled) console.error('[ReviewScreen] Override-Persistenz fehlgeschlagen:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [overrides]);

  const selectedCount = review.selection.length;
  const contextNearMissCount = chapterContext.nearMissCount || 0;
  const contextStructuralCount = chapterContext.structuralCount || 0;
  const contextRejectCount = chapterContext.rejectedContextCount || (contextNearMissCount + contextStructuralCount);
  const budgetInfo = review.budgetInfo || { picked: selectedCount, auto: true, maxPickCap: normalizeMaxPickCap(presets), manual: 0 };
  const selectParams = diagnosticContext.selectParams || null;
  const moreSideExhausted = !needsRecalc && moreKeepExhausted(selectParams);
  const manualSuffix = budgetInfo.manual > 0 ? ` · ${budgetInfo.manual} manuell` : '';
  const capSuffix = budgetInfo.maxPickCap ? ` · Obergrenze ${budgetInfo.maxPickCap}` : '';
  const overBudget = Number.isFinite(Number(budgetInfo.maxPickCap)) && Number(budgetInfo.maxPickCap) > 0 &&
    Number.isFinite(Number(budgetInfo.picked)) && Number(budgetInfo.picked) > Number(budgetInfo.maxPickCap);
  const overrideStats = computeOverrideQuote(overrides, selectedCount);
  const overrideCount = overrideStats.count;
  const overrideQuote = overrideStats.pct;
  const hasPhotos = photos.length > 0;
  const hasSelection = selectedCount > 0;
  const hasWorkItems = (chapterContext.groups || []).length > 0;
  const normalizedDraftPresets = normalizePresets(draftPresets);
  const normalizedCurrentPresets = normalizePresets(presets);
  const settingsDirty = !samePresets(normalizedDraftPresets, normalizedCurrentPresets);
  const settingsNeedsAttention = settingsDirty || needsRecalc;
  const inlineStatus = inlineRun.active ? selectProgressText(state.pipeline) : null;
  const inlineError = inlineRun.error ? (state.pipeline?.error || 'Auswahl-Neuberechnung ist fehlgeschlagen.') : null;
  const reviewStatus = buildReviewStatus({
    inlineRun,
    inlineStatus,
    inlineError,
    needsRecalc,
    overBudget,
    capSuffix,
    moreSideExhausted,
    temporarySelection: hasSelection && review.temporarySelection,
    hasPhotos
  });

  function runRecompute({ heavy }) {
    if (heavy === true) {
      dispatch({ type: 'SET_SCREEN', screen: 'processing' });
      startPipeline({ dispatch });
      return;
    }
    setInlineRun({ active: true, error: false, preview: { review, chapterContext } });
    startPipeline({ dispatch });
  }

  function recalculateSelection() {
    if (pipelineRunning) return;
    const stateStages = state.pipeline?.stages || {};
    const pipelineState = Object.keys(stateStages).length ? state.pipeline : diagnosticContext.pipelineState;
    runRecompute({ heavy: recomputeNeedsHeavyPath(pipelineState) });
  }

  function retryInlineRecompute() {
    if (pipelineRunning) return;
    setInlineRun((prev) => ({
      active: true,
      error: false,
      preview: prev.preview || { review, chapterContext }
    }));
    startPipeline({ dispatch });
  }

  function setDraftPreset(key, value) {
    setApplyState('idle');
    setDraftPresets((prev) => normalizePresets({ ...prev, [key]: value }));
  }

  async function applySelectionSettings() {
    if (pipelineRunning || !settingsDirty || applyState === 'saving') return;
    const current = normalizePresets(presets);
    const next = normalizePresets(draftPresets);
    const focusChanged = current.focus !== next.focus;

    setApplyState('saving');
    try {
      await putMeta('presets', next);
      dispatch({ type: 'SET_PRESETS', payload: next });

      if (focusChanged) {
        const streamResult = await rederiveStreamsForFocus(next.focus, dispatch);
        const invalidation = await invalidateStages(['vlm', 'scenes', 'select'], {
          dispatch,
          context: { reason: 'review:focus', changedPhotoIds: streamResult.changedPhotoIds || [] },
          status: 'idle'
        });
        dispatch({ type: 'UPDATE_PHOTOS', payload: invalidation.photos || [] });
      } else {
        await markStagePending('select', dispatch);
      }

      setNeedsRecalc(true);
      setApplyState('applied');
      if (!isDockedReviewSidebar()) closeSidebar();
      runRecompute({ heavy: false });
    } catch (err) {
      console.error('[ReviewScreen] Auswahl-Einstellungen konnten nicht angewendet werden:', err);
      setApplyState('error');
    }
  }

  function include(photo) {
    dispatch({ type: 'TOGGLE_PICK', photoId: photo.id, picked: true, reason: photo.reason || null });
  }

  function exclude(photo) {
    dispatch({ type: 'TOGGLE_PICK', photoId: photo.id, picked: false, reason: photo.reason || null });
  }

  function openCluster(photo) {
    if (!photo || !photo.clusterId) return;
    setActiveCluster({ clusterId: photo.clusterId, selectedId: photo.id });
  }


  function swapClusterMember(target) {
    if (!activeCluster || !target) return;
    const previous = review.selection.find((p) => p.id === activeCluster.selectedId);
    dispatch({
      type: 'SWAP_PICK',
      photoId: target.id,
      reason: previous?.reason || null
    });
    setActiveCluster({ clusterId: activeCluster.clusterId, selectedId: target.id });
  }

  function jumpToRejectedFromCoverage(chapter, beat) {
    void beat;
    setGlobalContextMode('all');
    if (chapter && chapter.id != null) {
      setContextModeByChapter((prev) => ({ ...prev, ['chapter-' + chapter.id]: 'all' }));
    }
  }

  function getContextChapterMode(group) {
    return normalizeContextMode(contextModeByChapter[contextGroupKey(group)] || globalContextMode);
  }

  function setContextChapterMode(group, mode) {
    const key = contextGroupKey(group);
    const nextMode = normalizeContextMode(mode);
    setContextModeByChapter((prev) => ({ ...prev, [key]: nextMode }));
  }

  function setAllContextMode(mode) {
    setGlobalContextMode(normalizeContextMode(mode));
    setContextModeByChapter({});
  }

  async function exportDiagnosis() {
    const backend = await detectWebGPU();
    const payload = buildDiagnosisReport({
      photos,
      chapters,
      overrides,
      presets,
      review,
      selectParams: diagnosticContext.selectParams || null,
      pipelineState: diagnosticContext.pipelineState || state.pipeline || null,
      ...browserEnvironment(backend === 'gpu' ? 'Grafikbeschleunigung' : 'CPU-Modus')
    });
    downloadJson(payload, 'diagnose.json');
  }

  const clusterMembers = activeCluster
    ? (review.clusterMap.get(activeCluster.clusterId) || [])
    : [];

  return html`
    <div class="screen review-screen">
      <header class="review-header">
        <div>
          <p class="screen-eyebrow">Schritt 3 / 4</p>
          <h1 class="screen-title">Bildauswahl</h1>
          <p class="screen-subtitle">
            ${review.temporarySelection
              ? 'Vereinheitlichte Arbeitssicht mit Szenenblöcken. Die Auswahl-Analyse fehlt noch; temporär gilt das beste Foto je ähnlicher Gruppe als ausgewählt.'
              : 'Vereinheitlichte Arbeitssicht. Tage enthalten Szenenblöcke; ausgewählte und verworfene Bilder bleiben darin chronologisch verwoben. Einstellungen beeinflussen nur die Auswahl.'}
          </p>
        </div>

        <div class="review-counters">
          <div class=${'review-counter ' + (overBudget ? 'over-budget' : '')}>
            <p><strong>${budgetInfo.picked}</strong><span> Bilder · automatischer Umfang${capSuffix}${manualSuffix}</span></p>
            <label>Auswahl</label>
          </div>
          <div class="review-counter">
            <p class=${overrideQuote > 30 ? 'warn' : ''}><strong>${overrideCount}</strong><span> manuell — ${overrideQuote}%</span></p>
            <label>Manuelle Anpassungen</label>
          </div>
          <${GalleryViewControl}
            value=${galleryView}
            onChange=${setGalleryView}
          />
          ${needsRecalc && hasPhotos ? html`
            <button class="btn btn-secondary" type="button" disabled=${pipelineRunning} onClick=${recalculateSelection}>
              ${pipelineRunning ? 'Berechnet …' : 'Neu berechnen'}
            </button>
          ` : null}
          <button class="btn btn-primary" type="button" disabled=${!hasSelection || needsRecalc} onClick=${() => dispatch({ type: 'SET_SCREEN', screen: 'export' })}>
            Export
          </button>
        </div>
      </header>

      ${reviewStatus ? html`
        <div
          class=${'info-banner review-status-channel review-temp-note ' + (reviewStatus.tone === 'warn' ? 'warn-banner' : '') + (reviewStatus.tone === 'active' ? ' inline-recompute-banner' : '')}
          role=${reviewStatus.role}
          aria-live=${reviewStatus.ariaLive}
        >
          <div class="review-status-main">
            <strong>${reviewStatus.title}</strong>
            ${reviewStatus.detail ? html`<span>${reviewStatus.detail}</span>` : null}
          </div>
          ${reviewStatus.secondary.length ? html`
            <div class="review-status-chips" aria-label="Weitere Hinweise">
              ${reviewStatus.secondary.map((chip) => html`<span class="review-status-chip" key=${chip}>${chip}</span>`)}
            </div>
          ` : null}
          ${reviewStatus.action === 'retry' ? html`
            <button class="btn btn-secondary" type="button" disabled=${pipelineRunning} onClick=${retryInlineRecompute}>Retry</button>
          ` : null}
          ${reviewStatus.action === 'recalculate' ? html`
            <button class="btn btn-secondary" type="button" disabled=${pipelineRunning} onClick=${recalculateSelection}>Neu berechnen</button>
          ` : null}
        </div>
      ` : null}

      ${!hasPhotos ? html`
        <div class="empty-state">
          <p class="empty-state-title">Noch keine Fotos geladen</p>
          <p class="empty-state-hint">Wähle zuerst einen Ordner und durchlaufe die Verarbeitung bis zur Ähnlichkeitsstufe.</p>
          <button class="btn btn-secondary" type="button" onClick=${() => dispatch({ type: 'SET_SCREEN', screen: 'start' })}>Zum Start</button>
        </div>
      ` : !hasWorkItems ? html`
        <div class="empty-state">
          <p class="empty-state-title">Keine Elemente für den Review</p>
          <p class="empty-state-hint">Starte oder wiederhole die Verarbeitung bis mindestens zur Auswahlstufe.</p>
          <button class="btn btn-secondary" type="button" onClick=${() => dispatch({ type: 'SET_SCREEN', screen: 'processing' })}>Zur Verarbeitung</button>
        </div>
      ` : html`
        <div class=${'review-layout ' + (sideCollapsed ? 'sidebar-collapsed' : '')} onClick=${handleReviewLayoutClick}>
          <div class=${'review-main ' + (inlineRun.active ? 'inline-recompute-dimmed' : '')}>
            <div class="review-book-stack context-book-stack unified-review-stack">
              <div class="info-banner context-intro">
                <span>
                  Ausgewählte und eingeblendete verworfene Bilder liegen je Tag in chronologischen Szenenblöcken. Aus = ausgewählte Bilder plus manuell abgelehnte frühere Auswahlen, Knapp = zusätzlich knappe Verwürfe, Alle Verwürfe = zusätzlich Mengenlimit-/Kategorie-/Redundanz-Verwürfe. Dubletten erscheinen nicht als freie Elemente, sondern gebündelt in der Box für ähnliche Fotos.
                </span>
                <div class="context-global-control">
                  <span>für alle Kapitel</span>
                  <${ContextModeControl}
                    value=${globalContextMode}
                    onChange=${setAllContextMode}
                    label="Für alle Kapitel: Verworfene anzeigen"
                    disabled=${contextRejectCount === 0}
                  />
                </div>
              </div>
              ${chapterContext.groups.map((group, idx) => html`
                <${ContextReviewChapter}
                  key=${group.chapter ? 'context-chapter-' + group.chapter.id : 'context-chapter-none'}
                  group=${group}
                  index=${idx}
                  mode=${getContextChapterMode(group)}
                  onModeChange=${(mode) => setContextChapterMode(group, mode)}
                  galleryView=${galleryView}
                  review=${review}
                  onInclude=${include}
                  onExclude=${exclude}
                  onOpenCluster=${openCluster}
                  onOpenLightbox=${openLightbox}
                />
              `)}
            </div>
          </div>
          <div class="review-sidebar">
            <button
              ref=${sidebarToggleRef}
              class=${'review-sidebar-toggle ' + (sideCollapsed && settingsNeedsAttention ? 'is-dirty' : '')}
              type="button"
              aria-expanded=${!sideCollapsed}
              aria-label=${sideCollapsed ? 'Werkzeuge einblenden' : 'Werkzeuge ausblenden'}
              title=${sideCollapsed ? 'Werkzeuge einblenden' : 'Werkzeuge ausblenden'}
              onClick=${toggleSidebar}
            >
              <${SidebarToggleIcon} collapsed=${sideCollapsed} />
              ${sideCollapsed && settingsNeedsAttention ? html`
                <span class="review-sidebar-dirty-dot" aria-hidden="true"></span>
                <span class="sr-only">ungespeicherte Änderungen oder Neuberechnung ausstehend</span>
              ` : null}
            </button>
            <aside class="review-side-stack" aria-hidden=${sideCollapsed}>
              <${ReviewSideTabs}
                value=${activeSidePanel}
                onChange=${(t) => setActiveSideTab(normalizeReviewSideTab(t))}
                settingsNeedsAttention=${settingsNeedsAttention}
              />
              <div
                id=${'review-side-panel-' + activeSidePanel}
                class="review-side-tab-panel"
                role="tabpanel"
                aria-labelledby=${'review-side-tab-' + activeSidePanel}
              >
                ${activeSidePanel === 'settings'
                  ? html`<${SelectionSettingsPanel}
                      draftPresets=${normalizedDraftPresets}
                      dirty=${settingsDirty}
                      disabled=${pipelineRunning}
                      needsRecalc=${needsRecalc}
                      applyState=${applyState}
                      selectParams=${selectParams}
                      onChange=${setDraftPreset}
                      onApply=${applySelectionSettings}
                    />`
                  : activeSidePanel === 'coverage'
                    ? html`<${CoveragePanel} coverage=${coverage} onFindRejected=${jumpToRejectedFromCoverage} collapsible=${false} />`
                    : html`<${DiagnosticsPanel} diagnosis=${diagnosis} onExport=${exportDiagnosis} disabled=${!hasPhotos} />`}
              </div>
            </aside>
          </div>
        </div>
      `}

      <${ClusterOverlay}
        clusterId=${activeCluster && activeCluster.clusterId}
        members=${clusterMembers}
        selectedId=${activeCluster && activeCluster.selectedId}
        onClose=${() => setActiveCluster(null)}
        onSwap=${swapClusterMember}
      />
      <${Lightbox} photo=${activeLightbox?.photo || null} action=${activeLightbox?.action || null} onClose=${() => setActiveLightbox(null)} />
    </div>
  `;
}
