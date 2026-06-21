// js/components/PickCard.js
// Kompakte Review-Karte: Bild, Status, bedingte Ecksignale und Hover-/Fokus-Aktion.

import { h, useEffect, useRef, useState, htm as _htm } from '../deps.js';
const html = _htm.bind(h);
import { loadThumbUrl, revokeThumbUrl, observeThumb } from '../thumbs.js';
import { rejectLabel } from '../selectors.js';


function Thumb({ photo, onOpenLightbox, lightboxAction }) {
  const ref = useRef(null);
  const [url, setUrl] = useState(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || photo.status === 'failed') return undefined;
    let alive = true;
    const stop = observeThumb(
      el,
      async () => { const u = await loadThumbUrl(photo.id); if (alive) setUrl(u); },
      () => { revokeThumbUrl(photo.id); if (alive) setUrl(null); }
    );
    return () => { alive = false; stop(); revokeThumbUrl(photo.id); };
  }, [photo.id, photo.status]);

  function open(event) {
    event.stopPropagation();
    onOpenLightbox?.(photo, lightboxAction || null);
  }

  return html`
    <button ref=${ref} class="pick-thumb" type="button" onClick=${open} aria-label=${photo.name + ' groß anzeigen'}>
      ${url
        ? html`<img src=${url} alt=${photo.name} decoding="async" />`
        : html`<span class="pick-thumb-skeleton" aria-hidden="true"></span>`}
    </button>
  `;
}

function statusForPick(photo, temporarySelection, isManual) {
  if (photo.status === 'failed') return { label: 'Fehler', kind: 'reject' };
  const manualStatus = photo._overrideStatus || (isManual ? 'included' : null);
  if (manualStatus === 'included') return { label: 'manuell', kind: 'manual' };
  if (temporarySelection) return { label: 'vorläufig', kind: 'temporary' };
  return { label: 'Pick', kind: 'pick' };
}

function statusForContext(photo, type) {
  const rejectReason = photo._effectiveRejectReason || photo.rejectReason || 'none';
  if (type === 'exPick' || photo._overrideStatus === 'excluded') return { label: 'manuell raus', kind: 'manual-out' };
  if (type === 'structural') return { label: 'verworfen: ' + rejectLabel(rejectReason), kind: 'structural' };
  return { label: 'knapp: ' + rejectLabel(rejectReason), kind: 'near' };
}

function signalTitle(photo, clusterSize) {
  const parts = [];
  if (photo.faces?.blink) parts.push('Blink-Warnung');
  if (clusterSize > 1) parts.push(clusterSize + ' ähnliche Aufnahmen');
  return parts.join(' · ');
}

function CardShell({
  photo,
  classes,
  status,
  clusterSize = 1,
  canOpenCluster = false,
  onOpenCluster,
  onOpenLightbox,
  onPrimaryAction,
  primaryLabel,
  primaryVariant = 'danger',
  readOnly = false,
  showReorder = false,
  showClusterChip = false,
  cardStyle = null,
  isFirstInChapter = false,
  isLastInChapter = false,
  onMoveUp,
  onMoveDown
}) {
  function handleOpenCluster(event) {
    event.stopPropagation();
    if (canOpenCluster) onOpenCluster?.(photo);
  }

  function handleAction(event) {
    event.stopPropagation();
    onPrimaryAction?.(photo);
  }

  function handleMove(event, direction) {
    event.stopPropagation();
    if (direction === 'up') onMoveUp?.(photo);
    else onMoveDown?.(photo);
  }

  const lightboxAction = readOnly || !onPrimaryAction ? null : {
    label: primaryLabel,
    variant: primaryVariant,
    handler: () => onPrimaryAction?.(photo)
  };

  return html`
    <article class=${classes} style=${cardStyle || null} aria-label=${status.label + ': ' + photo.name} title=${signalTitle(photo, clusterSize)}>
      <${Thumb} photo=${photo} onOpenLightbox=${onOpenLightbox} lightboxAction=${lightboxAction} />

      <div class="pick-card-badges" aria-hidden="false">
        <span class=${'pick-status-badge ' + status.kind}>${status.label}</span>
        ${showClusterChip && canOpenCluster ? html`
          <button
            class="pick-duplicate-chip pick-similar-action"
            type="button"
            onClick=${handleOpenCluster}
            aria-label=${clusterSize + ' ähnliche Aufnahmen ansehen'}
            title=${clusterSize + ' ähnliche Aufnahmen ansehen'}
          >
            <svg class="pick-similar-action-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
              <rect x="2.5" y="4.5" width="7" height="7" rx="1.6"></rect>
              <rect x="6.5" y="2.5" width="7" height="7" rx="1.6"></rect>
            </svg>
            <span class="pick-similar-count">${clusterSize}</span><span class="pick-similar-label"> ähnliche</span>
          </button>
        ` : null}
        ${photo.faces?.blink
          ? html`<span class="pick-signal-badge blink" title="Blink-Warnung" aria-label="Blink-Warnung">Blink</span>`
          : null}
      </div>

      ${!readOnly ? html`
        <div class="pick-card-actions">
          ${!readOnly && showReorder ? html`
            <button class="btn btn-ghost btn-sm" type="button" disabled=${isFirstInChapter} onClick=${(event) => handleMove(event, 'up')} aria-label=${photo.name + ' nach oben verschieben'}>↑</button>
            <button class="btn btn-ghost btn-sm" type="button" disabled=${isLastInChapter} onClick=${(event) => handleMove(event, 'down')} aria-label=${photo.name + ' nach unten verschieben'}>↓</button>
          ` : null}
          ${!readOnly ? html`
            <button class=${'btn btn-sm ' + (primaryVariant === 'danger' ? 'btn-danger' : 'btn-secondary')} type="button" onClick=${handleAction} aria-label=${primaryLabel + ': ' + photo.name}>${primaryLabel}</button>
          ` : null}
        </div>
      ` : null}
    </article>
  `;
}

