// js/pipeline/s1_technical.js
// Stufe 1 (§10.4): Technik-Scoring je Bild — Schärfe + Belichtung in photo.tech.
// Einzelbildfehler landen in photo.stageFails.technical, Stufen-/Persistenzfehler
// werfen StageError. Idempotenz: tech gesetzt ODER stageFails.technical vorhanden.

const BATCH = 25;
const KEY = 'technical';
export const implVersion = 'technical-v2';

// Zentrum-Crop ~40 % der Fläche → linearer Faktor sqrt(0.4) ≈ 0.632.
// Bewusst NICHT global: ein scharfes Motiv vor unscharfem Bokeh-Hintergrund
// soll nicht abgestraft werden.
const CROP_LINEAR = Math.sqrt(0.4);

// Normalisierungskonstante für die Laplacian-Varianz (auf 0–255-Intensitäten).
// Heuristisch auf ~512-px-Thumbnails kalibriert; v/(v+K) sättigt weich nach 1.
const SHARP_K = 600;

// Clipping gilt ab diesem Anteil als "voll" abgestraft (Belichtungsscore 0).
const CLIP_FULL = 0.25;

class StageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StageError';
    this.cause = cause;
  }
}

/**
 * @param {{ photos: object[], db: object, dispatch: Function,
 *           signal: AbortSignal, onProgress: Function }} ctx
 * @returns {Promise<{status:'done'}>}
 */
export async function runTechnical({ photos, db, dispatch, signal, onProgress }) {
  const total = photos.length;
  let pending = [];
  let processed = 0;

  for (let i = 0; i < total; i++) {
    if (signal && signal.aborted) { await flush(); return { status: 'done' }; }
    const photo = normalizeStageFails(photos[i]);
    processed++;

    // status 'failed' kommt nur aus dem Ingest und wird von Stufen nicht geändert.
    if (photo.status === 'failed' || isComputed(photo)) {
      onProgress?.(processed, total);
      continue;
    }

    try {
      const tech = await scoreThumb(db, photo.id);
      if (!tech) throw new Error('Thumbnail nicht verfügbar oder nicht lesbar');
      photo.tech = tech;
      delete photo.stageFails[KEY];
      pending.push(photo);
    } catch (err) {
      // Einzelbildfehler: kein Throw; Ergebnisfeld bleibt null, Grund wird persistiert.
      photo.tech = null;
      photo.stageFails[KEY] = readableReason(err, 'Technik-Analyse fehlgeschlagen');
      pending.push(photo);
    }

    onProgress?.(processed, total);
    if (pending.length >= BATCH) await flush();
  }

  await flush();
  return { status: 'done' };

  async function flush() {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
      await db.putPhotos(batch);
      dispatch?.({ type: 'UPDATE_PHOTOS', payload: batch });
    } catch (err) {
      throw new StageError('Technik-Analyse konnte Ergebnisse nicht in IndexedDB speichern.', err);
    }
  }
}

/**
 * Billiger Validator (§10.4): alle ok-Fotos haben tech ODER stageFails.technical.
 * @param {object[]} photos
 * @returns {boolean}
 */
export function validateTechnical(photos) {
  return (photos || []).every((p) => {
    if (!p || p.status === 'failed') return true;
    normalizeStageFails(p);
    return isComputed(p);
  });
}

/**
 * Reset gemäß §10.8: nur eigene Ableitungen löschen, stageFails-Objekt erhalten.
 * @param {object[]} photos
 * @param {object} db
 * @param {object=} context
 */
export async function resetTechnical(photos, db, context) {
  void context;
  const changed = [];
  for (const p of photos || []) {
    normalizeStageFails(p);
    if (p.tech != null || Object.prototype.hasOwnProperty.call(p.stageFails, KEY)) {
      p.tech = null;
      delete p.stageFails[KEY];
      changed.push(p);
    }
  }
  if (changed.length) await db.putPhotos(changed);
}

function isComputed(photo) {
  return photo.tech != null || !!(photo.stageFails && photo.stageFails[KEY]);
}

function normalizeStageFails(photo) {
  if (!photo.stageFails || typeof photo.stageFails !== 'object') photo.stageFails = {};
  return photo;
}

function readableReason(err, fallback) {
  const msg = err && err.message ? String(err.message) : '';
  return msg || fallback;
}

/**
 * Lädt das Thumb, zeichnet es auf ein Canvas und berechnet Schärfe + Belichtung.
 * @returns {Promise<{sharpness:number, exposure:number}|null>}
 */
async function scoreThumb(db, id) {
  const blob = await db.getThumb(id);
  if (!blob) return null;

  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (_) {
    return null;
  }

  const w = bitmap.width, h = bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  // Belichtung: Clipping über das gesamte Bild.
  const full = ctx.getImageData(0, 0, w, h).data;
  const exposure = exposureScore(full);

  // Schärfe: nur Zentrum-Crop.
  const cw = Math.max(8, Math.round(w * CROP_LINEAR));
  const ch = Math.max(8, Math.round(h * CROP_LINEAR));
  const cx = Math.round((w - cw) / 2);
  const cy = Math.round((h - ch) / 2);
  const crop = ctx.getImageData(cx, cy, cw, ch).data;
  const sharpness = sharpnessScore(crop, cw, ch);

  return { sharpness, exposure };
}

/** Belichtungs-Qualität 0–1 (1 = wenig Clipping). */
function exposureScore(rgba) {
  const n = rgba.length / 4;
  if (n === 0) return 0;
  let clipped = 0;
  for (let p = 0; p < rgba.length; p += 4) {
    // Luma (Rec. 601) reicht für Clipping-Erkennung.
    const y = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    if (y > 250 || y < 5) clipped++;
  }
  const frac = clipped / n;
  return clamp01(1 - frac / CLIP_FULL);
}

/** Schärfe 0–1 aus der Varianz der Laplacian-Antwort auf dem Graustufen-Crop. */
function sharpnessScore(rgba, w, h) {
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }

  let maxVariance = 0;
  for (let gy = 0; gy < 3; gy++) {
    const y0 = Math.floor((gy * h) / 3);
    const y1 = Math.floor(((gy + 1) * h) / 3);
    for (let gx = 0; gx < 3; gx++) {
      const x0 = Math.floor((gx * w) / 3);
      const x1 = Math.floor(((gx + 1) * w) / 3);
      let sum = 0, sumSq = 0, count = 0;

      for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y++) {
        for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
          const idx = y * w + x;
          const lap = gray[idx - 1] + gray[idx + 1] + gray[idx - w] + gray[idx + w] - 4 * gray[idx];
          sum += lap; sumSq += lap * lap; count++;
        }
      }

      if (count > 0) {
        const mean = sum / count;
        const variance = sumSq / count - mean * mean;
        if (variance > maxVariance) maxVariance = variance;
      }
    }
  }

  return clamp01(maxVariance / (maxVariance + SHARP_K));
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
