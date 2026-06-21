// js/components/Grid.js
// Wiederverwendbares, virtuell-sparsames Thumbnail-Grid.
// Lazy-Loading via thumbs.js (geteilter IntersectionObserver); content-
// visibility:auto hält Off-Screen-Zellen billig. E4: Technik-Badges je Zelle
// und — wenn Kapitel übergeben werden — Kapitel-Header (Datum/Zeitspanne).
// Eingesetzt im StartScreen (jetzt) und später im ReviewScreen.

import { h, useRef, useEffect, useState, htm as _htm } from '../deps.js';
const html = _htm.bind(h);
import { loadThumbUrl, revokeThumbUrl, observeThumb } from '../thumbs.js';
import { groupByChapter, formatChapterRange } from '../selectors.js';

function scoreClass(v) {
  if (v == null) return '';
  return v >= 0.66 ? 'good' : v >= 0.33 ? 'mid' : 'low';
}
function pctTxt(v) { return v == null ? '—' : Math.round(v * 100) + '%'; }

function streamClass(stream) {
  return stream === 'P' ? 'badge-p' : stream === 'M' ? 'badge-m' : stream === 'S' ? 'badge-s' : 'badge-neutral';
}

function streamTitle(photo) {
  if (!photo.faces || !photo.stream) return '';
  const type = photo.stream === 'P' ? 'Personenbild' : photo.stream === 'M' ? 'Mischbild: Person in Szene' : 'Szenerie/Ort';
  return `${type} · ${photo.faces.count} ${photo.faces.count === 1 ? 'Gesicht' : 'Gesichter'} · größtes Gesicht ${pctTxt(photo.faces.maxBoxRatio)} · Lächeln ${pctTxt(photo.faces.smile)}`;
}

function similarTitle(count) {
  return `${count} ähnliche Bilder; dieses Bild ist das beste der Gruppe`;
}

function FaceBadges({ photo }) {
  if (!photo.faces || !photo.stream) return null;
  return html`
    <span class=${'tg-stream-chip badge ' + streamClass(photo.stream)} title=${streamTitle(photo)}>
      ${photo.stream}
    </span>
    ${photo.faces.blink ? html`<span class="tg-blink-chip" title="Blink-Warnung: alle großen Gesichter wirken geschlossen">Blink</span>` : null}
  `;
}

function TechBadges({ tech }) {
  if (!tech) return null;
  return html`
    <span class="tg-badges">
      <span class=${'tg-dot ' + scoreClass(tech.sharpness)} title=${'Schärfe ' + pctTxt(tech.sharpness)}></span>
      <span class=${'tg-dot ' + scoreClass(tech.exposure)} title=${'Belichtung ' + pctTxt(tech.exposure)}></span>
    </span>
  `;
}

function SimilarBadge({ photo, clusterCounts }) {
  if (!photo.repr || !photo.clusterId || !clusterCounts) return null;
  const count = clusterCounts.get(photo.clusterId) || 0;
  if (count <= 1) return null;
  return html`
    <span class="tg-similar-chip" title=${similarTitle(count)}>${count} ähnlich</span>
  `;
}

function ThumbCell({ photo, onClick, badge, clusterCounts }) {
  const ref = useRef(null);
  const [url, setUrl] = useState(null);
  const failed = photo.status === 'failed';

  useEffect(() => {
    if (failed) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    let alive = true;

    const stop = observeThumb(
      el,
      async () => { const u = await loadThumbUrl(photo.id); if (alive) setUrl(u); },
      () => { revokeThumbUrl(photo.id); if (alive) setUrl(null); }
    );

    return () => { alive = false; stop(); revokeThumbUrl(photo.id); };
  }, [photo.id, failed]);

  const title = failed ? (photo.failReason || 'Verarbeitung fehlgeschlagen') : photo.name;

  return html`
    <button
      ref=${ref}
      class=${'tg-cell' + (failed ? ' tg-failed' : '')}
      type="button"
      title=${title}
      onClick=${onClick ? () => onClick(photo) : undefined}
    >
      ${failed
        ? html`<span class="tg-fail-mark" aria-hidden="true">!</span>`
        : url
          ? html`<img class="tg-img" src=${url} alt=${photo.name} decoding="async" />`
          : html`<span class="tg-skeleton" aria-hidden="true"></span>`}
      ${!failed ? html`<${TechBadges} tech=${photo.tech} />` : null}
      ${!failed ? html`<${FaceBadges} photo=${photo} />` : null}
      ${!failed ? html`<${SimilarBadge} photo=${photo} clusterCounts=${clusterCounts} />` : null}
      ${badge ? badge(photo) : null}
    </button>
  `;
}

function ThumbWall({ photos, onClick, badge, clusterCounts }) {
  return html`
    <div class="thumb-grid">
      ${photos.map((p) => html`<${ThumbCell} key=${p.id} photo=${p} onClick=${onClick} badge=${badge} clusterCounts=${clusterCounts} />`)}
    </div>
  `;
}

function computeClusterCounts(photos) {
  const counts = new Map();
  for (const p of photos || []) {
    if (!p || !p.clusterId) continue;
    counts.set(p.clusterId, (counts.get(p.clusterId) || 0) + 1);
  }
  return counts;
}

/**
 * @param {{ photos: object[], chapters?: object[], onClick?: (photo:object)=>void,
 *           badge?: (photo:object)=>any, emptyHint?: string }} props
 */
export function Grid({ photos, chapters, onClick, badge, emptyHint }) {
  if (!photos || photos.length === 0) {
    return html`
      <div class="empty-state">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="9" cy="11" r="2" stroke="currentColor" stroke-width="1.5"/>
          <path d="M5 18l5-4 4 3 2-2 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p class="empty-state-title">Noch keine Fotos</p>
        <p class="empty-state-hint">${emptyHint || 'Wähle einen Ordner, um die Vorschau zu füllen.'}</p>
      </div>
    `;
  }

  const clusterCounts = computeClusterCounts(photos);

  // Gruppierter Modus, sobald Kapitel vorliegen.
  if (chapters && chapters.length) {
    const groups = groupByChapter(photos, chapters);
    return html`
      <div class="chapter-stack">
        ${groups.map((g, gi) => html`
          <section class="chapter" key=${g.chapter ? 'c' + g.chapter.id : 'none'}>
            <div class="chapter-header">
              <span class="chapter-index">${g.chapter ? 'Kapitel ' + (gi + 1) : '—'}</span>
              <span class="chapter-range">${formatChapterRange(g.chapter)}</span>
              <span class="chapter-count">${g.photos.length}</span>
            </div>
            <${ThumbWall} photos=${g.photos} onClick=${onClick} badge=${badge} clusterCounts=${clusterCounts} />
          </section>
        `)}
      </div>
    `;
  }

  return html`<${ThumbWall} photos=${photos} onClick=${onClick} badge=${badge} clusterCounts=${clusterCounts} />`;
}
