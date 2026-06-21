// js/components/ClusterOverlay.js
// Overlay für Near-Dup-Cluster: Mitglieder ansehen und Repräsentant per Override
// tauschen. Persistenz der Auswahl folgt erst in späteren Etappen.

import { h, useEffect, useRef, useState, htm as _htm } from '../deps.js';
const html = _htm.bind(h);
import { loadThumbUrl, revokeThumbUrl, observeThumb } from '../thumbs.js';

function Thumb({ photo }) {
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
  return html`<div ref=${ref} class="cluster-thumb">${url ? html`<img src=${url} alt=${photo.name} />` : html`<span></span>`}</div>`;
}

function pct(v) { return v == null ? '—' : Math.round(v * 100) + '%'; }

export function ClusterOverlay({ clusterId, members, selectedId, onClose, onSwap }) {
  if (!clusterId || !members || members.length === 0) return null;

  return html`
    <div class="overlay-backdrop" role="dialog" aria-modal="true" aria-label="Ähnliche Bilder" onClick=${onClose}>
      <section class="cluster-overlay" onClick=${(e) => e.stopPropagation()}>
        <header class="cluster-overlay-header">
          <div>
            <p class="screen-eyebrow">Ähnliche Gruppe ${clusterId}</p>
            <h2>Ähnliche Bilder</h2>
            <p class="text-sm text-muted">Tauscht nur die Review-Auswahl. Die Analyseergebnisse bleiben unangetastet.</p>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" onClick=${onClose}>Schließen</button>
        </header>

        <div class="cluster-member-grid">
          ${members.map((p) => {
            const selected = p.id === selectedId;
            return html`
              <article class=${'cluster-member ' + (selected ? 'selected' : '')} key=${p.id}>
                <${Thumb} photo=${p} />
                <div class="cluster-member-body">
                  <p class="cluster-member-name" title=${p.name}>${p.name}</p>
                  <p class="text-xs text-muted">Schärfe ${pct(p.tech && p.tech.sharpness)} · Belichtung ${pct(p.tech && p.tech.exposure)}</p>
                  <div class="cluster-member-actions">
                    ${selected
                      ? html`<span class="badge badge-neutral">Aktuell gewählt</span>`
                      : html`<button class="btn btn-secondary btn-sm" type="button" onClick=${() => onSwap(p)}>Tauschen</button>`}
                  </div>
                </div>
              </article>
            `;
          })}
        </div>
      </section>
    </div>
  `;
}
