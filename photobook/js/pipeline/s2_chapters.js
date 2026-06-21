// js/pipeline/s2_chapters.js
// Stufe 2 (§10.4): Tag-/Kapitel-Segmentierung E13.1.
// Kapitel sind jetzt grobe Tageinheiten: Kalendertag-Basis, Split mitten am Tag
// nur bei großem Zeit-/GPS-Sprung, Merge sehr stiller Tage in den zeitlich
// näheren Nachbarn. Persistierte Kapitel liegen ausschließlich in meta.chapters.

const BATCH = 25;
const KEY = 'chapters';
export const implVersion = 'chapters-v3';

export const GPS_JUMP_KM = 5;
export const DAY_SPLIT_GAP = 4 * 60 * 60 * 1000;      // großer Tagesinnen-Split: 4 h
export const MIN_CHAPTER_GAP_MS = 60 * 1000;          // <60 s startet nie ein neues Kapitel
export const MIN_DAY_PHOTOS = 5;                      // sehr stille Tage werden gemerged
export const MIN_DAY_SPAN = 30 * 60 * 1000;           // ... sofern Spanne <30 min

const CHAPTER_SNAPSHOT = Object.freeze({
  implVersion,
  gpsJumpKm: GPS_JUMP_KM,
  daySplitGapMs: DAY_SPLIT_GAP,
  minChapterGapMs: MIN_CHAPTER_GAP_MS,
  minDayPhotos: MIN_DAY_PHOTOS,
  minDaySpanMs: MIN_DAY_SPAN,
  mergeTieBreak: 'earlier'
});

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
export async function runChapters({ photos, db, dispatch, signal, onProgress }) {
  const okPhotos = (photos || []).filter((p) => p.status !== 'failed');
  const total = okPhotos.length;

  if (total === 0) {
    const chapters = withSnapshot([]);
    dispatch?.({ type: 'SET_CHAPTERS', payload: chapters });
    try { await db.putMeta('chapters', chapters); } catch (err) {
      throw new StageError('Leere Tag-/Kapitelliste konnte nicht gespeichert werden.', err);
    }
    onProgress?.(0, 0);
    return { status: 'done' };
  }

  const ordered = okPhotos.slice().sort(compareByTime);
  const plan = buildChapterPlan(ordered);
  const assignmentsById = new Map();
  plan.segments.forEach((segment, chapterId) => {
    for (const photo of segment.photos) assignmentsById.set(photo.id, chapterId);
  });
  const chapters = withSnapshot(plan.segments.map((segment, id) => chapterRecord(id, segment.photos)));

  let processed = 0;
  let pending = [];

  for (const photo of ordered) {
    if (signal && signal.aborted) { await flush(); return { status: 'done' }; }
    normalizeStageFails(photo);
    photo.chapterId = assignmentsById.get(photo.id) ?? null;
    delete photo.stageFails[KEY];
    pending.push(photo);
    processed++;
    onProgress?.(processed, total);
    if (pending.length >= BATCH) await flush();
  }
  await flush();

  dispatch?.({ type: 'SET_CHAPTERS', payload: chapters });
  try { await db.putMeta('chapters', chapters); } catch (err) {
    throw new StageError('Tag-/Kapitelliste konnte nicht in IndexedDB gespeichert werden.', err);
  }

  return { status: 'done' };

  async function flush() {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
      await db.putPhotos(batch);
      dispatch?.({ type: 'UPDATE_PHOTOS', payload: batch });
    } catch (err) {
      throw new StageError('Tag-/Kapitel-Zuordnung konnte nicht in IndexedDB gespeichert werden.', err);
    }
  }
}

/**
 * Validator (§10.4): alle ok-Fotos haben chapterId; meta.chapters existiert oder
 * wird aus den Records rekonstruiert und persistiert. Alte v1/v2-Zustände werden
 * primär über den implVersion-Mismatch im Runner invalidiert; der Snapshot-Check
 * verhindert zusätzlich stumme Alt-Meta-Übernahme.
 * @param {object[]} photos
 * @param {object} db
 * @param {{dispatch?:Function}=} options
 * @returns {Promise<boolean>}
 */
export async function validateChapters(photos, db, options = {}) {
  const okPhotos = (photos || []).filter((p) => p.status !== 'failed');
  if (!okPhotos.every((p) => Number.isInteger(p.chapterId))) return false;
  try {
    const chapters = await loadOrReconstructChapters(photos, db);
    if (!hasCurrentSnapshot(chapters)) return false;
    options.dispatch?.({ type: 'SET_CHAPTERS', payload: chapters });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Reset gemäß §10.8: chapterId=null, stageFails.chapters löschen, meta.chapters löschen.
 * @param {object[]} photos
 * @param {object} db
 * @param {object=} context
 */
export async function resetChapters(photos, db, context) {
  void context;
  const changed = [];
  for (const p of photos || []) {
    normalizeStageFails(p);
    if (p.chapterId != null || Object.prototype.hasOwnProperty.call(p.stageFails, KEY)) {
      p.chapterId = null;
      delete p.stageFails[KEY];
      changed.push(p);
    }
  }
  if (changed.length) await db.putPhotos(changed);
  await db.deleteMeta('chapters');
}

/* =====================================================
   Hilfen
   ===================================================== */
async function loadOrReconstructChapters(photos, db) {
  const stored = await db.getMeta('chapters');
  if (Array.isArray(stored) && stored.length >= 0 && hasCurrentSnapshot(stored)) return stored;

  const chapters = reconstructChapters(photos);
  await db.putMeta('chapters', chapters);
  return chapters;
}

function reconstructChapters(photos) {
  const grouped = new Map();
  for (const p of photos || []) {
    if (!Number.isInteger(p.chapterId)) continue;
    if (!grouped.has(p.chapterId)) grouped.set(p.chapterId, []);
    grouped.get(p.chapterId).push(p);
  }
  const chapters = [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, list]) => chapterRecord(id, list.slice().sort(compareByTime)));
  return withSnapshot(chapters);
}

