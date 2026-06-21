// js/pipeline/s4_embeddings.js
// Stufe 4 (§10.4): CLIP-Vision-Embeddings + Near-Dup-Dedup. Embeddings liegen
// ausschließlich im IDB-Store embeddings, nie im Photo-Record (§10.2).
// Re-Runs verwenden vorhandene IDB-Embeddings und clustern nur neu.

import { loadModel, unloadModel } from '../models.js';
import { CLIP_MODEL_ID, CLIP_MODEL_REVISION } from '../deps.js';

const KEY = 'embeddings';
export const implVersion = 'embeddings-v1';

const BATCH = 25;
const MODEL_KEY = 'clip-vision-base-patch16';
const MODEL_ID = CLIP_MODEL_ID;
const MODEL_REVISION = CLIP_MODEL_REVISION;
const SIM_THRESHOLD = 0.92;
const TIME_WINDOW_MS = 10 * 60 * 1000;

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
export async function runEmbeddings({ photos, db, dispatch, signal, onProgress }) {
  const okPhotos = (photos || []).filter((p) => p && p.status !== 'failed');
  const total = Math.max(1, okPhotos.length * 2);
  let done = 0;
  let pendingPhotos = [];
  const vectors = new Map();
  let clip = null;

  onProgress?.(0, total);

  try {
    // Phase 1: vorhandene Embeddings laden; fehlende inferieren. Ein vorhandenes
    // IDB-Embedding ist der Idempotenz-Anker dieser Stufe.
    for (const photo of okPhotos) {
      if (signal?.aborted) { await flush(); return { status: 'done' }; }
      normalizeStageFails(photo);

      try {
        let existing;
        try {
          existing = await db.getEmbedding(photo.id);
        } catch (err) {
          throw new StageError('Embedding-Store konnte nicht gelesen werden.', err);
        }

        if (isVector(existing)) {
          vectors.set(photo.id, normalizeVector(existing));
          if (Object.prototype.hasOwnProperty.call(photo.stageFails, KEY)) {
            delete photo.stageFails[KEY];
            pendingPhotos.push(photo);
          }
        } else if (photo.stageFails[KEY]) {
          // Pro-Bild-Fehler aus einem früheren abgeschlossenen Lauf gilt als
          // berechnet, bis ein Reset/Version-Bump ihn löscht.
        } else {
          if (!clip) {
            try { clip = await loadClip(onModelProgress); }
            catch (err) { throw new StageError('CLIP-Modell konnte nicht geladen werden.', err); }
          }
          const vector = await inferEmbedding(clip, db, photo.id);
          try {
            await db.putEmbedding(photo.id, vector);
          } catch (err) {
            throw new StageError('Embedding konnte nicht in IndexedDB gespeichert werden.', err);
          }
          vectors.set(photo.id, vector);
          delete photo.stageFails[KEY];
          pendingPhotos.push(photo);
        }
      } catch (err) {
        if (err instanceof StageError) throw err;
        // Einzelbildfehler: kein Throw; Ergebnisfeld gibt es hier nicht, also
        // stageFails.embeddings als berechnet-Fehler markieren.
        photo.clusterId = null;
        photo.repr = false;
        if (photo.rejectReason === 'duplicate') photo.rejectReason = null;
        photo.stageFails[KEY] = readableReason(err, 'CLIP-Embedding fehlgeschlagen');
        pendingPhotos.push(photo);
      }

      done++;
      onProgress?.(done, total);
      if (pendingPhotos.length >= BATCH) await flush();
      if ((done & 3) === 0) await yieldToLoop();
    }

    await flush();

    // Phase 2: billiges Re-Clustering auf Basis vorhandener Vektoren. Dieser
    // Block läuft auch dann, wenn kein Modell geladen werden musste.
    const changed = clusterAndMark(okPhotos, vectors);
    for (let i = 0; i < changed.length; i += BATCH) {
      if (signal?.aborted) {
        await flush();
        return { status: 'done' };
      }
      const batch = changed.slice(i, i + BATCH);
      try {
        await db.putPhotos(batch);
        dispatch?.({ type: 'UPDATE_PHOTOS', payload: batch });
      } catch (err) {
        throw new StageError('Embedding-Cluster konnten nicht in IndexedDB gespeichert werden.', err);
      }
      done = Math.min(total, okPhotos.length + Math.min(okPhotos.length, i + batch.length));
      onProgress?.(done, total);
      await yieldToLoop();
    }

    onProgress?.(total, total);
    return { status: 'done' };
  } catch (err) {
    if (err instanceof StageError) throw err;
    throw new StageError('CLIP-Embedding-Stufe ist fehlgeschlagen.', err);
  } finally {
    if (clip) await unloadModel(MODEL_KEY);
  }

  async function flush() {
    if (pendingPhotos.length === 0) return;
    const batch = pendingPhotos;
    pendingPhotos = [];
    try {
      await db.putPhotos(batch);
      dispatch?.({ type: 'UPDATE_PHOTOS', payload: batch });
    } catch (err) {
      throw new StageError('Embedding-Status konnte nicht in IndexedDB gespeichert werden.', err);
    }
  }

  function onModelProgress(info) {
    // Modell-Download kann mehrere hundert MB dauern. Die Pipeline-UI erwartet
    // Bildzähler; deshalb bleibt der numerische Fortschritt stabil, Zusatzinfos
    // werden nur an models.js weitergereicht/loggbar gehalten.
    void info;
  }
}

