// js/pipeline/s3_faces.js
// Stufe 3 (§10.4): Gesichter, Blink/Smile und P/S/M-Stream.
// MediaPipe läuft bewusst auf dem Main-Thread (§9.1). Einzelbildfehler landen
// in photo.stageFails.faces; Modell-/Persistenzfehler werfen StageError.
// Idempotenz: faces+stream gesetzt ODER stageFails.faces vorhanden.

import {
  MEDIAPIPE_TASKS_VISION_URL,
  MEDIAPIPE_TASKS_WASM_URL,
  MEDIAPIPE_FACE_LANDMARKER_MODEL_URL
} from '../deps.js';
import { FOCUS_FACTORS, classifyStreamFromFaces } from './streamClassification.js';

const BATCH = 25;
const KEY = 'faces';
export const implVersion = 'faces-v1';

// Fokus-Preset-Faktor (§ Etappe 5): Menschen macht P-Schwelle leichter,
// Orte macht P-Schwelle strenger. Schwellen kommen aus streamClassification.js.
const LARGE_FACE_RATIO = 0.02;
const BLINK_SUM_THRESHOLD = 0.5;
const MAX_FACES = 10;

let _visionModule = null;
let _faceLandmarker = null;

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
export async function runFaces({ photos, db, dispatch, signal, onProgress }) {
  const total = photos.length;
  if (total === 0) { onProgress?.(0, 0); return { status: 'done' }; }

  let pending = [];
  let processed = 0;
  const focusFactor = await readFocusFactor(db);
  const needsModel = photos.some((p) => p && p.status !== 'failed' && !isComputed(normalizeStageFails(p)));

  if (!needsModel) {
    onProgress?.(total, total);
    return { status: 'done' };
  }

  let landmarker;
  try {
    landmarker = await loadFaceLandmarker();
  } catch (err) {
    throw new StageError('MediaPipe FaceLandmarker konnte nicht geladen werden.', err);
  }

  try {
    for (let i = 0; i < total; i++) {
      if (signal && signal.aborted) { await flush(); return { status: 'done' }; }
      const photo = normalizeStageFails(photos[i]);
      processed++;

      if (photo.status === 'failed' || isComputed(photo)) {
        onProgress?.(processed, total);
        continue;
      }

      let source = null;
      try {
        source = await createImageSource(db, photo.id);
        const result = landmarker.detect(source.canvas);
        const analysis = analyzeFaces(result, source.width, source.height, focusFactor);
        photo.faces = analysis.faces;
        photo.stream = analysis.stream;
        delete photo.stageFails[KEY];
        pending.push(photo);
      } catch (err) {
        photo.faces = null;
        photo.stream = null;
        photo.stageFails[KEY] = readableReason(err, 'Gesichtsanalyse fehlgeschlagen');
        pending.push(photo);
      } finally {
        try { source?.dispose?.(); } catch (_) {}
      }

      onProgress?.(processed, total);
      if (pending.length >= BATCH) await flush();
      if ((processed & 7) === 0) await yieldToLoop();
    }

    await flush();
    return { status: 'done' };
  } finally {
    await unloadFaceLandmarker();
  }

  async function flush() {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
      await db.putPhotos(batch);
      dispatch?.({ type: 'UPDATE_PHOTOS', payload: batch });
    } catch (err) {
      throw new StageError('Gesichts-Analyse konnte Ergebnisse nicht in IndexedDB speichern.', err);
    }
  }
}

/**
 * Validator (§10.4): alle ok-Fotos haben faces+stream ODER stageFails.faces.
 * @param {object[]} photos
 * @returns {boolean}
 */
export function validateFaces(photos) {
  return (photos || []).every((p) => {
    if (!p || p.status === 'failed') return true;
    normalizeStageFails(p);
    return isComputed(p);
  });
}

/**
 * Reset gemäß §10.8: nur eigene Ableitungen löschen.
 * @param {object[]} photos
 * @param {object} db
 * @param {object=} context
 */
export async function resetFaces(photos, db, context) {
  void context;
  const changed = [];
  for (const p of photos || []) {
    normalizeStageFails(p);
    if (p.faces != null || p.stream != null || Object.prototype.hasOwnProperty.call(p.stageFails, KEY)) {
      p.faces = null;
      p.stream = null;
      delete p.stageFails[KEY];
      changed.push(p);
    }
  }
  if (changed.length) await db.putPhotos(changed);
}

async function readFocusFactor(db) {
  try {
    const presets = await db.getMeta('presets');
    const focus = presets && presets.focus;
    return FOCUS_FACTORS[focus] ?? FOCUS_FACTORS.balanced;
  } catch (_) {
    return FOCUS_FACTORS.balanced;
  }
}

