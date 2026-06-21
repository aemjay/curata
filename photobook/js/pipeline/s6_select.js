// js/pipeline/s6_select.js
// Stufe 6: narrative Selektion.
// E13.3 Phase 1: select-v5 — τ-Regler um den Auto-Punkt.
// Die Anzeige-Reihenfolge bleibt ausschließlich chronologisch.

import { ACTIVITY_CATEGORIES } from './s5_vlm.js';
import { selectDone } from '../selectors.js';
import { beatLabel } from '../beats.js';

const KEY = 'select';
export const implVersion = 'select-v5';

/** Gewicht der Technik-Komponente je Preset: strict priorisiert technische Qualität, moment hält Technik bewusst weich. */
export const W_TECH = Object.freeze({ strict: 1.5, moment: 0.5 });
/** Referenzgewicht für den VLM-MomentScore; narrative Relevanz ist die Leitgröße der Auswahl. */
export const W_MOMENT = 1.0;
/** Zusatzgewicht für Lächeln nur im Personenstrom; spürbar, aber nie dominanter als Moment. */
export const W_SMILE = 0.3;
/** Minimaler Tiebreaker-Bonus für offene Augen bei erkannten Gesichtern. */
export const BONUS_NO_BLINK = 0.05;
/** Neutraler Technik-Fallback: Analyseausfall darf weder belohnen noch disqualifizieren. */
export const NEUTRAL_TECH = 0.5;
/** Neutraler Moment-Fallback bei fehlendem VLM: Bild bleibt voll wählbar. */
export const NEUTRAL_MOMENT = 0.5;
/** Harte Mindestqualität für Floor/Beat-Seed und untere τ-Clamp-Grenze. */
export const FLOOR_MIN_SCORE = 0.35;
/** τ-naher Slack für Floor/Beat: floorGate=max(FLOOR_MIN_SCORE, τ_effektiv−FLOOR_SLACK). */
export const FLOOR_SLACK = 0.10;
/** Anteil der Dry-Run-Grenznutzenserie, der im Quantil-Fallback erhalten bleiben soll. */
export const TAU_KEEP_RATIO = 0.85;
/** Drop-Quantil der aufsteigend sortierten Dry-Run-Grenznutzenserie (= 1 − TAU_KEEP_RATIO). */
export const TAU_DROP_QUANTILE = 0.15;
/** Mindest-Sehnenabstand für einen akzeptierten Kniepunkt in der normierten Grenznutzenkurve. */
export const TAU_KNEE_MIN = 0.015;
/** Kniepunkte ganz am Anfang gelten als Artefakt und werden verworfen. */
export const TAU_KNEE_MIN_INDEX_FRACTION = 0.05;
/** Kniepunkte im langen Ende gelten als Artefakt und werden verworfen. */
export const TAU_KNEE_MAX_INDEX_FRACTION = 0.85;
/** Obere τ-Clamp-Grenze gegen pathologische Ausreißer. */
export const TAU_MAX_SCORE = 0.90;
/** Szenen-Malus je bereits gewähltem Bild derselben Szene; E13.2.2 dämpft ihn zum sanften Rhythmus-Nudge. */
export const LAMBDA_SCENE_BY_MODE = Object.freeze({ chronicle: 0.006, balanced: 0.006, highlights: 0.004 });
/** Komposition-adaptiver Zielabstand: abundante Klassen dürfen bis candShare−Nudge dominieren. */
export const DIVERSITY_NUDGE = 0.10;
/** Rare-Schwelle gegen Greedy-Frühstrafe; rare Klassen bekommen Penalty 0. */
export const EPS_SHARE = 0.01;
/** Zielanteile der P/S/M-Ströme je Fokus-Preset. */
export const STREAM_TARGETS = Object.freeze({
  people: Object.freeze({ P: 0.6, S: 0.2, M: 0.2 }),
  places: Object.freeze({ P: 0.2, S: 0.6, M: 0.2 }),
  balanced: Object.freeze({ P: 0.4, S: 0.3, M: 0.3 })
});
/** Gewicht der weichen Strom-Strafe gegen Überrepräsentation eines Stroms. */
export const W_STREAM = 0.5;
/** Toleranzband für die stream-Reject-Attribution; verhindert überempfindliche Labels. */
export const STREAM_TOLERANCE = 0.05;
/** Personen-Coverage-Fallbackklassen, solange echte personIds erst in E11 kommen. */
export const FACE_CLASSES = Object.freeze(['0', '1-2', '3+']);
/** Weiche Diversitätsstrafe über Face-Klassen; nur Drall, keine harte Quote. */
export const W_FACECLASS = 0.15;
/** Kleiner Bonus, wenn ein Kandidat einen in der Szene noch offenen Beat abdeckt. */
export const BEAT_BONUS = 0.05;
/** Letztes Drittel einer ausreichend stabilen Szene gilt als Transition-Fenster. */
export const TRANSITION_LATE_FRACTION = 2 / 3;
/** Single Source of Truth: aktive Aktivitäten sind alle VLM-Aktivitätskategorien außer Posing/Resting. */
export const ACTIVE_ACTIVITIES = Object.freeze(ACTIVITY_CATEGORIES.filter((a) => a !== 'posing' && a !== 'resting'));
/** Batchgröße für Photo-Persistenz; entspricht dem Pipeline-Persistenzvertrag. */
export const PERSIST_BATCH = 25;

