// js/components/IngestCurationGrid.js
// Separates Kuratierungs-Grid fuer CURATING: echte Windowing-Virtualisierung,
// keine Analyse-Badges, Entfernen nur ueber expliziten Button.

import { h, useEffect, useMemo, useRef, useState, htm as _htm } from '../deps.js';
const html = _htm.bind(h);
import { loadThumbUrl, revokeThumbUrl } from '../thumbs.js';

const MIN_CELL = 116;
const GAP = 8;
const OVERSCAN_ROWS = 4;

function photoTitle(photo) {
  const date = photo.takenAt ? new Date(photo.takenAt).toLocaleString('de-DE') : 'ohne Aufnahmedatum';
  return `${photo.name || photo.id} · ${date}`;
}

function CurationCard({ photo, style, disabled, removing, onRemove }) {
  const [url, setUrl] = useState(null);
  const failed = photo.status === 'failed';

  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!photo?.id || failed) return undefined;
    loadThumbUrl(photo.id).then((nextUrl) => {
      if (alive) setUrl(nextUrl);
    });
    return () => {
      alive = false;
      revokeThumbUrl(photo.id);
    };
  }, [photo?.id, failed]);

  const removeDisabled = disabled || removing;

  return html`
    <article class=${'curation-card' + (failed ? ' failed' : '')} style=${style} title=${photoTitle(photo)}>
      <div class="curation-thumb" aria-hidden="true">
        ${failed
          ? html`<span class="curation-fail-mark">!</span>`
          : url
            ? html`<img src=${url} alt="" decoding="async" />`
            : html`<span class="curation-skeleton"></span>`}
      </div>
      <div class="curation-card-footer">
        <span class="curation-name">${photo.name || photo.id}</span>
        <button
          class="curation-remove-btn"
          type="button"
          disabled=${removeDisabled}
          aria-label=${`Foto entfernen: ${photo.name || photo.id}`}
          title="Aus Bildauswahl entfernen"
          onClick=${(event) => { event.preventDefault(); event.stopPropagation(); onRemove?.(photo); }}
        >
          ${removing ? '…' : '×'}
        </button>
      </div>
    </article>
  `;
}

/**
 * @param {{ photos: object[], canRemove?: boolean, onRemove?: (photo:object)=>Promise<void>|void, emptyHint?: string }} props
 */
export function IngestCurationGrid({ photos, canRemove = true, onRemove, emptyHint }) {
  const viewportRef = useRef(null);
  const [layout, setLayout] = useState({ width: 0, height: 520, scrollTop: 0 });
  const [removingIds, setRemovingIds] = useState(() => new Set());

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;

    function applySize() {
      setLayout((old) => ({
        ...old,
        width: Math.max(0, el.clientWidth || 0),
        height: Math.max(240, el.clientHeight || 0),
        scrollTop: el.scrollTop || 0
      }));
    }

    applySize();
    const ro = new ResizeObserver(applySize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function onScroll(event) {
    const el = event.currentTarget;
    setLayout((old) => ({ ...old, scrollTop: el.scrollTop || 0 }));
  }

  async function remove(photo) {
    if (!photo?.id || !canRemove || removingIds.has(photo.id)) return;
    setRemovingIds((old) => {
      const next = new Set(old);
      next.add(photo.id);
      return next;
    });
    try {
      await onRemove?.(photo);
    } finally {
      setRemovingIds((old) => {
        const next = new Set(old);
        next.delete(photo.id);
        return next;
      });
    }
  }

  const count = photos?.length || 0;
  const metrics = useMemo(() => {
    const width = Math.max(0, layout.width || 0);
    const columns = Math.max(1, Math.floor((width + GAP) / (MIN_CELL + GAP)));
    const cellSize = columns > 0 ? Math.floor((width - GAP * (columns - 1)) / columns) : MIN_CELL;
    const rowHeight = cellSize + GAP;
    const rowCount = Math.ceil(count / columns);
    const startRow = Math.max(0, Math.floor((layout.scrollTop || 0) / rowHeight) - OVERSCAN_ROWS);
    const endRow = Math.min(rowCount, Math.ceil(((layout.scrollTop || 0) + (layout.height || 0)) / rowHeight) + OVERSCAN_ROWS);
    const startIndex = Math.max(0, startRow * columns);
    const endIndex = Math.min(count, endRow * columns);
    return { columns, cellSize, rowHeight, rowCount, startIndex, endIndex, totalHeight: Math.max(0, rowCount * rowHeight - GAP) };
  }, [count, layout.width, layout.height, layout.scrollTop]);

  const visible = useMemo(() => {
    const slice = [];
    for (let index = metrics.startIndex; index < metrics.endIndex; index++) {
      const photo = photos[index];
      if (photo) slice.push({ photo, index });
    }
    return slice;
  }, [photos, metrics.startIndex, metrics.endIndex]);

  if (!count) {
    return html`
      <div class="empty-state">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/>
          <path d="M5 18l5-4 4 3 2-2 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p class="empty-state-title">Noch keine Fotos</p>
        <p class="empty-state-hint">${emptyHint || 'Füge einen Ordner oder einzelne Dateien zur Bildauswahl hinzu.'}</p>
      </div>
    `;
  }

  return html`
    <div class="curation-grid-wrap">
      <div class="curation-grid-meta">
        <span>Bildauswahl: ${count} ${count === 1 ? 'Foto' : 'Fotos'}</span>
        <span>sichtbar ${visible.length}</span>
      </div>
      <div ref=${viewportRef} class="curation-viewport" onScroll=${onScroll} aria-label="Bildauswahl bearbeiten">
        <div class="curation-spacer" style=${`height:${metrics.totalHeight}px;`}>
          ${visible.map(({ photo, index }) => {
            const row = Math.floor(index / metrics.columns);
            const col = index % metrics.columns;
            const style = `width:${metrics.cellSize}px;height:${metrics.cellSize}px;transform:translate(${col * (metrics.cellSize + GAP)}px, ${row * metrics.rowHeight}px);`;
            return html`<${CurationCard}
              key=${photo.id}
              photo=${photo}
              style=${style}
              disabled=${!canRemove}
              removing=${removingIds.has(photo.id)}
              onRemove=${remove}
            />`;
          })}
        </div>
      </div>
    </div>
  `;
}
