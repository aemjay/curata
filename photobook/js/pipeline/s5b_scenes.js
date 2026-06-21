// js/pipeline/s5b_scenes.js
// E13.1: Szenenbildung nach VLM, vor Select.
// Szene = zusammenhängende Aufnahme-Situation innerhalb eines Tags/Kapitels.
// Der Algorithmus ist deterministisch: Chronologie + id-Tie-Breaks, fixe
// Schwellen, keine Inferenz, keine Zufallsanteile.

const BATCH = 25;
const KEY = 'scenes';
export const implVersion = 'scenes-v1';

export const SCENE_MIN_RUN = 2;                       // nachhaltiger place/activity-Wechsel
export const SCENE_GPS_JUMP_KM = 1.0;                 // GPS korroboriert Wechsel auch bei kurzem Run
export const SCENE_TIME_GAP = 60 * 60 * 1000;         // nicht-zusammenhängende Zeitbereiche trennen
export const MIN_SCENE_PHOTOS = 2;                    // sehr kleine Szenen mergen
export const MIN_SCENE_SPAN = 10 * 60 * 1000;

const SCENE_SNAPSHOT = Object.freeze({
  implVersion,
  sceneMinRun: SCENE_MIN_RUN,
  sceneGpsJumpKm: SCENE_GPS_JUMP_KM,
  sceneTimeGapMs: SCENE_TIME_GAP,
  minScenePhotos: MIN_SCENE_PHOTOS,
  minSceneSpanMs: MIN_SCENE_SPAN,
  mergeTieBreak: 'earlier',
  idFormat: 'scene-<chapterId>-<index>'
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
export async function runScenes({ photos, db, dispatch, signal, onProgress }) {
  const okPhotos = (photos || []).filter((p) => p.status !== 'failed');
  const total = okPhotos.length;

  if (total === 0) {
    const scenes = withSnapshot([]);
    dispatch?.({ type: 'SET_SCENES', payload: scenes });
    try { await db.putMeta('scenes', scenes); } catch (err) {
      throw new StageError('Leere Szenenliste konnte nicht gespeichert werden.', err);
    }
    onProgress?.(0, 0);
    return { status: 'done' };
  }

  if (!okPhotos.every((p) => Number.isInteger(p.chapterId))) {
    throw new StageError('Szenenbildung benötigt gültige chapterId für alle verarbeitbaren Fotos.');
  }

  const plan = buildScenePlan(okPhotos);
  const sceneIdByPhotoId = plan.sceneIdByPhotoId;
  const scenes = withSnapshot(plan.scenes);

  let processed = 0;
  let pending = [];
  for (const photo of okPhotos.slice().sort(compareByTime)) {
    if (signal && signal.aborted) { await flush(); return { status: 'done' }; }
    normalizeStageFails(photo);
    const sceneId = sceneIdByPhotoId.get(photo.id);
    if (!sceneId) {
      photo.sceneId = null;
      photo.stageFails[KEY] = 'Keine Szene innerhalb des Tags ableitbar.';
    } else {
      photo.sceneId = sceneId;
      delete photo.stageFails[KEY];
    }
    pending.push(photo);
    processed++;
    onProgress?.(processed, total);
    if (pending.length >= BATCH) await flush();
  }
  await flush();

  try {
    await db.putMeta('scenes', scenes);
    await persistChapterSceneIds(db, scenes);
  } catch (err) {
    throw new StageError('Szenen-Metadaten konnten nicht in IndexedDB gespeichert werden.', err);
  }
  dispatch?.({ type: 'SET_SCENES', payload: scenes });

  return { status: 'done' };

  async function flush() {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
      await db.putPhotos(batch);
      dispatch?.({ type: 'UPDATE_PHOTOS', payload: batch });
    } catch (err) {
      throw new StageError('Szenen-Zuordnung konnte nicht in IndexedDB gespeichert werden.', err);
    }
  }
}

/**
 * @param {object[]} photos
 * @param {object} db
 * @param {{dispatch?:Function}=} options
 * @returns {Promise<boolean>}
 */
export async function validateScenes(photos, db, options = {}) {
  const okPhotos = (photos || []).filter((p) => p.status !== 'failed');
  if (!okPhotos.every((p) => Number.isInteger(p.chapterId))) return false;
  if (!okPhotos.every((p) => typeof p.sceneId === 'string' || p.stageFails?.[KEY])) return false;

  try {
    let scenes = await db.getMeta('scenes');
    if (!Array.isArray(scenes) || !hasCurrentSnapshot(scenes)) {
      scenes = reconstructScenesFromRecords(okPhotos);
      await db.putMeta('scenes', scenes);
    }
    if (!validateSceneContainment(okPhotos, scenes)) return false;
    options.dispatch?.({ type: 'SET_SCENES', payload: scenes });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Reset gemäß §10.8: sceneId=null, meta.scenes, stageFails.scenes löschen.
 * VLM-/Embedding-Artefakte bleiben unangetastet.
 * @param {object[]} photos
 * @param {object} db
 * @param {object=} context
 */
export async function resetScenes(photos, db, context) {
  void context;
  const changed = [];
  for (const p of photos || []) {
    normalizeStageFails(p);
    if (p.sceneId != null || Object.prototype.hasOwnProperty.call(p.stageFails, KEY)) {
      p.sceneId = null;
      delete p.stageFails[KEY];
      changed.push(p);
    }
  }
  if (changed.length) await db.putPhotos(changed);
  await db.deleteMeta('scenes');
  await removeChapterSceneIds(db);
}

/* =====================================================
   Segmentierung
   ===================================================== */
function buildScenePlan(okPhotos) {
  const byChapter = groupBy(okPhotos, (p) => p.chapterId);
  const sceneIdByPhotoId = new Map();
  const scenes = [];

  for (const chapterId of [...byChapter.keys()].sort((a, b) => a - b)) {
    const chapterPhotos = byChapter.get(chapterId).slice().sort(compareByTime);
    const chapterScenes = buildChapterScenes(chapterId, chapterPhotos);
    for (const scene of chapterScenes) scenes.push(scene);
    for (const scene of chapterScenes) {
      for (const id of scene.photoIds || []) sceneIdByPhotoId.set(id, scene.id);
    }
  }

  return { scenes: withSnapshot(scenes), sceneIdByPhotoId };
}

function buildChapterScenes(chapterId, chapterPhotos) {
  const dayChunks = groupByLocalDayChunks(chapterPhotos);
  let anchorScenes = [];

  for (const chunk of dayChunks) {
    const reps = chunk.filter((p) => p.repr === true).sort(compareByTime);
    let dayScenes = segmentRepresentatives(chapterId, reps);
    if (dayScenes.length === 0) {
      dayScenes = [{ chapterId, reps: [], photos: [], placeVotes: new Map(), activityVotes: new Map(), id: null }];
    }
    assignPhotosToAnchorScenes(chunk, dayScenes);
    dayScenes = mergeSmallScenes(dayScenes);
    anchorScenes = anchorScenes.concat(dayScenes);
  }

  assignStableSceneIds(chapterId, anchorScenes);
  return anchorScenes.map(sceneRecord);
}

function groupByLocalDayChunks(photos) {
  const ordered = (photos || []).slice().sort(compareByTime);
  const chunks = [];
  let current = [];
  let currentKey = null;
  for (const photo of ordered) {
    const key = localDayKey(photo);
    if (current.length && key !== currentKey) {
      chunks.push(current);
      current = [];
    }
    currentKey = key;
    current.push(photo);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function localDayKey(photo) {
  const d = new Date(effTime(photo));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function segmentRepresentatives(chapterId, reps) {
  const scenes = [];
  let current = null;

  for (let i = 0; i < reps.length; i++) {
    const rep = reps[i];
    const sig = contentSignature(rep);
    const prev = reps[i - 1] || null;
    const hardTimeSplit = prev ? gapMs(prev, rep) > SCENE_TIME_GAP : false;
    const contentSwitch = current && sig.key !== 'untagged' && sig.key !== current.sig.key;
    const sustainable = contentSwitch && countRun(reps, i, sig.key) >= SCENE_MIN_RUN;
    const gpsCorroborated = contentSwitch && prev && gpsJump(prev, rep, SCENE_GPS_JUMP_KM);
    const starts = !current || hardTimeSplit || sustainable || gpsCorroborated;

    if (starts) {
      current = newAnchorScene(chapterId, sig);
      scenes.push(current);
    }
    addRepToAnchorScene(current, rep, sig);
  }

  return scenes;
}

function newAnchorScene(chapterId, sig) {
  return { chapterId, sig, reps: [], photos: [], placeVotes: new Map(), activityVotes: new Map(), id: null };
}

function addRepToAnchorScene(scene, rep, sig = contentSignature(rep)) {
  scene.reps.push(rep);
  scene.photos.push(rep);
  if (sig.place) inc(scene.placeVotes, sig.place);
  if (sig.activity) inc(scene.activityVotes, sig.activity);
}

function assignPhotosToAnchorScenes(chapterPhotos, scenes) {
  const sceneByRepId = new Map();
  const repByCluster = new Map();
  for (const scene of scenes) {
    for (const rep of scene.reps || []) {
      sceneByRepId.set(rep.id, scene);
      if (rep.clusterId) repByCluster.set(rep.clusterId, rep);
    }
  }

  for (const scene of scenes) scene.photos = [];

  for (const photo of chapterPhotos) {
    let scene = null;
    if (photo.repr === true) scene = sceneByRepId.get(photo.id) || null;
    if (!scene && photo.clusterId) {
      const rep = repByCluster.get(photo.clusterId);
      if (rep) scene = sceneByRepId.get(rep.id) || null;
    }
    if (!scene) scene = nearestSceneByTime(scenes, photo);
    if (!scene) continue;
    scene.photos.push(photo);
  }

  for (const scene of scenes) scene.photos = uniqueById(scene.photos).sort(compareByTime);
}

function mergeSmallScenes(scenes) {
  const list = scenes.map((s) => cloneScene(s));
  let changed = true;
  while (changed && list.length > 1) {
    changed = false;
    for (let i = 0; i < list.length; i++) {
      const scene = list[i];
      if (!isSmallScene(scene)) continue;
      const target = nearestSceneIndex(list, i);
      if (target == null) continue;
      mergeSceneInto(list, i, target);
      changed = true;
      break;
    }
  }
  return list.map((scene) => {
    scene.photos = uniqueById(scene.photos).sort(compareByTime);
    scene.reps = uniqueById(scene.reps).sort(compareByTime);
    return scene;
  });
}

function isSmallScene(scene) {
  const count = (scene.photos || []).length;
  if (count >= MIN_SCENE_PHOTOS) return false;
  return spanMs(scene.photos) < MIN_SCENE_SPAN;
}

function nearestSceneIndex(list, index) {
  const prev = index > 0 ? index - 1 : null;
  const next = index < list.length - 1 ? index + 1 : null;
  const current = list[index];
  if (prev == null) {
    const nextGapOnly = Math.max(0, startMs(list[next].photos) - endMs(current.photos));
    return nextGapOnly <= SCENE_TIME_GAP ? next : null;
  }
  if (next == null) {
    const prevGapOnly = Math.max(0, startMs(current.photos) - endMs(list[prev].photos));
    return prevGapOnly <= SCENE_TIME_GAP ? prev : null;
  }
  const prevGap = Math.max(0, startMs(current.photos) - endMs(list[prev].photos));
  const nextGap = Math.max(0, startMs(list[next].photos) - endMs(current.photos));
  const chosen = prevGap <= nextGap ? prev : next;
  const chosenGap = prevGap <= nextGap ? prevGap : nextGap;
  return chosenGap <= SCENE_TIME_GAP ? chosen : null;
}

function mergeSceneInto(list, sourceIndex, targetIndex) {
  const source = list[sourceIndex];
  const target = list[targetIndex];
  target.reps = uniqueById((target.reps || []).concat(source.reps || [])).sort(compareByTime);
  target.photos = uniqueById((target.photos || []).concat(source.photos || [])).sort(compareByTime);
  mergeVotes(target.placeVotes, source.placeVotes);
  mergeVotes(target.activityVotes, source.activityVotes);
  list.splice(sourceIndex, 1);
}

function assignStableSceneIds(chapterId, scenes) {
  scenes.sort((a, b) => startMs(a.photos) - startMs(b.photos) || String(bestVote(a.placeVotes) || '').localeCompare(String(bestVote(b.placeVotes) || '')));
  scenes.forEach((scene, index) => { scene.id = `scene-${chapterId}-${index}`; scene.index = index; });
}

function sceneRecord(scene) {
  const photos = uniqueById(scene.photos || []).sort(compareByTime);
  const reps = uniqueById(scene.reps || []).sort(compareByTime);
  return {
    id: scene.id,
    chapterId: scene.chapterId,
    index: scene.index,
    start: startMs(photos),
    end: endMs(photos),
    count: photos.length,
    reprCount: reps.length,
    place: bestVote(scene.placeVotes),
    activity: bestVote(scene.activityVotes),
    photoIds: photos.map((p) => p.id),
    reprIds: reps.map((p) => p.id),
    thresholds: { ...SCENE_SNAPSHOT }
  };
}

function reconstructScenesFromRecords(photos) {
  const grouped = groupBy(photos.filter((p) => typeof p.sceneId === 'string'), (p) => p.sceneId);
  const records = [...grouped.entries()].map(([id, list]) => {
    const sorted = list.slice().sort(compareByTime);
    const chapterIds = [...new Set(sorted.map((p) => p.chapterId).filter(Number.isInteger))];
    return {
      id,
      chapterId: chapterIds.length === 1 ? chapterIds[0] : null,
      index: sceneIndexFromId(id),
      start: startMs(sorted),
      end: endMs(sorted),
      count: sorted.length,
      reprCount: sorted.filter((p) => p.repr === true).length,
      place: bestValue(sorted.map((p) => p.vlm?.place).filter(Boolean)),
      activity: bestValue(sorted.map((p) => p.vlm?.activity).filter(Boolean)),
      photoIds: sorted.map((p) => p.id),
      reprIds: sorted.filter((p) => p.repr === true).map((p) => p.id),
      thresholds: { ...SCENE_SNAPSHOT }
    };
  }).sort((a, b) => (a.chapterId ?? 1e12) - (b.chapterId ?? 1e12) || (a.index ?? 1e12) - (b.index ?? 1e12) || a.id.localeCompare(b.id));
  return withSnapshot(records);
}

function validateSceneContainment(photos, scenes) {
  const sceneById = new Map((scenes || []).map((s) => [s.id, s]));
  const byScene = groupBy(photos, (p) => p.sceneId || '__missing__');
  if (byScene.has('__missing__')) return false;
  for (const [sceneId, list] of byScene.entries()) {
    const scene = sceneById.get(sceneId);
    if (!scene) return false;
    const chapterIds = [...new Set(list.map((p) => p.chapterId))];
    if (chapterIds.length !== 1) return false;
    if (scene.chapterId !== chapterIds[0]) return false;
    if (!String(sceneId).startsWith(`scene-${chapterIds[0]}-`)) return false;
  }
  return true;
}

/* =====================================================
   Meta-Hilfen
   ===================================================== */
async function persistChapterSceneIds(db, scenes) {
  const chapters = await db.getMeta('chapters');
  if (!Array.isArray(chapters)) return;
  const idsByChapter = new Map();
  for (const scene of scenes || []) {
    if (!Number.isInteger(scene.chapterId)) continue;
    if (!idsByChapter.has(scene.chapterId)) idsByChapter.set(scene.chapterId, []);
    idsByChapter.get(scene.chapterId).push(scene.id);
  }
  const next = chapters.map((chapter) => ({
    ...chapter,
    sceneIds: (idsByChapter.get(chapter.id) || []).slice().sort(sceneIdCompare)
  }));
  if (chapters.snapshot) {
    try { Object.defineProperty(next, 'snapshot', { value: chapters.snapshot, enumerable: true, configurable: true }); }
    catch (_) { next.snapshot = chapters.snapshot; }
  }
  await db.putMeta('chapters', next);
}

async function removeChapterSceneIds(db) {
  const chapters = await db.getMeta('chapters');
  if (!Array.isArray(chapters)) return;
  const next = chapters.map((chapter) => ({ ...chapter, sceneIds: [] }));
  if (chapters.snapshot) {
    try { Object.defineProperty(next, 'snapshot', { value: chapters.snapshot, enumerable: true, configurable: true }); }
    catch (_) { next.snapshot = chapters.snapshot; }
  }
  await db.putMeta('chapters', next);
}

function withSnapshot(scenes) {
  const out = Array.isArray(scenes) ? scenes : [];
  try { Object.defineProperty(out, 'snapshot', { value: { ...SCENE_SNAPSHOT }, enumerable: true, configurable: true }); }
  catch (_) { out.snapshot = { ...SCENE_SNAPSHOT }; }
  return out;
}

function hasCurrentSnapshot(scenes) {
  if (!Array.isArray(scenes)) return false;
  if (scenes.length === 0) return scenes.snapshot?.implVersion === implVersion;
  return scenes.snapshot?.implVersion === implVersion || scenes[0]?.thresholds?.implVersion === implVersion;
}

/* =====================================================
   Primitive
   ===================================================== */
function contentSignature(photo) {
  const place = normalizeTag(photo?.vlm?.place);
  const activity = normalizeTag(photo?.vlm?.activity);
  return {
    place,
    activity,
    key: place || activity ? `${place || 'any'}|${activity || 'any'}` : 'untagged'
  };
}

function normalizeTag(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return text && text !== 'null' && text !== 'undefined' ? text : null;
}

function countRun(reps, start, key) {
  let count = 0;
  for (let i = start; i < reps.length; i++) {
    const sig = contentSignature(reps[i]);
    if (sig.key === 'untagged') continue;
    if (sig.key !== key) break;
    count++;
  }
  return count;
}

function nearestSceneByTime(scenes, photo) {
  let best = null;
  let bestDist = Infinity;
  for (const scene of scenes || []) {
    const anchors = scene.reps?.length ? scene.reps : scene.photos;
    const center = midpointMs(anchors);
    const dist = Math.abs(effTime(photo) - center);
    if (dist < bestDist || (dist === bestDist && startMs(anchors) < startMs(best?.reps || best?.photos || []))) {
      best = scene;
      bestDist = dist;
    }
  }
  return best;
}

function cloneScene(scene) {
  return {
    ...scene,
    reps: (scene.reps || []).slice(),
    photos: (scene.photos || []).slice(),
    placeVotes: new Map(scene.placeVotes || []),
    activityVotes: new Map(scene.activityVotes || [])
  };
}

function groupBy(list, fn) {
  const map = new Map();
  for (const item of list || []) {
    const key = fn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function uniqueById(list) {
  const map = new Map();
  for (const item of list || []) if (item?.id && !map.has(item.id)) map.set(item.id, item);
  return [...map.values()];
}

function inc(map, key) { map.set(key, (map.get(key) || 0) + 1); }
function mergeVotes(target, source) { for (const [key, count] of source || []) target.set(key, (target.get(key) || 0) + count); }
function bestVote(map) { return bestValue([...((map && map.entries && map.entries()) || [])].flatMap(([key, count]) => Array(count).fill(key))); }
function bestValue(values) {
  const counts = new Map();
  for (const value of values || []) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'de'))[0]?.[0] || null;
}

function sceneIndexFromId(id) {
  const m = String(id || '').match(/^scene-\d+-(\d+)$/);
  return m ? Number(m[1]) : null;
}
function sceneIdCompare(a, b) {
  const pa = parseSceneId(a);
  const pb = parseSceneId(b);
  return pa.chapter - pb.chapter || pa.index - pb.index || String(a).localeCompare(String(b));
}
function parseSceneId(id) {
  const m = String(id || '').match(/^scene-(\d+)-(\d+)$/);
  return { chapter: m ? Number(m[1]) : 1e12, index: m ? Number(m[2]) : 1e12 };
}

function normalizeStageFails(photo) {
  if (!photo.stageFails || typeof photo.stageFails !== 'object') photo.stageFails = {};
  return photo;
}

function gapMs(a, b) { return Math.max(0, effTime(b) - effTime(a)); }
function spanMs(photos) { return Math.max(0, endMs(photos) - startMs(photos)); }
function midpointMs(photos) {
  const start = startMs(photos);
  const end = endMs(photos);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return start + (end - start) / 2;
}
function startMs(photos) {
  const values = (photos || []).map(effTime).filter(Number.isFinite);
  return values.length ? Math.min(...values) : 0;
}
function endMs(photos) {
  const values = (photos || []).map(effTime).filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}
function effTime(p) {
  const t = p?.takenAt ?? p?.lastModified ?? 0;
  return Number.isFinite(t) ? t : 0;
}
function compareByTime(a, b) {
  const d = effTime(a) - effTime(b);
  if (d !== 0) return d;
  return (a.id || '').localeCompare(b.id || '');
}

function gpsJump(a, b, km) {
  if (!a?.gps || !b?.gps) return false;
  return haversineKm(a.gps.lat, a.gps.lon, b.gps.lat, b.gps.lon) > km;
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