async function loadFaceLandmarker() {
  if (_faceLandmarker) return _faceLandmarker;
  if (!_visionModule) _visionModule = await import(MEDIAPIPE_TASKS_VISION_URL);
  const { FilesetResolver, FaceLandmarker } = _visionModule;
  if (!FilesetResolver || !FaceLandmarker) {
    throw new Error('MediaPipe-Modul exportiert FilesetResolver/FaceLandmarker nicht.');
  }

  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_TASKS_WASM_URL);

  const base = {
    modelAssetPath: MEDIAPIPE_FACE_LANDMARKER_MODEL_URL
  };
  const options = {
    baseOptions: base,
    runningMode: 'IMAGE',
    numFaces: MAX_FACES,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false
  };

  // GPU-Delegate kann je nach Browser/Grafiktreiber scheitern. Fallback auf CPU
  // hält die Stufe funktionsfähig, ohne den Pipeline-Vertrag aufzuweichen.
  try {
    _faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { ...base, delegate: 'GPU' }
    });
  } catch (gpuErr) {
    try {
      _faceLandmarker = await FaceLandmarker.createFromOptions(vision, options);
    } catch (cpuErr) {
      throw new Error(`${cpuErr.message || cpuErr} (GPU-Fallback-Grund: ${gpuErr.message || gpuErr})`);
    }
  }
  return _faceLandmarker;
}

async function unloadFaceLandmarker() {
  try { _faceLandmarker?.close?.(); } catch (_) {}
  _faceLandmarker = null;
}

async function createImageSource(db, id) {
  const blob = await db.getThumb(id);
  if (!blob) throw new Error('Thumbnail nicht verfügbar');

  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (err) {
    throw new Error('Thumbnail nicht dekodierbar');
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, bitmap.width);
  canvas.height = Math.max(1, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) {
    bitmap.close?.();
    throw new Error('Canvas-Kontext nicht verfügbar');
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    dispose() {
      canvas.width = 1;
      canvas.height = 1;
    }
  };
}

function analyzeFaces(result, width, height, focusFactor) {
  void width; void height; // Landmarks sind normalisiert; Dimensionen bleiben für spätere Erweiterungen verfügbar.
  const landmarks = result?.faceLandmarks || result?.face_landmarks || [];
  const blendshapes = result?.faceBlendshapes || result?.face_blendshapes || [];
  const count = Array.isArray(landmarks) ? landmarks.length : 0;

  if (count === 0) {
    return { faces: { count: 0, maxBoxRatio: 0, blink: false, smile: 0 }, stream: 'S' };
  }

  const faceRows = [];
  for (let i = 0; i < count; i++) {
    const boxRatio = boxAreaRatio(landmarks[i]);
    const scores = readBlendshapeScores(blendshapes[i]);
    const blinkScore = (scores.eyeBlinkLeft ?? 0) + (scores.eyeBlinkRight ?? 0);
    const smileScore = ((scores.mouthSmileLeft ?? 0) + (scores.mouthSmileRight ?? 0)) / 2;
    faceRows.push({ boxRatio, blinkScore, smileScore });
  }

  const maxBoxRatio = Math.max(0, ...faceRows.map((f) => f.boxRatio));
  const largeFaces = faceRows.filter((f) => f.boxRatio >= LARGE_FACE_RATIO);
  const blink = largeFaces.length > 0 && largeFaces.every((f) => f.blinkScore > BLINK_SUM_THRESHOLD);
  const smilePool = largeFaces.length ? largeFaces : faceRows;
  const smile = clamp01(avg(smilePool.map((f) => f.smileScore)));
  const stream = classifyStreamFromFaces({ count, maxBoxRatio }, focusFactor);

  return {
    faces: {
      count,
      maxBoxRatio: clamp01(maxBoxRatio),
      blink,
      smile
    },
    stream
  };
}

function boxAreaRatio(faceLandmarks) {
  if (!Array.isArray(faceLandmarks) || faceLandmarks.length === 0) return 0;
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const lm of faceLandmarks) {
    const x = clamp01(Number(lm.x));
    const y = clamp01(Number(lm.y));
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return clamp01(Math.max(0, maxX - minX) * Math.max(0, maxY - minY));
}

function readBlendshapeScores(blendshape) {
  const categories = Array.isArray(blendshape?.categories)
    ? blendshape.categories
    : Array.isArray(blendshape) ? blendshape : [];
  const out = {};
  for (const c of categories) {
    const name = c.categoryName || c.category_name || c.displayName || c.index;
    if (name == null) continue;
    out[String(name)] = Number(c.score) || 0;
  }
  return out;
}

function isComputed(photo) {
  const hasFaces = photo.faces != null && ['P', 'S', 'M'].includes(photo.stream);
  return hasFaces || !!(photo.stageFails && photo.stageFails[KEY]);
}

function normalizeStageFails(photo) {
  if (!photo.stageFails || typeof photo.stageFails !== 'object') photo.stageFails = {};
  return photo;
}

function readableReason(err, fallback) {
  const msg = err && err.message ? String(err.message) : '';
  return msg || fallback;
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function clamp01(x) {
  return Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0;
}

function yieldToLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