const SELECT_REJECTS = new Set(['budget', 'redundant', 'stream']);
const STREAM_ORDER = Object.freeze(['P', 'S', 'M']);
const BEAT_ORDER = ['establishing', 'hero'];
const ACTIVE_ACTIVITY_SET = new Set(ACTIVE_ACTIVITIES);
const EPS = 1e-12;

class StageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StageError';
    this.cause = cause;
  }
}

/**
 * Normalisiert Presets defensiv. targetCount bleibt als Legacy-Feld erhalten,
 * wird aber nicht als Cap migriert; nur ein explizites maxPickCap kann begrenzen.
 * @param {object|null|undefined} raw
 * @returns {{selectionMode:'chronicle'|'balanced'|'highlights', focus:'people'|'places'|'balanced', techStrict:'strict'|'moment', maxPickCap:number|null, tauSliderPos:number}}
 */
export function normalizePresets(raw) {
  const selectionMode = ['chronicle', 'balanced', 'highlights'].includes(raw?.selectionMode) ? raw.selectionMode : 'balanced';
  const focus = ['people', 'places', 'balanced'].includes(raw?.focus) ? raw.focus : 'balanced';
  const techStrict = ['strict', 'moment'].includes(raw?.techStrict) ? raw.techStrict : 'moment';
  const maxPickCap = normalizeMaxPickCap(raw);
  const tauSliderPos = normalizeTauSliderPos(raw?.tauSliderPos);
  return { selectionMode, focus, techStrict, maxPickCap, tauSliderPos };
}

/**
 * @param {{ photos: object[], db: object, dispatch: Function, signal: AbortSignal, onProgress: Function }} ctx
 * @returns {Promise<{status:'done'}>}
 */
export async function runSelect({ photos, db, dispatch, signal, onProgress }) {
  void dispatch;
  const [rawPresets, rawOverrides] = await Promise.all([db.getMeta('presets'), db.getMeta('overrides')]);
  const presets = normalizePresets(rawPresets);
  const manualExcludeIds = manualExcludeIdSet(rawOverrides);
  const candidates = sortChronological((photos || []).filter(isCandidate));
  const total = Math.max(1, candidates.length * 2 + 1);
  let progress = 0;
  onProgress?.(0, total);

  if (candidates.length === 0) {
    if (signal?.aborted) return { status: 'done' };
    const emptyDiversity = computeAvailabilityStats([], new Map(), manualExcludeIds, presets.focus);
    const emptyTauEffective = deriveTauEffective(FLOOR_MIN_SCORE, presets.tauSliderPos);
    const emptyFloorGate = Math.max(FLOOR_MIN_SCORE, emptyTauEffective - FLOOR_SLACK);
    const emptySnapshot = makeSelectSnapshot({
      presets,
      tauAuto: FLOOR_MIN_SCORE,
      tauEffective: emptyTauEffective,
      tauSource: 'quantile',
      tauSliderPos: presets.tauSliderPos,
      floorGate: emptyFloorGate,
      maxPickCap: presets.maxPickCap,
      candidateCount: 0,
      pickedCount: 0,
      dryRunCount: 0,
      diversity: emptyDiversity,
      phasePicks: { floor: 0, beat: 0, greedy: 0 },
      capHit: false,
      keepHeadroom: 0
    });
    try {
      await db.putMeta('selectParams', emptySnapshot);
    } catch (err) {
      throw new StageError('Auswahl-Parameter konnten nicht geschrieben werden.', err);
    }
    onProgress?.(total, total);
    return { status: 'done' };
  }

  const chapterStats = computeChapterStats(candidates);
  const chapterOrder = [...chapterStats.keys()];
  const chapterIndex = new Map(chapterOrder.map((key, i) => [key, i + 1]));
  const sceneStats = computeSceneStats(candidates);
  const sceneOrder = [...sceneStats.keys()];
  const sceneIndex = new Map(sceneOrder.map((key, i) => [key, i + 1]));
  const infos = new Map();

  for (const p of candidates) {
    if (signal?.aborted) return { status: 'done' };
    const scKey = sceneKey(p);
    const info = {
      photo: p,
      chapterKey: chapterKey(p.chapterId),
      sceneKey: scKey,
      score: scorePhoto(p, presets.techStrict),
      beat: deriveBeat(p, sceneStats.get(scKey)),
      faceClass: faceClass(p),
      order: progress
    };
    infos.set(p.id, info);
    progress++;
    onProgress?.(Math.min(progress, total), total);
  }

  const diversity = computeAvailabilityStats(candidates, infos, manualExcludeIds, presets.focus);
  const dryState = createSelectionState({ presets, infos, chapterIndex, sceneIndex, tauAuto: null, tauEffective: null, floorGate: FLOOR_MIN_SCORE, diversity });
  const dryRun = dryRunGreedy(candidates, infos, dryState);
  const tauEstimate = estimateTauAuto(dryRun.eff);
  const tauAuto = tauEstimate.tau;
  const tauSource = tauEstimate.source;
  const tauEffective = deriveTauEffective(tauAuto, presets.tauSliderPos);
  const floorGate = Math.max(FLOOR_MIN_SCORE, tauEffective - FLOOR_SLACK);
  const state = createSelectionState({ presets, infos, chapterIndex, sceneIndex, tauAuto, tauEffective, floorGate, diversity });

  if (presets.selectionMode === 'chronicle' || presets.selectionMode === 'balanced') {
    phaseFloor(candidates, infos, state);
  }
  if (presets.selectionMode === 'chronicle') {
    phaseBeatHardening(candidates, infos, state);
  }
  phaseGreedy(candidates, infos, state, () => {
    progress++;
    onProgress?.(Math.min(progress, total), total);
  });

  applyResults(candidates, infos, state);
  await persistCandidates(candidates, db, signal);

  if (signal?.aborted) return { status: 'done' };
  const snapshot = makeSelectSnapshot({
    presets,
    tauAuto,
    tauEffective,
    tauSliderPos: presets.tauSliderPos,
    floorGate,
    maxPickCap: presets.maxPickCap,
    candidateCount: candidates.length,
    pickedCount: state.picks.length,
    dryRunCount: dryRun.eff.length,
    diversity,
    tauSource,
    phasePicks: state.phasePicks,
    capHit: capReached(state),
    keepHeadroom: computeKeepHeadroom(dryRun.items, state, tauEffective)
  });
  try {
    await db.putMeta('selectParams', snapshot);
  } catch (err) {
    throw new StageError('Auswahl-Parameter konnten nicht geschrieben werden.', err);
  }
  onProgress?.(total, total);
  return { status: 'done' };
}