/**
 * Validator (§10.4): jedes ok-Foto hat entweder stageFails.embeddings oder ein
 * IDB-Embedding und eine gültige Cluster-/Repräsentanzableitung.
 * @param {object[]} photos
 * @param {object} db
 * @returns {Promise<boolean>}
 */
export async function validateEmbeddings(photos, db) {
  const okPhotos = (photos || []).filter((p) => p && p.status !== 'failed');
  for (const p of okPhotos) {
    normalizeStageFails(p);
    if (p.stageFails[KEY]) continue;
    if (typeof p.clusterId !== 'string' || p.clusterId.length === 0 || typeof p.repr !== 'boolean') return false;
    try {
      const v = await db.getEmbedding(p.id);
      if (!isVector(v)) return false;
    } catch (_) {
      return false;
    }
  }

  // Pro Cluster muss es genau einen Repräsentanten geben. Stage-Fails sind hier
  // ausgenommen, weil sie keinem Cluster angehören.
  const counts = new Map();
  for (const p of okPhotos) {
    if (p.stageFails[KEY]) continue;
    const c = counts.get(p.clusterId) || { repr: 0, total: 0 };
    c.total++;
    if (p.repr) c.repr++;
    counts.set(p.clusterId, c);
  }
  for (const c of counts.values()) if (c.total > 0 && c.repr !== 1) return false;
  return true;
}

/**
 * Reset gemäß §10.8: nur Ableitungen löschen. Der IDB-Store embeddings bleibt
 * bewusst erhalten, weil die Vektoren pixelbasiert und nicht stale sind.
 * @param {object[]} photos
 * @param {object} db
 * @param {object=} context
 */
export async function resetEmbeddings(photos, db, context) {
  void context;
  const changed = [];
  for (const p of photos || []) {
    normalizeStageFails(p);
    const had = p.clusterId != null || p.repr !== false || p.rejectReason === 'duplicate' ||
      Object.prototype.hasOwnProperty.call(p.stageFails, KEY);
    if (!had) continue;
    p.clusterId = null;
    p.repr = false;
    if (p.rejectReason === 'duplicate') p.rejectReason = null;
    delete p.stageFails[KEY];
    changed.push(p);
  }
  if (changed.length) await db.putPhotos(changed);
}

async function loadClip(onProgress) {
  return loadModel(MODEL_KEY, async ({ transformers, device, onProgress: progress }) => {
    const { AutoProcessor, CLIPVisionModelWithProjection, RawImage } = transformers;
    if (!AutoProcessor || !CLIPVisionModelWithProjection || !RawImage) {
      throw new Error('Transformers.js exportiert AutoProcessor/CLIPVisionModelWithProjection/RawImage nicht.');
    }

    const common = { revision: MODEL_REVISION, progress_callback: progressAdapter(progress || onProgress) };
    const modelOpts = {
      ...common,
      device,
      dtype: device === 'webgpu' ? 'fp16' : 'q8'
    };

    const processor = await AutoProcessor.from_pretrained(MODEL_ID, common);
    const visionModel = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, modelOpts);

    return {
      processor,
      visionModel,
      RawImage,
      device,
      async dispose() {
        try { await visionModel.dispose?.(); } catch (_) {}
      }
    };
  }, onProgress);
}

async function inferEmbedding(clip, db, id) {
  const blob = await db.getThumb(id);
  if (!blob) throw new Error('Thumbnail nicht verfügbar');
  const image = await rawImageFromBlob(clip.RawImage, blob);
  const inputs = await clip.processor(image);
  const out = await clip.visionModel(inputs);
  const tensor = out?.image_embeds || out?.pooler_output;
  if (!tensor || !isVector(tensor.data)) throw new Error('CLIP-Ausgabe enthält kein Bild-Embedding');
  return normalizeVector(tensor.data);
}