function buildChapterPlan(ordered) {
  const initial = [];
  let current = [];
  for (let i = 0; i < ordered.length; i++) {
    const photo = ordered[i];
    if (i === 0 || startsNewChapter(ordered[i - 1], photo)) {
      if (current.length) initial.push({ photos: current });
      current = [];
    }
    current.push(photo);
  }
  if (current.length) initial.push({ photos: current });

  const merged = mergeQuietDays(initial);
  return { segments: merged };
}

function mergeQuietDays(segments) {
  const list = segments.map((s) => ({ photos: s.photos.slice() }));
  let changed = true;
  while (changed && list.length > 1) {
    changed = false;
    for (let i = 0; i < list.length; i++) {
      const segment = list[i];
      if (!isQuietDay(segment)) continue;
      const target = nearestNeighborIndex(list, i);
      if (target == null) continue;
      mergeInto(list, i, target);
      changed = true;
      break;
    }
  }
  return list.map((segment) => ({ photos: segment.photos.slice().sort(compareByTime) }));
}

function isQuietDay(segment) {
  const photos = segment?.photos || [];
  if (photos.length >= MIN_DAY_PHOTOS) return false;
  return spanMs(photos) < MIN_DAY_SPAN;
}

function nearestNeighborIndex(list, index) {
  const prev = index > 0 ? index - 1 : null;
  const next = index < list.length - 1 ? index + 1 : null;
  if (prev == null) return next;
  if (next == null) return prev;
  const current = list[index];
  const prevGap = Math.max(0, startMs(current.photos) - endMs(list[prev].photos));
  const nextGap = Math.max(0, startMs(list[next].photos) - endMs(current.photos));
  return prevGap <= nextGap ? prev : next; // Tie-Break: früherer Nachbar
}

function mergeInto(list, sourceIndex, targetIndex) {
  const source = list[sourceIndex];
  const target = list[targetIndex];
  target.photos = target.photos.concat(source.photos).sort(compareByTime);
  list.splice(sourceIndex, 1);
}

function startsNewChapter(prev, curr) {
  const gap = gapMs(prev, curr);
  if (gap < MIN_CHAPTER_GAP_MS) return false;
  if (crossesLocalDay(prev, curr)) return true;
  if (gpsJump(prev, curr)) return true;
  return gap > DAY_SPLIT_GAP;
}

function chapterRecord(id, photos) {
  const list = photos || [];
  const start = startMs(list);
  const end = endMs(list);
  return {
    id,
    start,
    end,
    count: list.length,
    kind: 'day',
    thresholds: { ...CHAPTER_SNAPSHOT },
    sceneIds: []
  };
}

function withSnapshot(chapters) {
  const out = Array.isArray(chapters) ? chapters : [];
  try { Object.defineProperty(out, 'snapshot', { value: { ...CHAPTER_SNAPSHOT }, enumerable: true, configurable: true }); }
  catch (_) { out.snapshot = { ...CHAPTER_SNAPSHOT }; }
  return out;
}

function hasCurrentSnapshot(chapters) {
  if (!Array.isArray(chapters)) return false;
  if (chapters.length === 0) return chapters.snapshot?.implVersion === implVersion;
  const first = chapters[0] || {};
  return chapters.snapshot?.implVersion === implVersion || first.thresholds?.implVersion === implVersion;
}

function normalizeStageFails(photo) {
  if (!photo.stageFails || typeof photo.stageFails !== 'object') photo.stageFails = {};
  return photo;
}

function gapMs(a, b) { return Math.max(0, effTime(b) - effTime(a)); }
function spanMs(photos) { return Math.max(0, endMs(photos) - startMs(photos)); }
function startMs(photos) { return Math.min(...(photos || []).map(effTime)); }
function endMs(photos) { return Math.max(...(photos || []).map(effTime)); }

function effTime(p) {
  const t = p?.takenAt ?? p?.lastModified ?? 0;
  return Number.isFinite(t) ? t : 0;
}
function compareByTime(a, b) {
  const d = effTime(a) - effTime(b);
  if (d !== 0) return d;
  return (a.id || '').localeCompare(b.id || '');
}

function crossesLocalDay(a, b) {
  const da = new Date(effTime(a));
  const db = new Date(effTime(b));
  return da.getFullYear() !== db.getFullYear() ||
    da.getMonth() !== db.getMonth() ||
    da.getDate() !== db.getDate();
}

/** Haversine; true, wenn beide GPS haben und der Sprung > GPS_JUMP_KM liegt. */
function gpsJump(a, b) {
  if (!a?.gps || !b?.gps) return false;
  return haversineKm(a.gps.lat, a.gps.lon, b.gps.lat, b.gps.lon) > GPS_JUMP_KM;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const nums = [lat1, lon1, lat2, lon2].map(Number);
  if (!nums.every(Number.isFinite)) return 0;
  const R = 6371;
  const dLat = rad(nums[2] - nums[0]);
  const dLon = rad(nums[3] - nums[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(nums[0])) * Math.cos(rad(nums[2])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function rad(d) { return (d * Math.PI) / 180; }
