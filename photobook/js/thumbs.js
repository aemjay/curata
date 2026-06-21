// js/thumbs.js
// ObjectURL-Cache für Thumbnails mit IntersectionObserver-Anbindung.
// Eine URL wird erst erzeugt, wenn die Zelle sichtbar wird (Blob aus IDB),
// und beim Verlassen wieder freigegeben (URL.revokeObjectURL) — so bleibt der
// Speicher auch bei tausenden Bildern beschränkt.

import * as db from './db.js';

const _urls = new Map();      // id -> objectURL
const _inflight = new Map();  // id -> Promise<string|null>

/**
 * Liefert (und cached) eine ObjectURL für das Thumb mit der gegebenen id.
 * @param {string} id
 * @returns {Promise<string|null>}
 */
export async function loadThumbUrl(id) {
  if (_urls.has(id)) return _urls.get(id);
  if (_inflight.has(id)) return _inflight.get(id);

  const p = (async () => {
    let blob = null;
    try { blob = await db.getThumb(id); } catch (_) { blob = null; }
    _inflight.delete(id);
    if (!blob) return null;
    // Falls zwischenzeitlich revoked/neu angefordert: bestehende URL bevorzugen.
    if (_urls.has(id)) return _urls.get(id);
    const url = URL.createObjectURL(blob);
    _urls.set(id, url);
    return url;
  })();

  _inflight.set(id, p);
  return p;
}

/** Gibt die ObjectURL eines Thumbs frei. */
export function revokeThumbUrl(id) {
  const url = _urls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    _urls.delete(id);
  }
}

/** Gibt alle ObjectURLs frei (z. B. beim Verlassen einer Ansicht). */
export function revokeAllThumbUrls() {
  for (const url of _urls.values()) URL.revokeObjectURL(url);
  _urls.clear();
}

/* =====================================================
   Geteilter IntersectionObserver
   ===================================================== */
let _io = null;
const _targets = new Map(); // Element -> { onEnter, onLeave, visible }

function ensureObserver() {
  if (_io) return _io;
  _io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const rec = _targets.get(entry.target);
        if (!rec) continue;
        if (entry.isIntersecting && !rec.visible) {
          rec.visible = true;
          try { rec.onEnter(); } catch (_) {}
        } else if (!entry.isIntersecting && rec.visible) {
          rec.visible = false;
          try { rec.onLeave(); } catch (_) {}
        }
      }
    },
    { root: null, rootMargin: '300px 0px', threshold: 0 }
  );
  return _io;
}

/**
 * Beobachtet ein Element; ruft onEnter beim Sichtbarwerden, onLeave beim
 * Verlassen. Gibt eine Aufräumfunktion zurück (im Cleanup aufrufen).
 * @param {Element} el
 * @param {() => void} onEnter
 * @param {() => void} onLeave
 * @returns {() => void}
 */
export function observeThumb(el, onEnter, onLeave) {
  if (!el) return () => {};
  const io = ensureObserver();
  _targets.set(el, { onEnter, onLeave, visible: false });
  io.observe(el);
  return () => {
    io.unobserve(el);
    _targets.delete(el);
  };
}