/**
 * Validator: select-v5 Snapshot gegen normalisierte Presets, gemeinsame
 * selectDone-Semantik und defensive Cluster-pro-Szene-Invariante.
 * @param {object[]} photos
 * @param {object} db
 */
export async function validateSelect(photos, db) {
  const params = await db.getMeta('selectParams');
  if (!params || params.implVersion !== implVersion) return false;
  if (params.selectParamsSchema !== 'select-params-v3') return false;
  const snapshotPresets = params.presetsSnapshot || params.presets;
  if (!snapshotPresets) return false;
  const current = normalizePresets(await db.getMeta('presets'));
  if (!samePresets(normalizePresets(snapshotPresets), current)) return false;
  if (!Number.isFinite(Number(params.tauAuto)) || !Number.isFinite(Number(params.tauEffective))) return false;
  if (!Number.isFinite(Number(params.tauSliderPos))) return false;
  if (!selectDone(photos || [])) return false;
  return validateClusterInvariant(photos || []);
}

/**
 * Reset exakt nach §10.8: Solver-Felder und nur selektionsbezogene Rejects
 * löschen, duplicate-Rejects und fremde stageFails erhalten.
 */
export async function resetSelect(photos, db, context) {
  void context;
  const changed = [];
  for (const photo of photos || []) {
    if (!photo) continue;
    let dirty = false;
    if (photo.picked !== false) { photo.picked = false; dirty = true; }
    if (photo.beat !== null) { photo.beat = null; dirty = true; }
    if (photo.reason !== null) { photo.reason = null; dirty = true; }
    if (SELECT_REJECTS.has(photo.rejectReason)) { photo.rejectReason = null; dirty = true; }
    if (photo.stageFails && Object.prototype.hasOwnProperty.call(photo.stageFails, KEY)) {
      delete photo.stageFails[KEY];
      dirty = true;
    }
    if (dirty) changed.push(photo);
  }

  try {
    for (let i = 0; i < changed.length; i += PERSIST_BATCH) {
      await db.putPhotos(changed.slice(i, i + PERSIST_BATCH));
    }
    await db.deleteMeta('selectParams');
  } catch (err) {
    throw new StageError('Auswahl-Reset konnte nicht persistiert werden.', err);
  }
}