async function rawImageFromBlob(RawImage, blob) {
  if (typeof RawImage.fromBlob === 'function') return await RawImage.fromBlob(blob);

  const url = URL.createObjectURL(blob);
  try {
    if (typeof RawImage.fromURL === 'function') return await RawImage.fromURL(url);
    if (typeof RawImage.read === 'function') return await RawImage.read(url);
    throw new Error('RawImage kann keine Blob-URL lesen');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function clusterAndMark(photos, vectors) {
  const ordered = photos
    .filter((p) => p && p.status !== 'failed')
    .sort(compareByTime);

  const clusters = [];
  const changed = [];

  for (const p of ordered) {
    normalizeStageFails(p);
    const vector = vectors.get(p.id);
    if (!vector || p.stageFails[KEY]) {
      const didChange = p.clusterId != null || p.repr !== false || p.rejectReason === 'duplicate';
      p.clusterId = null;
      p.repr = false;
      if (p.rejectReason === 'duplicate') p.rejectReason = null;
      if (didChange) changed.push(p);
      continue;
    }

    const t = effTime(p);
    let best = null;
    let bestSim = -Infinity;

    for (const cluster of clusters) {
      if (Math.abs(t - cluster.lastTime) > TIME_WINDOW_MS) continue;
      let sim = -Infinity;
      for (const m of cluster.members) sim = Math.max(sim, cosine(vector, m.vector));
      if (sim >= SIM_THRESHOLD && sim > bestSim) {
        best = cluster;
        bestSim = sim;
      }
    }

    if (!best) {
      best = { id: `c${String(clusters.length + 1).padStart(4, '0')}`, members: [], lastTime: t };
      clusters.push(best);
    }
    best.members.push({ photo: p, vector });
    best.lastTime = Math.max(best.lastTime, t);
  }

  for (const cluster of clusters) {
    let bestMember = null;
    let bestScore = -Infinity;
    for (const member of cluster.members) {
      const score = representativeScore(member.photo);
      if (score > bestScore) { bestScore = score; bestMember = member; }
    }

    for (const member of cluster.members) {
      const p = member.photo;
      const isRepr = member === bestMember;
      const nextReject = isRepr ? (p.rejectReason === 'duplicate' ? null : p.rejectReason) : 'duplicate';
      const didChange =
        p.clusterId !== cluster.id ||
        p.repr !== isRepr ||
        p.rejectReason !== nextReject ||
        Object.prototype.hasOwnProperty.call(p.stageFails, KEY);

      p.clusterId = cluster.id;
      p.repr = isRepr;
      p.rejectReason = nextReject;
      delete p.stageFails[KEY];
      if (didChange) changed.push(p);
    }
  }

  return changed;
}

function representativeScore(photo) {
  const sharp = clamp01(photo.tech?.sharpness ?? 0.5);
  const exposure = clamp01(photo.tech?.exposure ?? 0.5);
  const techMean = (sharp + exposure) / 2;
  const noBlink = photo.faces?.blink ? 0 : 1;
  return 0.6 * techMean + 0.4 * noBlink;
}

function normalizeVector(input) {
  const src = input instanceof Float32Array ? input : new Float32Array(input);
  const out = new Float32Array(src.length);
  let norm = 0;
  for (let i = 0; i < src.length; i++) norm += src[i] * src[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < src.length; i++) out[i] = src[i] / norm;
  return out;
}

function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function progressAdapter(onProgress) {
  return (info) => {
    try { onProgress?.(info || {}); } catch (_) {}
  };
}

function isVector(v) {
  return v && typeof v.length === 'number' && v.length > 0;
}

function normalizeStageFails(photo) {
  if (!photo.stageFails || typeof photo.stageFails !== 'object') photo.stageFails = {};
  return photo;
}

function effTime(p) { return p.takenAt ?? p.lastModified ?? 0; }
function compareByTime(a, b) {
  const d = effTime(a) - effTime(b);
  if (d !== 0) return d;
  return (a.id || '') < (b.id || '') ? -1 : 1;
}

function readableReason(err, fallback) {
  const msg = err && err.message ? String(err.message) : '';
  return msg || fallback;
}

function yieldToLoop() { return new Promise((resolve) => setTimeout(resolve, 0)); }
function clamp01(x) { return Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0; }