export function PickCard({
  photo,
  clusterSize,
  isFirstInChapter,
  isLastInChapter,
  onOpenCluster,
  onOpenLightbox,
  onExclude,
  onMoveUp,
  onMoveDown,
  temporarySelection,
  isManual,
  readOnly = false,
  showReorder = true,
  actionLabel = 'Ablehnen',
  actionVariant = 'danger',
  cardStyle = null
}) {
  const canOpenCluster = Boolean(photo.clusterId && clusterSize > 1);
  const manualStatus = photo._overrideStatus || (isManual ? 'included' : null);
  const classes = [
    'pick-card',
    'pick-card-compact',
    photo.stream === 'M' ? 'is-mixed' : '',
    manualStatus === 'included' ? 'is-manual-included' : '',
    canOpenCluster ? 'has-similar' : '',
    photo.faces?.blink ? 'has-blink' : ''
  ].filter(Boolean).join(' ');

  return html`
    <${CardShell}
      photo=${photo}
      classes=${classes}
      status=${statusForPick(photo, temporarySelection, isManual)}
      clusterSize=${clusterSize}
      canOpenCluster=${canOpenCluster}
      onOpenCluster=${onOpenCluster}
      onOpenLightbox=${onOpenLightbox}
      onPrimaryAction=${onExclude}
      primaryLabel=${actionLabel}
      primaryVariant=${actionVariant}
      readOnly=${readOnly}
      showReorder=${showReorder}
      showClusterChip=${true}
      isFirstInChapter=${isFirstInChapter}
      isLastInChapter=${isLastInChapter}
      onMoveUp=${onMoveUp}
      onMoveDown=${onMoveDown}
      cardStyle=${cardStyle}
    />
  `;
}

export function ContextNearMissCard({
  photo,
  type = 'nearMiss',
  clusterSize = 1,
  onOpenCluster,
  onOpenLightbox,
  onAction,
  actionLabel = 'Zurückholen',
  cardStyle = null
}) {
  const isStructural = type === 'structural';
  const isExcludedPick = type === 'exPick' || photo._overrideStatus === 'excluded';
  const canOpenCluster = Boolean(photo.clusterId && clusterSize > 1);
  const classes = [
    'pick-card',
    'pick-card-compact',
    'context-reject-card',
    isExcludedPick ? 'context-ex-pick-card' : (isStructural ? 'context-structural-card' : 'context-near-miss-card'),
    canOpenCluster ? 'has-similar' : '',
    photo.faces?.blink ? 'has-blink' : ''
  ].filter(Boolean).join(' ');

  return html`
    <${CardShell}
      photo=${photo}
      classes=${classes}
      status=${statusForContext(photo, type)}
      clusterSize=${clusterSize}
      canOpenCluster=${canOpenCluster}
      onOpenCluster=${onOpenCluster}
      onOpenLightbox=${onOpenLightbox}
      onPrimaryAction=${onAction}
      primaryLabel=${actionLabel}
      primaryVariant="secondary"
      cardStyle=${cardStyle}
    />
  `;
}