function makeSelectSnapshot({ presets, tauAuto, tauEffective, tauSliderPos, tauSource, floorGate, maxPickCap, candidateCount, pickedCount, dryRunCount = 0, diversity = null, phasePicks = null, capHit = false, keepHeadroom = 0 }) {
  const d = diversity || computeAvailabilityStats([], new Map(), new Set(), presets?.focus || 'balanced');
  return {
    implVersion,
    selectParamsSchema: 'select-params-v3',
    presetsSnapshot: { ...presets, tauSliderPos: normalizeTauSliderPos(tauSliderPos ?? presets?.tauSliderPos) },
    tauAuto: round4(tauAuto),
    tauEffective: round4(tauEffective),
    tauSliderPos: round4(normalizeTauSliderPos(tauSliderPos ?? presets?.tauSliderPos)),
    tauOffset: round4(Number(tauEffective) - Number(tauAuto)),
    tauSource: tauSource === 'knee' ? 'knee' : 'quantile',
    constants: {
      FLOOR_MIN_SCORE: round4(FLOOR_MIN_SCORE),
      FLOOR_SLACK: round4(FLOOR_SLACK),
      TAU_KEEP_RATIO: round4(TAU_KEEP_RATIO),
      TAU_DROP_QUANTILE: round4(TAU_DROP_QUANTILE),
      TAU_MAX_SCORE: round4(TAU_MAX_SCORE)
    },
    floorGate: round4(floorGate),
    maxPickCap: maxPickCap ?? null,
    candidateCount: Number(candidateCount) || 0,
    pickedCount: Number(pickedCount) || 0,
    dryRunCount: Number(dryRunCount) || 0,
    phasePicks: normalizePhasePicks(phasePicks),
    capHit: capHit === true,
    keepHeadroom: Math.max(0, Math.trunc(Number(keepHeadroom) || 0)),
    diversityNudge: round4(d.diversityNudge),
    epsShare: round4(d.epsShare),
    lambdaSceneByMode: roundShareObject(d.lambdaSceneByMode || LAMBDA_SCENE_BY_MODE),
    availabilityCount: Number(d.availabilityCount) || 0,
    candStreamShare: roundShareObject(d.candStreamShare, STREAM_ORDER),
    effStreamTarget: roundShareObject(d.effStreamTarget, STREAM_ORDER),
    rareStream: boolObject(d.rareStream, STREAM_ORDER),
    candFaceShare: roundShareObject(d.candFaceShare, FACE_CLASSES),
    effFaceTarget: roundShareObject(d.effFaceTarget, FACE_CLASSES),
    rareFace: boolObject(d.rareFace, FACE_CLASSES)
  };
}

function normalizePhasePicks(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    floor: Math.max(0, Math.trunc(Number(source.floor) || 0)),
    beat: Math.max(0, Math.trunc(Number(source.beat) || 0)),
    greedy: Math.max(0, Math.trunc(Number(source.greedy) || 0))
  };
}


function roundShareObject(source, keys = Object.keys(source || {})) {
  const out = {};
  for (const key of keys || []) out[key] = round4(source?.[key] ?? 0);
  return out;
}

function boolObject(source, keys) {
  const out = {};
  for (const key of keys || []) out[key] = source?.[key] === true;
  return out;
}

function normalizeTauSliderPos(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

function deriveTauEffective(tauAuto, tauSliderPos) {
  const tau = clampTau(tauAuto);
  const pos = normalizeTauSliderPos(tauSliderPos);
  if (pos >= 0) return clampTau(tau + pos * (TAU_MAX_SCORE - tau));
  return clampTau(tau + pos * (tau - FLOOR_MIN_SCORE));
}

function normalizeMaxPickCap(raw) {
  if (!raw || !Object.prototype.hasOwnProperty.call(raw, 'maxPickCap')) return null;
  const n = Number(raw.maxPickCap);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.min(10000, Math.trunc(n)));
}

function isCandidate(p) {
  return p && p.status === 'ok' && p.repr === true;
}

function sortChronological(list) {
  return (list || []).slice().sort(compareChronological);
}

function compareChronological(a, b) {
  const ta = a.takenAt ?? a.lastModified ?? 0;
  const tb = b.takenAt ?? b.lastModified ?? 0;
  if (ta !== tb) return ta - tb;
  return compareId(a.id, b.id);
}

function compareId(a, b) {
  const aa = String(a || '');
  const bb = String(b || '');
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

function chapterKey(id) {
  return Number.isInteger(id) ? `chapter:${id}` : 'chapter:none';
}

function sceneKey(photo) {
  return typeof photo?.sceneId === 'string' && photo.sceneId
    ? photo.sceneId
    : `scene-missing-${chapterKey(photo?.chapterId)}`;
}

function chapterLabel(chKey, indexMap) {
  return chKey === 'chapter:none' ? 'ohne Tag' : `Tag ${indexMap.get(chKey) || '?'}`;
}

function sceneLabel(scKey, state) {
  if (scKey.startsWith('scene-missing-')) return `Szene ohne ID (${chapterLabel(scKey.slice('scene-missing-'.length), state.chapterIndex)})`;
  return `Szene ${state.sceneIndex.get(scKey) || '?'}`;
}

function computeChapterStats(candidates) {
  const map = new Map();
  for (const p of candidates) {
    const key = chapterKey(p.chapterId);
    if (!map.has(key)) map.set(key, { key, photos: [], start: null, end: null });
    const stat = map.get(key);
    stat.photos.push(p);
    addTimeToStat(stat, p);
  }
  return map;
}

function computeSceneStats(candidates) {
  const map = new Map();
  for (const p of candidates) {
    const key = sceneKey(p);
    if (!map.has(key)) map.set(key, { key, chapterKey: chapterKey(p.chapterId), photos: [], start: null, end: null });
    const stat = map.get(key);
    stat.photos.push(p);
    addTimeToStat(stat, p);
  }
  return map;
}

function addTimeToStat(stat, photo) {
  const t = photo.takenAt ?? photo.lastModified ?? null;
  if (t != null) {
    stat.start = stat.start == null ? t : Math.min(stat.start, t);
    stat.end = stat.end == null ? t : Math.max(stat.end, t);
  }
}

function scorePhoto(photo, techStrict) {
  const wTech = W_TECH[techStrict] ?? W_TECH.moment;
  const sharp = bounded(photo.tech?.sharpness ?? NEUTRAL_TECH);
  const exposure = bounded(photo.tech?.exposure ?? NEUTRAL_TECH);
  const techMean = (sharp + exposure) / 2;
  const moment = bounded(photo.vlm?.momentScore ?? NEUTRAL_MOMENT);
  const smile = photo.stream === 'P' ? bounded(photo.faces?.smile ?? 0) : 0;
  const noBlink = photo.faces && photo.faces.count > 0 && !photo.faces.blink ? BONUS_NO_BLINK : 0;
  const raw = wTech * techMean + W_MOMENT * moment + W_SMILE * smile + noBlink;
  const attainable = wTech + W_MOMENT + (photo.stream === 'P' ? W_SMILE : 0) + ((photo.faces && photo.faces.count > 0) ? BONUS_NO_BLINK : 0);
  return attainable > 0 ? bounded(raw / attainable) : 0;
}

function bounded(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function deriveBeat(photo, scene) {
  const vlm = photo.vlm || null;
  if (photo.stream === 'M') return 'hero';
  if (photo.stream === 'S' && vlm?.shotType === 'wide') return 'establishing';
  if (photo.stream === 'P' && ACTIVE_ACTIVITY_SET.has(vlm?.activity)) return 'action';
  if (vlm?.shotType === 'detail') return 'detail';
  if (isLateTransition(photo, scene)) return 'transition';
  return null;
}

function isLateTransition(photo, scene) {
  if (!scene || !scene.photos || scene.photos.length < 3) return false;
  if (scene.start == null || scene.end == null || scene.end <= scene.start) return false;
  const t = photo.takenAt ?? photo.lastModified ?? null;
  if (t == null) return false;
  return (t - scene.start) / (scene.end - scene.start) >= TRANSITION_LATE_FRACTION;
}

function normalStream(stream) { return stream === 'P' || stream === 'M' || stream === 'S' ? stream : 'S'; }

function faceClass(photo) {
  const count = Number(photo.faces?.count ?? 0);
  if (count <= 0) return '0';
  return count <= 2 ? '1-2' : '3+';
}

function createSelectionState({ presets, infos, chapterIndex, sceneIndex, tauAuto, tauEffective, floorGate, diversity }) {
  return {
    presets,
    infos,
    chapterIndex,
    sceneIndex,
    tauAuto,
    tauEffective,
    tauSliderPos: presets.tauSliderPos,
    floorGate,
    diversity,
    picks: [],
    pickedIds: new Set(),
    blockedIds: new Set(),
    reasonById: new Map(),
    sceneCounts: new Map(),
    streamCounts: new Map(STREAM_ORDER.map((key) => [key, 0])),
    faceCounts: new Map(FACE_CLASSES.map((key) => [key, 0])),
    beatsByScene: new Map(),
    clustersByScene: new Map(),
    phasePicks: { floor: 0, beat: 0, greedy: 0 }
  };
}

function dryRunGreedy(candidates, infos, state) {
  const eff = [];
  const items = [];
  while (true) {
    let best = null;
    let bestEff = -Infinity;
    for (const p of candidates) {
      if (state.pickedIds.has(p.id)) continue;
      const info = infos.get(p.id);
      if (!info || clusterBlocked(info, state, false)) continue;
      const score = effectiveScore(info, state);
      if (!best || score > bestEff + EPS || (Math.abs(score - bestEff) <= EPS && betterGreedyTie(info, best))) {
        best = info;
        bestEff = score;
      }
    }
    if (!best) break;
    eff.push(bestEff);
    items.push({ id: best.photo.id, eff: bestEff });
    pick(best, state, 'dry-run');
  }
  return { eff, items };
}

function computeKeepHeadroom(items, state, tauEffective) {
  const tau = Number(tauEffective);
  if (!Number.isFinite(tau)) return 0;
  return (items || []).filter((x) =>
    x &&
    !state.pickedIds.has(x.id) &&
    Number.isFinite(Number(x.eff)) &&
    Number(x.eff) >= FLOOR_MIN_SCORE &&
    Number(x.eff) < tau
  ).length;
}


function manualExcludeIdSet(overrides) {
  const excluded = new Set();
  for (const ov of (Array.isArray(overrides) ? overrides : [])) {
    if (!ov || !ov.photoId) continue;
    if (ov.type === 'exclude') excluded.add(ov.photoId);
    else if (ov.type === 'include') excluded.delete(ov.photoId);
  }
  return excluded;
}

function computeAvailabilityStats(candidates, infos, manualExcludeIds, focus) {
  const streamCounts = Object.fromEntries(STREAM_ORDER.map((key) => [key, 0]));
  const faceCounts = Object.fromEntries(FACE_CLASSES.map((key) => [key, 0]));
  let availabilityCount = 0;

  for (const p of candidates || []) {
    const info = infos.get(p.id);
    if (!info || !Number.isFinite(info.score)) continue;
    if (p.rejectReason === 'duplicate') continue;
    if (manualExcludeIds?.has(p.id)) continue;
    availabilityCount++;
    streamCounts[normalStream(p.stream)] += 1;
    faceCounts[info.faceClass] += 1;
  }

  const idealStream = STREAM_TARGETS[focus] || STREAM_TARGETS.balanced;
  const candStreamShare = {};
  const effStreamTarget = {};
  const rareStream = {};
  for (const key of STREAM_ORDER) {
    const share = availabilityCount > 0 ? streamCounts[key] / availabilityCount : 0;
    const ideal = idealStream[key] ?? 0;
    const rare = availabilityCount <= 0 || share <= ideal + EPS_SHARE;
    candStreamShare[key] = share;
    rareStream[key] = rare;
    effStreamTarget[key] = rare ? 1.0 : Math.max(ideal, share - DIVERSITY_NUDGE);
  }

  const candFaceShare = {};
  const effFaceTarget = {};
  const rareFace = {};
  const idealFace = 1 / FACE_CLASSES.length;
  for (const key of FACE_CLASSES) {
    const share = availabilityCount > 0 ? faceCounts[key] / availabilityCount : 0;
    const rare = availabilityCount <= 0 || share <= idealFace + EPS_SHARE;
    candFaceShare[key] = share;
    rareFace[key] = rare;
    effFaceTarget[key] = rare ? 1.0 : Math.max(idealFace, share - DIVERSITY_NUDGE);
  }

  return {
    diversityNudge: DIVERSITY_NUDGE,
    epsShare: EPS_SHARE,
    lambdaSceneByMode: LAMBDA_SCENE_BY_MODE,
    availabilityCount,
    candStreamShare,
    effStreamTarget,
    rareStream,
    candFaceShare,
    effFaceTarget,
    rareFace
  };
}

function isRareStream(state, stream) {
  return state.diversity?.rareStream?.[stream] === true;
}

function isRareFace(state, face) {
  return state.diversity?.rareFace?.[face] === true;
}

function streamTarget(state, stream) {
  const fallback = (STREAM_TARGETS[state.presets.focus] || STREAM_TARGETS.balanced)[stream] ?? 0;
  const value = state.diversity?.effStreamTarget?.[stream];
  return Number.isFinite(value) ? value : fallback;
}

function faceTarget(state, face) {
  const value = state.diversity?.effFaceTarget?.[face];
  return Number.isFinite(value) ? value : 1 / FACE_CLASSES.length;
}

function estimateTauAuto(eff) {
  const values = (eff || []).filter((n) => Number.isFinite(n));
  if (values.length < 3) return { tau: FLOOR_MIN_SCORE, source: 'quantile' };

  const mono = [];
  for (const value of values) {
    const previous = mono.length ? mono[mono.length - 1] : Infinity;
    mono.push(Math.min(previous, value));
  }

  const knee = findTauKnee(mono);
  if (knee != null) return { tau: clampTau(knee), source: 'knee' };

  const sorted = values.slice().sort((a, b) => a - b);
  const idx = quantileIndex(sorted.length, TAU_DROP_QUANTILE);
  return { tau: clampTau(sorted[idx]), source: 'quantile' };
}

function findTauKnee(mono) {
  const yMin = Math.min(...mono);
  const yMax = Math.max(...mono);
  const yRange = yMax - yMin;
  if (!(yRange > EPS)) return null;

  const n = mono.length;
  const points = mono.map((score, i) => ({
    score,
    x: n === 1 ? 0 : i / (n - 1),
    y: (score - yMin) / yRange
  }));

  const first = points[0];
  const last = points[points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const denom = Math.sqrt(dx * dx + dy * dy) || 1;
  let bestIdx = 0;
  let bestDist = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const dist = Math.abs(dy * p.x - dx * p.y + last.x * first.y - last.y * first.x) / denom;
    if (dist > bestDist + EPS || (Math.abs(dist - bestDist) <= EPS && i < bestIdx)) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  const idxFraction = n === 1 ? 0 : bestIdx / (n - 1);
  if (bestDist < TAU_KNEE_MIN) return null;
  if (idxFraction < TAU_KNEE_MIN_INDEX_FRACTION || idxFraction > TAU_KNEE_MAX_INDEX_FRACTION) return null;
  return kneeTauAtEdge(mono, bestIdx);
}

/** Bei einer harten Stufe liegt der maximale Sehnenabstand oft direkt nach dem Abfall; τ muss dann den letzten Wert vor der Kante nehmen. */
function kneeTauAtEdge(mono, bestIdx) {
  if (bestIdx > 0 && mono[bestIdx] < mono[bestIdx - 1] - EPS) return mono[bestIdx - 1];
  return mono[bestIdx];
}

function quantileIndex(length, q) {
  const n = Math.max(0, Number(length) || 0);
  if (n <= 1) return 0;
  const qq = Math.max(0, Math.min(1, Number(q)));
  return Math.max(0, Math.min(n - 1, Math.floor((n - 1) * qq)));
}

function clampTau(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return FLOOR_MIN_SCORE;
  return Math.max(FLOOR_MIN_SCORE, Math.min(TAU_MAX_SCORE, n));
}

function phaseFloor(candidates, infos, state) {
  const byScene = candidatesByScene(candidates);
  for (const [scKey, list] of byScene.entries()) {
    if (capReached(state)) return;
    let best = null;
    for (const p of list) {
      if (state.pickedIds.has(p.id)) continue;
      const info = infos.get(p.id);
      if (!info || info.score < state.floorGate) continue;
      if (clusterBlocked(info, state, true)) continue;
      if (!best || betterBase(info, best)) best = info;
    }
    if (best) pick(best, state, `Szenen-Floor ${sceneLabel(scKey, state)} — bestes Bild der Szene (Score ${fmt2(best.score)}, Gate ${fmt2(state.floorGate)})`, 'floor');
  }
}

function phaseBeatHardening(candidates, infos, state) {
  const byScene = candidatesByScene(candidates);
  for (const [scKey, list] of byScene.entries()) {
    for (const beat of BEAT_ORDER) {
      if (capReached(state)) return;
      if (beatCovered(scKey, beat, state)) continue;
      let best = null;
      for (const p of list) {
        if (state.pickedIds.has(p.id)) continue;
        const info = infos.get(p.id);
        if (!info || info.beat !== beat || info.score < state.floorGate) continue;
        if (clusterBlocked(info, state, true)) continue;
        if (!best || betterBase(info, best)) best = info;
      }
      if (best) {
        const reason = beat === 'establishing'
          ? `${beatLabel('establishing')} ${sceneLabel(scKey, state)} — Weitwinkel-Ortsbild, Score ${fmt2(best.score)}, Gate ${fmt2(state.floorGate)}`
          : `Hero-Anker ${sceneLabel(scKey, state)} — bestes M-Bild${momentText(best.photo)}, Gate ${fmt2(state.floorGate)}`;
        pick(best, state, reason, 'beat');
      }
    }
  }
}

function phaseGreedy(candidates, infos, state, tick) {
  while (!capReached(state)) {
    let best = null;
    let bestEff = -Infinity;
    for (const p of candidates) {
      if (state.pickedIds.has(p.id)) continue;
      const info = infos.get(p.id);
      if (!info) continue;
      if (clusterBlocked(info, state, true)) continue;
      const eff = effectiveScore(info, state);
      if (!best || eff > bestEff + EPS || (Math.abs(eff - bestEff) <= EPS && betterGreedyTie(info, best))) {
        best = info;
        bestEff = eff;
      }
    }
    if (!best || bestEff < state.tauEffective) break;
    pick(best, state, greedyReason(best, bestEff, state), 'greedy');
    tick?.();
  }
}

function candidatesByScene(candidates) {
  const map = new Map();
  for (const p of candidates) {
    const key = sceneKey(p);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return map;
}

function capReached(state) {
  const cap = state.presets.maxPickCap;
  return Number.isInteger(cap) && cap > 0 && state.picks.length >= cap;
}

function betterBase(info, current) {
  if (Math.abs(info.score - current.score) > EPS) return info.score > current.score;
  return compareChronological(info.photo, current.photo) < 0;
}

function betterGreedyTie(info, current) {
  if (Math.abs(info.score - current.score) > EPS) return info.score > current.score;
  return compareChronological(info.photo, current.photo) < 0;
}

function clusterBlocked(info, state, mark) {
  const clusterId = info.photo.clusterId;
  if (!clusterId) return false;
  const used = state.clustersByScene.get(info.sceneKey);
  const blocked = used ? used.has(clusterId) : false;
  if (blocked && mark) state.blockedIds.add(info.photo.id);
  return blocked;
}

function pick(info, state, reason, phase = null) {
  if (state.pickedIds.has(info.photo.id)) return;
  state.pickedIds.add(info.photo.id);
  state.picks.push(info);
  state.reasonById.set(info.photo.id, reason);
  if (phase === 'floor' || phase === 'beat' || phase === 'greedy') {
    state.phasePicks[phase] = (state.phasePicks[phase] || 0) + 1;
  }
  state.sceneCounts.set(info.sceneKey, (state.sceneCounts.get(info.sceneKey) || 0) + 1);
  const stream = normalStream(info.photo.stream);
  state.streamCounts.set(stream, (state.streamCounts.get(stream) || 0) + 1);
  state.faceCounts.set(info.faceClass, (state.faceCounts.get(info.faceClass) || 0) + 1);
  if (info.beat) {
    if (!state.beatsByScene.has(info.sceneKey)) state.beatsByScene.set(info.sceneKey, new Set());
    state.beatsByScene.get(info.sceneKey).add(info.beat);
  }
  if (info.photo.clusterId) {
    if (!state.clustersByScene.has(info.sceneKey)) state.clustersByScene.set(info.sceneKey, new Set());
    state.clustersByScene.get(info.sceneKey).add(info.photo.clusterId);
  }
}

function effectiveScore(info, state) {
  const nAfter = state.picks.length + 1;
  const stream = normalStream(info.photo.stream);
  const streamShareAfter = ((state.streamCounts.get(stream) || 0) + 1) / nAfter;
  const faceShareAfter = ((state.faceCounts.get(info.faceClass) || 0) + 1) / nAfter;
  const penaltyWarmup = Math.min(1, state.picks.length / 6);
  const scenePenalty = (LAMBDA_SCENE_BY_MODE[state.presets.selectionMode] || 0) * (state.sceneCounts.get(info.sceneKey) || 0);
  const streamPenalty = isRareStream(state, stream) ? 0 : penaltyWarmup * W_STREAM * Math.max(0, streamShareAfter - streamTarget(state, stream));
  const facePenalty = isRareFace(state, info.faceClass) ? 0 : penaltyWarmup * W_FACECLASS * Math.max(0, faceShareAfter - faceTarget(state, info.faceClass));
  const beatBonus = info.beat && !beatCovered(info.sceneKey, info.beat, state) ? BEAT_BONUS : 0;
  return info.score - scenePenalty - streamPenalty - facePenalty + beatBonus;
}

function beatCovered(scKey, beat, state) {
  return !!(beat && state.beatsByScene.get(scKey)?.has(beat));
}

function applyResults(candidates, infos, state) {
  const finalShares = computeFinalShares(state);
  for (const p of candidates) {
    normalizeStageFails(p);
    if (p.stageFails && Object.prototype.hasOwnProperty.call(p.stageFails, KEY)) delete p.stageFails[KEY];
    const info = infos.get(p.id);
    if (state.pickedIds.has(p.id)) {
      p.picked = true;
      p.beat = info?.beat ?? null;
      p.reason = state.reasonById.get(p.id) || greedyReason(info, null, state);
      p.rejectReason = null;
    } else {
      p.picked = false;
      p.beat = null;
      p.reason = null;
      p.rejectReason = rejectReasonFor(info, state, finalShares);
    }
  }
}

function computeFinalShares(state) {
  const total = state.picks.length;
  const stream = new Map(STREAM_ORDER.map((key) => [key, 0]));
  const face = new Map(FACE_CLASSES.map((key) => [key, 0]));
  if (total > 0) {
    for (const key of stream.keys()) stream.set(key, (state.streamCounts.get(key) || 0) / total);
    for (const key of face.keys()) face.set(key, (state.faceCounts.get(key) || 0) / total);
  }
  return { stream, face };
}

function rejectReasonFor(info, state, finalShares) {
  if (!info) return 'budget';
  if (state.blockedIds.has(info.photo.id)) return 'redundant';
  const stream = normalStream(info.photo.stream);
  const face = info.faceClass;
  const streamShare = finalShares.stream.get(stream) || 0;
  const faceShare = finalShares.face.get(face) || 0;
  const overStream = !isRareStream(state, stream) && streamShare >= streamTarget(state, stream) + STREAM_TOLERANCE;
  const overFace = !isRareFace(state, face) && faceShare >= faceTarget(state, face) + STREAM_TOLERANCE;
  if (info.score >= state.floorGate && !isRareStream(state, stream) && !isRareFace(state, face) && (overStream || overFace)) return 'stream';
  if (info.score >= state.floorGate && (state.sceneCounts.get(info.sceneKey) || 0) >= 1) return 'redundant';
  return 'budget';
}

function greedyReason(info, eff, state) {
  if (!info) return 'Score-Auswahl';
  const parts = [];
  if (info.photo.vlm?.momentScore != null) parts.push(`Moment ${fmt1(info.photo.vlm.momentScore)}`);
  if (info.photo.tech) parts.push(`Technik ${Math.round(((bounded(info.photo.tech.sharpness) + bounded(info.photo.tech.exposure)) / 2) * 100)} %`);
  if (info.beat) parts.push(beatReason(info.beat));
  if (eff != null) parts.push(`Grenznutzen ${fmt2(eff)} ≥ τ ${fmt2(state.tauEffective)}`);
  return parts.length ? `Score-Auswahl — ${parts.join(', ')}` : `Score-Auswahl — Score ${fmt2(info.score)}`;
}

function beatReason(beat) {
  return beat ? beatLabel(beat) : '';
}

function momentText(photo) {
  return photo.vlm?.momentScore != null ? `, Moment ${fmt1(photo.vlm.momentScore)}` : '';
}

function fmt1(v) { return String(Math.round(bounded(v) * 10) / 10); }
function fmt2(v) { return String(round4(v).toFixed(2)); }
function round4(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

function normalizeStageFails(photo) {
  if (!photo.stageFails || typeof photo.stageFails !== 'object') photo.stageFails = {};
}

async function persistCandidates(candidates, db, signal) {
  try {
    for (let i = 0; i < candidates.length; i += PERSIST_BATCH) {
      if (signal?.aborted) return;
      await db.putPhotos(candidates.slice(i, i + PERSIST_BATCH));
    }
  } catch (err) {
    throw new StageError('Auswahl-Ergebnis konnte nicht persistiert werden.', err);
  }
}

function samePresets(a, b) {
  return a.selectionMode === b.selectionMode &&
    a.focus === b.focus &&
    a.techStrict === b.techStrict &&
    (a.maxPickCap ?? null) === (b.maxPickCap ?? null) &&
    normalizeTauSliderPos(a.tauSliderPos) === normalizeTauSliderPos(b.tauSliderPos);
}

function validateClusterInvariant(photos) {
  const seen = new Map();
  for (const p of photos || []) {
    if (!isCandidate(p) || p.picked !== true || !p.clusterId) continue;
    const key = `${sceneKey(p)}|${p.clusterId}`;
    if (seen.has(key)) return false;
    seen.set(key, p.id);
  }
  return true;
}
