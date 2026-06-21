// js/selectors.js
// Abgeleitete Daten (§10.5: nie im State duplizieren — hier berechnet, in den
// Komponenten via useMemo gehalten). Etappe 7 ergänzt Review-Ableitungen:
// Auswahl, Verworfene, Clustergruppen und kapitelweise Storyboard-Streifen.

import { BEATS } from './beats.js';

/* =====================================================
   KAPITELGRUPPIERUNG (E4)
   ===================================================== */
/**
 * Gruppiert Fotos nach chapterId in Kapitelreihenfolge; innerhalb jedes Kapitels
 * chronologisch. Fotos ohne chapterId landen in einer abschließenden Gruppe
 * (chapter: null). Mutiert die Eingaben nicht.
 * @param {object[]} photos
 * @param {object[]} chapters  Kapitelliste {id,start,end,count}
 * @returns {{chapter: object|null, photos: object[]}[]}
 */
export function groupByChapter(photos, chapters) {
  const byId = new Map();
  for (const p of photos || []) {
    const key = Number.isInteger(p.chapterId) ? p.chapterId : '__none__';
    if (!byId.has(key)) byId.set(key, []);
    byId.get(key).push(p);
  }
  for (const list of byId.values()) list.sort(compareChronological);

  const groups = [];
  const consumed = new Set();
  for (const ch of (chapters || [])) {
    const list = byId.get(ch.id);
    if (list && list.length) { groups.push({ chapter: ch, photos: list }); consumed.add(ch.id); }
  }
  // Defensiv: chapterIds ohne passenden Listeneintrag (z. B. veraltete meta)
  // nicht verschlucken, sondern in Reihenfolge anhängen.
  const orphanIds = [...byId.keys()]
    .filter((k) => Number.isInteger(k) && !consumed.has(k))
    .sort((a, b) => a - b);
  for (const id of orphanIds) {
    const list = byId.get(id);
    const times = list.map((p) => p.takenAt ?? p.lastModified ?? 0);
    groups.push({
      chapter: { id, start: Math.min(...times), end: Math.max(...times), count: list.length },
      photos: list
    });
  }
  const none = byId.get('__none__');
  if (none && none.length) groups.push({ chapter: null, photos: none });
  return groups;
}

/** Lesbare Zeitspanne eines Kapitels (de). */
export function formatChapterRange(chapter) {
  if (!chapter) return 'Ohne Zeitstempel';
  const s = new Date(chapter.start);
  const e = new Date(chapter.end);
  const day = { day: 'numeric', month: 'short', year: 'numeric' };
  const time = { hour: '2-digit', minute: '2-digit' };
  const sameDay = s.toDateString() === e.toDateString();
  if (sameDay) return `${fmt(s, day)} · ${fmt(s, time)} – ${fmt(e, time)}`;
  return `${fmt(s, day)} – ${fmt(e, day)}`;
}

function fmt(date, opts) {
  try { return new Intl.DateTimeFormat('de-DE', opts).format(date); }
  catch (_) { return date.toISOString().slice(0, 10); }
}

const HEIC_RE = /\.(heic|heif)$/i;

/* =====================================================
   ORDNUNG (§3: Chronologie ist dominanter Ordnungsfaktor)
   ===================================================== */
/**
 * Liefert eine neue, chronologisch sortierte Liste (nach takenAt; Fallback
 * lastModified). Stabil bei Gleichstand über die id. Mutiert die Eingabe nicht.
 * Notwendig, weil db.getAllPhotos() in SHA-1-Schlüsselreihenfolge zurückgibt.
 * @param {object[]} photos
 * @returns {object[]}
 */
export function sortChronologically(photos) {
  return (photos || []).slice().sort(compareChronological);
}

function compareChronological(a, b) {
  const ta = a.takenAt ?? a.lastModified ?? 0;
  const tb = b.takenAt ?? b.lastModified ?? 0;
  if (ta !== tb) return ta - tb;
  return (a.id || '') < (b.id || '') ? -1 : (a.id === b.id ? 0 : 1);
}

/* =====================================================
   REVIEW-ABLEITUNGEN (E7/E9)
   ===================================================== */
const REJECT_LABELS = {
  duplicate: 'Ähnliche / Duplikate',
  budget: 'Mengenlimit',
  redundant: 'Redundant',
  stream: 'Strom-Balance',
  blurry: 'Technisch schwach',
  failed: 'Nicht verarbeitbar',
  none: 'Ohne Grund'
};

const REJECT_ORDER = ['duplicate', 'budget', 'redundant', 'stream', 'blurry', 'failed', 'none'];
const SOLVER_REJECTS = new Set(['budget', 'redundant', 'stream']);
const STREAMS = ['P', 'S', 'M'];
const STREAM_TARGETS = Object.freeze({
  people: Object.freeze({ P: 0.6, S: 0.2, M: 0.2 }),
  places: Object.freeze({ P: 0.2, S: 0.6, M: 0.2 }),
  balanced: Object.freeze({ P: 0.4, S: 0.3, M: 0.3 })
});
const FACE_CLASSES = ['0', '1-2', '3+'];

/* =====================================================
   KAPITEL-KONTEXT-ANSICHT (Diagnose, keine Persistenz)
   ===================================================== */
/**
 * Score-Abstand für „knapp verworfen". Der Score ist 0..1 normalisiert;
 * 0.08 entspricht einem engen Diagnosefenster ohne die Kapitelansicht zu
 * überfrachten. Die Anzeige bleibt zusätzlich kapitelweise eingeklappt.
 */
export const NEAR_MISS_DELTA = 0.08;

// Synchronisierte Basis-Score-Logik aus s6_select.js. Bewusst lokal gehalten,
// damit selectors.js keine zirkuläre Kopplung zur Pipeline-Stufe erzeugt
// (s6_select importiert selectDone aus dieser Datei). Persistierte Score-Felder
// werden nur als Fallback gelesen, falls der Basisvergleich künftig nicht mehr
// aus den vorhandenen Photo-Feldern rekonstruierbar sein sollte.
const CONTEXT_W_TECH = Object.freeze({ strict: 1.5, moment: 0.5 });
const CONTEXT_W_MOMENT = 1.0;
const CONTEXT_W_SMILE = 0.3;
const CONTEXT_BONUS_NO_BLINK = 0.05;
const CONTEXT_NEUTRAL_TECH = 0.5;
const CONTEXT_NEUTRAL_MOMENT = 0.5;
const SCORE_EPS = 1e-12;
const STRUCTURAL_CONTEXT_REJECTS = new Set(['stream', 'budget', 'redundant']);

/**
 * Baut eine kapitelweise Kontextansicht aus Picks, knapp verworfenen und
 * strukturell verworfenen Bildern. Die Funktion liest ausschließlich vorhandene
 * Photo-/Review-Daten, mutiert nichts und schreibt keine Overrides. Sortierung:
 * takenAt → lastModified → id.
 *
 * „Knapp verworfen" bleibt die bestehende Near-Miss-Logik:
 * - nicht ausgewähltes, ok-verarbeitetes Cluster-Repräsentantenbild, oder
 * - Basis-Score höchstens NEAR_MISS_DELTA unter dem schwächsten Pick desselben
 *   Kapitels.
 *
 * „Strukturell verworfen" ist ein nicht ausgewähltes, ok-verarbeitetes
 * Repräsentantenbild mit rejectReason budget/stream/redundant, sofern es
 * nicht bereits knapp verworfen ist. Duplicate-Rejects bleiben ausgeschlossen;
 * sie gehören ausschließlich in den Cluster-Tausch.
 *
 * @param {object[]} photos
 * @param {object[]} chapters
 * @param {ReturnType<typeof buildReviewData>} review
 * @param {object=} presets
 */
export function buildChapterContextData(photos, chapters, review, presets = {}, scenes = []) {
  const all = sortChronologically(photos || []);
  const selection = review?.selection || [];
  const selectedIds = new Set((review?.selectedIds ? [...review.selectedIds] : selection.map((p) => p.id)).filter(Boolean));
  const solverPickedIds = review?.solverPickedIds instanceof Set
    ? review.solverPickedIds
    : new Set((selection || []).filter((p) => p?.picked === true).map((p) => p.id));
  const overrideStatusById = review?.overrideStatusById instanceof Map ? review.overrideStatusById : new Map();
  const rejectedById = new Map((review?.rejected || []).map((p) => [p.id, p]));
  const scoreById = new Map();
  const weakestPickScoreByChapter = new Map();
  const techStrict = ['strict', 'moment'].includes(presets?.techStrict) ? presets.techStrict : 'moment';

  for (const p of all) scoreById.set(p.id, contextScorePhoto(p, techStrict));

  for (const p of selection) {
    if (!p || p.status !== 'ok') continue;
    const key = chapterKey(p.chapterId);
    const score = scoreById.get(p.id);
    if (!Number.isFinite(score)) continue;
    const current = weakestPickScoreByChapter.get(key);
    if (current == null || score < current) weakestPickScoreByChapter.set(key, score);
  }

  const sceneMeta = buildSceneMetaMap(all, scenes);
  const groups = groupByChapter(all, chapters)
    .map((group) => {
      const items = [];
      let pickCount = 0;
      let nearMissCount = 0;
      let structuralCount = 0;

      for (const p of group.photos || []) {
        if (!p || p.status !== 'ok') continue;
        const score = scoreById.get(p.id);
        const rejectedViewPhoto = rejectedById.get(p.id);
        const rejectReason = rejectedViewPhoto?._effectiveRejectReason || p.rejectReason || 'none';
        const effectivePicked = selectedIds.has(p.id);
        const solverPicked = solverPickedIds.has(p.id);
        const overrideStatus = overrideStatusById.get(p.id) || null;
        const base = contextItemBase(p, {
          effectivePicked,
          solverPicked,
          rejectReason,
          overrideStatus,
          score
        });

        if (effectivePicked) {
          pickCount += 1;
          items.push({
            ...base,
            type: 'pick',
            photo: decorateContextPhoto(p, base)
          });
          continue;
        }

        if (solverPicked && overrideStatus === 'excluded') {
          items.push({
            ...base,
            type: 'exPick',
            actionKind: 'restore',
            photo: decorateContextPhoto(p, { ...base, actionKind: 'restore' })
          });
          continue;
        }

        const near = nearMissInfo(p, score, weakestPickScoreByChapter.get(chapterKey(p.chapterId)), rejectedViewPhoto);
        if (near) {
          nearMissCount += 1;
          const item = {
            ...base,
            type: 'nearMiss',
            rejectReason: near.rejectReason,
            actionKind: 'restore',
            near,
            score: near.score,
            photo: decorateContextPhoto(near.photo, { ...base, rejectReason: near.rejectReason, actionKind: 'restore', score: near.score })
          };
          items.push(item);
          continue;
        }

        const structural = structuralRejectInfo(p, score, rejectedViewPhoto);
        if (structural) {
          structuralCount += 1;
          const item = {
            ...base,
            type: 'structural',
            rejectReason: structural.rejectReason,
            actionKind: 'restore',
            structural,
            score: structural.score,
            photo: decorateContextPhoto(structural.photo, { ...base, rejectReason: structural.rejectReason, actionKind: 'restore', score: structural.score })
          };
          items.push(item);
        }
      }

      const sceneGroups = groupContextItemsByScene(items, group, sceneMeta);
      return { chapter: group.chapter, items, scenes: sceneGroups, pickCount, nearMissCount, structuralCount };
    })
    .filter((group) => group.items.length > 0);

  const nearMissCount = groups.reduce((sum, group) => sum + group.nearMissCount, 0);
  const structuralCount = groups.reduce((sum, group) => sum + group.structuralCount, 0);

  return {
    groups,
    pickCount: groups.reduce((sum, group) => sum + group.pickCount, 0),
    nearMissCount,
    structuralCount,
    rejectedContextCount: nearMissCount + structuralCount,
    nearMissDelta: NEAR_MISS_DELTA
  };
}

function buildSceneMetaMap(photos, scenes) {
  const map = new Map();
  for (const scene of scenes || []) {
    if (scene?.id) map.set(scene.id, scene);
  }
  if (map.size) return map;
  const grouped = new Map();
  for (const p of photos || []) {
    if (typeof p.sceneId !== 'string') continue;
    if (!grouped.has(p.sceneId)) grouped.set(p.sceneId, []);
    grouped.get(p.sceneId).push(p);
  }
  for (const [id, list] of grouped.entries()) {
    const sorted = sortChronologically(list);
    map.set(id, {
      id,
      chapterId: sorted[0]?.chapterId ?? null,
      index: sceneIndexFromId(id),
      start: sorted[0]?.takenAt ?? sorted[0]?.lastModified ?? 0,
      end: sorted[sorted.length - 1]?.takenAt ?? sorted[sorted.length - 1]?.lastModified ?? 0,
      count: sorted.length,
      place: bestValue(sorted.map((p) => p.vlm?.place).filter(Boolean)),
      activity: bestValue(sorted.map((p) => p.vlm?.activity).filter(Boolean))
    });
  }
  return map;
}

function groupContextItemsByScene(items, chapterGroup, sceneMeta) {
  const byKey = new Map();
  for (const item of items || []) {
    const photo = item?.photo || {};
    const key = typeof photo.sceneId === 'string' ? photo.sceneId : sceneFallbackKey(chapterGroup?.chapter?.id);
    if (!byKey.has(key)) byKey.set(key, { key, scene: sceneMeta.get(key) || fallbackSceneMeta(key, chapterGroup, item), items: [] });
    byKey.get(key).items.push(item);
  }

  const orderedKeys = [...byKey.keys()].sort((a, b) => compareSceneKeys(a, b, byKey));
  return orderedKeys.map((key, index) => {
    const group = byKey.get(key);
    const visibleItems = sortContextItems(group.items);
    const counts = countContextItems(visibleItems);
    return {
      scene: group.scene ? { ...group.scene, displayIndex: index } : fallbackSceneMeta(key, chapterGroup, visibleItems[0]),
      items: visibleItems,
      ...counts
    };
  });
}

function sortContextItems(items) {
  return (items || []).slice().sort((a, b) => compareChronological(a.photo, b.photo));
}

function countContextItems(items) {
  let pickCount = 0;
  let nearMissCount = 0;
  let structuralCount = 0;
  for (const item of items || []) {
    if (item.type === 'pick') pickCount++;
    else if (item.type === 'nearMiss') nearMissCount++;
    else if (item.type === 'structural') structuralCount++;
  }
  return { pickCount, nearMissCount, structuralCount };
}

function sceneFallbackKey(chapterId) { return `scene-${Number.isInteger(chapterId) ? chapterId : 'none'}-none`; }
function fallbackSceneMeta(key, chapterGroup, item) {
  const photo = item?.photo || null;
  const photos = chapterGroup?.photos || (photo ? [photo] : []);
  const sorted = sortChronologically(photos);
  return {
    id: key,
    chapterId: Number.isInteger(chapterGroup?.chapter?.id) ? chapterGroup.chapter.id : null,
    index: sceneIndexFromId(key),
    start: sorted[0]?.takenAt ?? sorted[0]?.lastModified ?? chapterGroup?.chapter?.start ?? 0,
    end: sorted[sorted.length - 1]?.takenAt ?? sorted[sorted.length - 1]?.lastModified ?? chapterGroup?.chapter?.end ?? 0,
    count: sorted.length,
    place: null,
    activity: null
  };
}

function compareSceneKeys(a, b, byKey) {
  const sa = byKey.get(a)?.scene || {};
  const sb = byKey.get(b)?.scene || {};
  const ca = Number.isInteger(sa.chapterId) ? sa.chapterId : 1e12;
  const cb = Number.isInteger(sb.chapterId) ? sb.chapterId : 1e12;
  if (ca !== cb) return ca - cb;
  const ia = Number.isInteger(sa.index) ? sa.index : sceneIndexFromId(a);
  const ib = Number.isInteger(sb.index) ? sb.index : sceneIndexFromId(b);
  if (Number.isInteger(ia) && Number.isInteger(ib) && ia !== ib) return ia - ib;
  const ta = Number(sa.start);
  const tb = Number(sb.start);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
  return String(a).localeCompare(String(b), 'de');
}

function sceneIndexFromId(id) {
  const m = String(id || '').match(/^scene-\d+-(\d+)$/);
  return m ? Number(m[1]) : null;
}

function bestValue(values) {
  const counts = new Map();
  for (const value of values || []) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'de'))[0]?.[0] || null;
}

function contextItemBase(photo, { effectivePicked, solverPicked, rejectReason, overrideStatus, score }) {
  const actionKind = effectivePicked || overrideStatus === 'included'
    ? 'exclude'
    : overrideStatus === 'excluded'
      ? 'restore'
      : (rejectReason && rejectReason !== 'duplicate' && rejectReason !== 'none')
        ? 'restore'
        : null;
  return {
    effectivePicked: !!effectivePicked,
    solverPicked: !!solverPicked,
    rejectReason: rejectReason || 'none',
    overrideStatus: overrideStatus || null,
    clusterId: photo?.clusterId || null,
    repr: photo?.repr === true,
    actionKind,
    score: Number.isFinite(score) ? score : null
  };
}

function decorateContextPhoto(photo, item) {
  return {
    ...photo,
    _effectivePicked: !!item.effectivePicked,
    _solverPicked: !!item.solverPicked,
    _effectiveRejectReason: item.rejectReason || photo?._effectiveRejectReason || photo?.rejectReason || 'none',
    _overrideStatus: item.overrideStatus || null,
    _contextActionKind: item.actionKind || null,
    _contextScore: Number.isFinite(item.score) ? roundContextScore(item.score) : (photo?._contextScore ?? null)
  };
}

function contextRejectReason(photo, rejectedViewPhoto) {
  const reason = rejectedViewPhoto?._effectiveRejectReason || photo?._effectiveRejectReason || photo?.rejectReason || null;
  if (reason) return reason;
  return (photo?.repr === false && photo?.clusterId) ? 'duplicate' : 'none';
}

function nearMissInfo(photo, score, weakestPickScore, rejectedViewPhoto) {
  if (!photo || photo.status !== 'ok') return null;
  const rejectReason = contextRejectReason(photo, rejectedViewPhoto);
  if (rejectReason === 'duplicate') return null;

  const isStructuralReject = STRUCTURAL_CONTEXT_REJECTS.has(rejectReason);
  const reprNearMiss = photo.repr === true && !isStructuralReject;
  const scoreNearMiss = Number.isFinite(score) && Number.isFinite(weakestPickScore) &&
    score <= weakestPickScore + SCORE_EPS &&
    score >= weakestPickScore - NEAR_MISS_DELTA - SCORE_EPS;
  if (!reprNearMiss && !scoreNearMiss) return null;

  const reasons = [];
  if (reprNearMiss) reasons.push('Cluster-Repräsentant');
  if (scoreNearMiss) reasons.push(`Score nahe schwächstem Pick (${formatContextScore(score)} / ${formatContextScore(weakestPickScore)})`);

  return {
    photo: {
      ...photo,
      _effectiveRejectReason: rejectReason,
      _contextScore: Number.isFinite(score) ? roundContextScore(score) : null,
      _weakestPickScore: Number.isFinite(weakestPickScore) ? roundContextScore(weakestPickScore) : null,
      _nearMissReason: reasons.join(' + ')
    },
    rejectReason,
    reason: reasons.join(' + '),
    score: Number.isFinite(score) ? score : null,
    weakestPickScore: Number.isFinite(weakestPickScore) ? weakestPickScore : null
  };
}

function structuralRejectInfo(photo, score, rejectedViewPhoto) {
  if (!photo || photo.status !== 'ok') return null;
  const rejectReason = contextRejectReason(photo, rejectedViewPhoto);
  if (rejectReason === 'duplicate') return null;
  if (!STRUCTURAL_CONTEXT_REJECTS.has(rejectReason)) return null;
  if (photo.repr !== true) return null;

  const reason = `Strukturell verworfen: ${rejectLabel(rejectReason)}`;
  return {
    photo: {
      ...photo,
      _effectiveRejectReason: rejectReason,
      _contextScore: Number.isFinite(score) ? roundContextScore(score) : null,
      _structuralReason: reason
    },
    rejectReason,
    reason,
    score: Number.isFinite(score) ? score : null
  };
}

function contextScorePhoto(photo, techStrict) {
  if (!photo) {
    const persisted = persistedSolverScore(photo);
    return Number.isFinite(persisted) ? boundedContext(persisted) : null;
  }
  const wTech = CONTEXT_W_TECH[techStrict] ?? CONTEXT_W_TECH.moment;
  const sharp = boundedContext(photo?.tech?.sharpness ?? CONTEXT_NEUTRAL_TECH);
  const exposure = boundedContext(photo?.tech?.exposure ?? CONTEXT_NEUTRAL_TECH);
  const techMean = (sharp + exposure) / 2;
  const moment = boundedContext(photo?.vlm?.momentScore ?? CONTEXT_NEUTRAL_MOMENT);
  const smile = photo?.stream === 'P' ? boundedContext(photo?.faces?.smile ?? 0) : 0;
  const noBlink = photo?.faces && photo.faces.count > 0 && !photo.faces.blink ? CONTEXT_BONUS_NO_BLINK : 0;
  const raw = wTech * techMean + CONTEXT_W_MOMENT * moment + CONTEXT_W_SMILE * smile + noBlink;
  const attainable = wTech + CONTEXT_W_MOMENT + (photo?.stream === 'P' ? CONTEXT_W_SMILE : 0) + ((photo?.faces && photo.faces.count > 0) ? CONTEXT_BONUS_NO_BLINK : 0);
  const score = attainable > 0 ? boundedContext(raw / attainable) : 0;
  if (Number.isFinite(score)) return score;
  const persisted = persistedSolverScore(photo);
  return Number.isFinite(persisted) ? boundedContext(persisted) : null;
}

function persistedSolverScore(photo) {
  for (const key of ['solverScore', 'score', 'baseScore']) {
    const n = Number(photo?.[key]);
    if (Number.isFinite(n)) return n;
  }
  const nested = Number(photo?.scores?.base ?? photo?.scores?.solver ?? photo?.scores?.selection);
  return Number.isFinite(nested) ? nested : null;
}

function boundedContext(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function roundContextScore(value) { return Math.round(value * 1000) / 1000; }
function formatContextScore(value) { return Number.isFinite(value) ? roundContextScore(value).toFixed(3) : '—'; }

/**
 * Eine Wahrheit für „Solver-Ausgabe vollständig".
 * Nicht vereinfachen auf einen typeof-picked-Check: picked:false existiert seit
 * Ingest und wäre damit für unberechnete Kandidaten falsch positiv. Die leere
 * Kandidatenmenge ist ausdrücklich vollständig, damit ein 0-Kandidaten-Lauf
 * nach Reload nicht endlos erneut ausgeführt wird.
 * @param {object[]} photos
 */
export function selectDone(photos) {
  const candidates = (photos || []).filter((p) => p && p.status === 'ok' && p.repr === true);
  if (candidates.length === 0) return true;
  for (const p of candidates) {
    if (p.stageFails && p.stageFails.select) continue;
    if (p.picked === true && typeof p.reason === 'string' && p.reason.trim()) continue;
    if (p.picked === false && SOLVER_REJECTS.has(p.rejectReason)) continue;
    return false;
  }
  return true;
}

/**
 * Baut die Review-Sicht. Nach erfolgreicher Select-Stufe ist picked===true das
 * Auswahlsignal; davor bleibt die alte temporäre repr-Auswahl aktiv. Overrides
 * werden danach in der View-Schicht angewandt; Includes gelten nur für Fotos,
 * die noch Repräsentant sind, Swaps dürfen bewusst auf Nicht-Repräsentanten
 * zeigen.
 * @param {object[]} photos
 * @param {object[]} chapters
 * @param {object[]} overrides
 * @param {object=} presets
 */
export function buildReviewData(photos, chapters, overrides, presets = {}) {
  const all = sortChronologically(photos || []);
  const byId = new Map(all.map((p) => [p.id, p]));
  const solverDone = selectDone(all);
  const pickedIds = new Set();
  const solverPickedIds = new Set();
  const swappedOut = new Set();
  const swapSourceByTarget = new Map();

  for (const p of all) {
    if (p.status !== 'ok') continue;
    if (solverDone) {
      if (p.picked === true) {
        pickedIds.add(p.id);
        solverPickedIds.add(p.id);
      }
    } else if (p.repr === true || p.picked === true) {
      pickedIds.add(p.id);
      solverPickedIds.add(p.id);
    }
  }

  const overrideStatusById = buildOverrideStatusById(overrides || []);

  for (const ov of overrides || []) {
    if (!ov || !ov.photoId) continue;
    if (ov.type === 'include') {
      const p = byId.get(ov.photoId);
      if (p && p.status === 'ok' && p.repr === true) pickedIds.add(ov.photoId);
    } else if (ov.type === 'exclude') {
      pickedIds.delete(ov.photoId);
    } else if (ov.type === 'swap') {
      const target = byId.get(ov.photoId);
      if (!target || target.status !== 'ok') continue;
      let removed = null;
      if (target.clusterId) {
        for (const id of Array.from(pickedIds)) {
          const current = byId.get(id);
          if (current && current.clusterId === target.clusterId && current.id !== target.id) {
            pickedIds.delete(current.id);
            swappedOut.add(current.id);
            if (!removed) removed = current.id;
          }
        }
      }
      pickedIds.add(target.id);
      if (removed) swapSourceByTarget.set(target.id, removed);
    }
  }

  const selectionBase = all.filter((p) => pickedIds.has(p.id) && p.status === 'ok');
  const selection = applyReorderOverrides(selectionBase, overrides || []);
  const selectedSet = new Set(selection.map((p) => p.id));

  const rejected = all.filter((p) => {
    if (p.status === 'failed') return true;
    if (selectedSet.has(p.id)) return false;
    if (p.rejectReason) return true;
    if (swappedOut.has(p.id)) return true;
    return p.status === 'ok' && p.repr === false && p.clusterId;
  }).map((p) => ({ ...p, _effectiveRejectReason: effectiveRejectReason(p, swappedOut) }));

  const clusterMap = buildClusterMap(all);
  const clusterCounts = new Map([...clusterMap.entries()].map(([key, members]) => [key, members.length]));
  const selectedIds = new Set(selection.map((p) => p.id));
  const groups = groupByChapter(selection, chapters);
  const rejectedGroups = groupRejectedByReason(rejected);
  const maxPickCap = normalizeMaxPickCap(presets);
  const manual = solverDone ? selection.filter((p) => p.picked !== true).length : 0;

  return {
    all,
    selection,
    rejected,
    groups,
    clusterMap,
    clusterCounts,
    selectedIds,
    solverPickedIds,
    overrideStatusById,
    rejectedGroups,
    swapSourceByTarget,
    budgetInfo: { picked: selection.length, auto: true, maxPickCap, manual },
    temporarySelection: !solverDone
  };
}

function buildOverrideStatusById(overrides) {
  const map = new Map();
  for (const ov of overrides || []) {
    if (!ov || !ov.photoId) continue;
    if (ov.type === 'include') map.set(ov.photoId, 'included');
    else if (ov.type === 'exclude') map.set(ov.photoId, 'excluded');
  }
  return map;
}

function normalizeTargetCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(10000, Math.trunc(n))) : 40;
}

function normalizeMaxPickCap(presets) {
  if (!presets || !Object.prototype.hasOwnProperty.call(presets, 'maxPickCap')) return null;
  const n = Number(presets.maxPickCap);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.min(10000, Math.trunc(n)));
}

function applyReorderOverrides(selection, overrides) {
  const byChapter = groupSelectionForReorder(selection);
  for (const ov of overrides || []) {
    if (!ov || ov.type !== 'reorder' || !ov.photoId) continue;
    const photo = selection.find((p) => p.id === ov.photoId);
    if (!photo) continue;
    const key = chapterKey(photo.chapterId);
    const list = byChapter.get(key);
    if (!list) continue;
    const idx = list.findIndex((p) => p.id === ov.photoId);
    if (idx < 0) continue;
    const target = idx - 1;
    if (target < 0) continue;
    const tmp = list[idx];
    list[idx] = list[target];
    list[target] = tmp;
  }
  const chapterOrder = [...byChapter.keys()].sort((a, b) => {
    const na = Number(a.replace('chapter:', ''));
    const nb = Number(b.replace('chapter:', ''));
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });
  return chapterOrder.flatMap((key) => byChapter.get(key));
}

function groupSelectionForReorder(selection) {
  const out = new Map();
  for (const p of sortChronologically(selection)) {
    const key = chapterKey(p.chapterId);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(p);
  }
  return out;
}

function chapterKey(id) { return Number.isInteger(id) ? `chapter:${id}` : 'chapter:none'; }

function effectiveRejectReason(photo, swappedOut) {
  if (photo.status === 'failed') return 'failed';
  if (swappedOut.has(photo.id)) return 'duplicate';
  return photo.rejectReason || (photo.repr === false && photo.clusterId ? 'duplicate' : 'none');
}

function buildClusterMap(photos) {
  const map = new Map();
  for (const p of photos || []) {
    if (!p.clusterId) continue;
    if (!map.has(p.clusterId)) map.set(p.clusterId, []);
    map.get(p.clusterId).push(p);
  }
  for (const members of map.values()) members.sort(compareChronological);
  return map;
}

function groupRejectedByReason(rejected) {
  const map = new Map();
  for (const p of rejected || []) {
    const key = p._effectiveRejectReason || p.rejectReason || 'none';
    if (!map.has(key)) map.set(key, { key, label: rejectLabel(key), photos: [] });
    map.get(key).photos.push(p);
  }
  return [...map.values()].sort((a, b) => rejectOrder(a.key) - rejectOrder(b.key));
}

function rejectOrder(key) {
  const idx = REJECT_ORDER.indexOf(key);
  return idx < 0 ? REJECT_ORDER.length : idx;
}

export function rejectLabel(key) {
  return REJECT_LABELS[key] || key || REJECT_LABELS.none;
}

export function rejectSortIndex(key) {
  return rejectOrder(key || 'none');
}


/* =====================================================
   COVERAGE / OVERRIDE-QUOTE (E10)
   ===================================================== */
/**
 * Berechnet die Review-Coverage ausschließlich aus der abgeleiteten Auswahl.
 * personIds bleiben bis E11 bewusst ungenutzt; Gesichtsdiversität ist Fallback.
 * @param {ReturnType<typeof buildReviewData>} review
 * @param {object=} presets
 * @param {object[]=} overrides
 */
export function computeCoverage(review, presets = {}, overrides = []) {
  const groups = review?.groups || [];
  const selection = review?.selection || [];
  const target = STREAM_TARGETS[presets.focus] || STREAM_TARGETS.balanced;
  const streamCounts = new Map(STREAMS.map((s) => [s, 0]));
  const faceCounts = new Map(FACE_CLASSES.map((key) => [key, 0]));
  let beatsCoveredTotal = 0;

  for (const p of selection) {
    const stream = normalizeStream(p.stream);
    streamCounts.set(stream, (streamCounts.get(stream) || 0) + 1);
    const fc = faceClassLabel(p);
    faceCounts.set(fc, (faceCounts.get(fc) || 0) + 1);
  }

  const chapters = groups.map((group, idx) => {
    const covered = new Set();
    for (const p of group.photos || []) if (p.beat) covered.add(p.beat);
    beatsCoveredTotal += covered.size;
    return {
      id: group.chapter ? group.chapter.id : null,
      label: group.chapter ? `Kapitel ${idx + 1}` : 'Ohne Kapitel',
      count: (group.photos || []).length,
      beats: BEATS.map((beat) => ({ beat, covered: covered.has(beat) })),
      missingBeats: BEATS.filter((beat) => !covered.has(beat)),
      missingEstablishing: !covered.has('establishing')
    };
  });

  const streamTotal = selection.length || 0;
  const streams = STREAMS.map((stream) => {
    const count = streamCounts.get(stream) || 0;
    return {
      stream,
      label: streamLabel(stream),
      count,
      pct: streamTotal > 0 ? Math.round((count / streamTotal) * 100) : 0,
      targetPct: Math.round((target[stream] || 0) * 100)
    };
  });

  const faceTotal = selection.length || 0;
  const faceClasses = FACE_CLASSES.map((key) => {
    const count = faceCounts.get(key) || 0;
    return {
      key,
      label: faceClassUiLabel(key),
      count,
      pct: faceTotal > 0 ? Math.round((count / faceTotal) * 100) : 0
    };
  });

  return {
    chapters,
    streams,
    faceClasses,
    stats: {
      selectionSize: selection.length,
      chapterCount: chapters.length,
      beatsCovered: beatsCoveredTotal,
      beatsTotal: chapters.length * BEATS.length,
      overrideCount: Array.isArray(overrides) ? overrides.length : 0,
      overrideQuote: computeOverrideQuote(overrides, selection.length)
    },
    fallbackFaces: true
  };
}

export function computeOverrideQuote(overrides, selectionSize) {
  const count = Array.isArray(overrides) ? overrides.length : 0;
  const size = Number(selectionSize) || 0;
  return { count, pct: size > 0 ? Math.round((count / size) * 100) : 0 };
}

function normalizeStream(stream) { return stream === 'P' || stream === 'M' || stream === 'S' ? stream : 'S'; }
function streamLabel(stream) { return stream === 'P' ? 'P' : stream === 'M' ? 'M' : 'S'; }
function faceClassLabel(photo) {
  const count = Number(photo?.faces?.count ?? 0);
  if (count <= 0) return '0';
  return count <= 2 ? '1-2' : '3+';
}
function faceClassUiLabel(key) { return key === '0' ? '0 Gesichter' : key === '1-2' ? '1–2 Gesichter' : '3+ Gesichter'; }


/* =====================================================
   QUALITÄTSDIAGNOSE / DIAGNOSE-EXPORT
   ===================================================== */
const DIAG_REJECT_KEYS = ['budget', 'redundant', 'stream', 'duplicate'];

/**
 * Deterministische Diagnose-Aggregation. Liest ausschließlich vorhandene
 * Photo-/Review-/Pipeline-Daten; keine Inferenz, keine Bilddaten.
 * @param {{photos?:object[], chapters?:object[], overrides?:object[], presets?:object,
 *          review?:object, selectParams?:object|null, pipelineState?:object|null, backend?:string|null,
 *          browser?:string|null, platform?:string|null}} input
 */
export function buildDiagnosisReport(input = {}) {
  const photos = input.photos || [];
  const chapters = input.chapters || [];
  const overrides = Array.isArray(input.overrides) ? input.overrides : [];
  const presets = input.presets || {};
  const selectParams = input.selectParams || null;
  const review = input.review || buildReviewData(photos, chapters, overrides, presets);
  const all = review.all || sortChronologically(photos);
  const byId = new Map(all.map((p) => [p.id, p]));
  const selection = review.selection || [];
  const rejected = review.rejected || [];
  const selectedIds = new Set(selection.map((p) => p.id));
  const overrideHistory = buildOverrideHistory(overrides);

  return {
    format: 'photobook-diagnose-v2',
    aggregates: {
      overrideQuote: buildOverrideQuoteAggregate(overrides, selection, chapters, byId),
      rejectReasonDistribution: buildRejectReasonDistribution(rejected),
      reincludedRejects: countReincludedRejects(overrides, byId),
      removedAutoPicks: countRemovedAutoPicks(overrides, byId),
      chaptersWithMostOverrides: buildChapterOverrideTopList(overrides, selection, chapters, byId),
      clustersWithFrequentSwaps: buildClusterSwapTopList(overrides, byId, review.clusterCounts),
      selectParams: clonePlainObject(selectParams),
      streams: buildStreamDiagnosis(selection, presets, selectParams),
      beatCoverage: buildBeatCoverageDiagnosis(review.groups || []),
      runMetadata: buildRunMetadata({ all, chapters, presets, selectParams, pipelineState: input.pipelineState, backend: input.backend, browser: input.browser, platform: input.platform })
    },
    evidence: buildEvidenceRows(selection, rejected, selectedIds, overrideHistory)
  };
}


function clonePlainObject(value) {
  if (!value || typeof value !== 'object') return null;
  try { return JSON.parse(JSON.stringify(value)); }
  catch (_) { return { ...value }; }
}

function buildOverrideQuoteAggregate(overrides, selection, chapters, byId) {
  const overall = computeOverrideQuote(overrides, selection.length);
  const selectedByChapter = countSelectionByChapter(selection);
  const overridesByChapter = countOverridesByChapter(overrides, byId);
  const chapterKeys = new Set([...selectedByChapter.keys(), ...overridesByChapter.keys()]);
  const perChapter = [...chapterKeys].sort(compareChapterKeys).map((key) => {
    const selected = selectedByChapter.get(key) || 0;
    const overrideCount = overridesByChapter.get(key) || 0;
    return {
      chapter: chapterValueFromKey(key),
      label: diagnosisChapterLabel(key, chapters),
      overrides: overrideCount,
      selected,
      pct: selected > 0 ? Math.round((overrideCount / selected) * 100) : null
    };
  });
  return { count: overall.count, selectionSize: selection.length, pct: overall.pct, perChapter };
}

function buildRejectReasonDistribution(rejected) {
  const out = Object.fromEntries(DIAG_REJECT_KEYS.map((key) => [key, 0]));
  for (const p of rejected || []) {
    const key = diagnosisRejectReason(p);
    if (Object.prototype.hasOwnProperty.call(out, key)) out[key]++;
  }
  return out;
}

function countReincludedRejects(overrides, byId) {
  let count = 0;
  for (const ov of overrides || []) {
    if (ov?.type !== 'include') continue;
    const p = byId.get(ov.photoId);
    if (isPreviouslyRejected(p)) count++;
  }
  return count;
}

function countRemovedAutoPicks(overrides, byId) {
  let count = 0;
  for (const ov of overrides || []) {
    if (ov?.type !== 'exclude') continue;
    const p = byId.get(ov.photoId);
    if (p && p.picked === true) count++;
  }
  return count;
}

function buildChapterOverrideTopList(overrides, selection, chapters, byId) {
  const selectedByChapter = countSelectionByChapter(selection);
  const overridesByChapter = countOverridesByChapter(overrides, byId);
  return [...overridesByChapter.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || compareChapterKeys(a[0], b[0]))
    .slice(0, 10)
    .map(([key, overrideCount]) => {
      const selected = selectedByChapter.get(key) || 0;
      return {
        chapter: chapterValueFromKey(key),
        label: diagnosisChapterLabel(key, chapters),
        overrides: overrideCount,
        selected,
        pct: selected > 0 ? Math.round((overrideCount / selected) * 100) : null
      };
    });
}

function buildClusterSwapTopList(overrides, byId, clusterCounts) {
  const counts = new Map();
  for (const ov of overrides || []) {
    if (ov?.type !== 'swap') continue;
    const p = byId.get(ov.photoId);
    const clusterId = p?.clusterId || null;
    if (!clusterId) continue;
    counts.set(clusterId, (counts.get(clusterId) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, 10)
    .map(([clusterId, swaps]) => ({
      clusterId,
      swaps,
      clusterSize: clusterCounts?.get?.(clusterId) || null
    }));
}

function buildStreamDiagnosis(selection, presets, selectParams = null) {
  const focus = ['people', 'places', 'balanced'].includes(presets?.focus) ? presets.focus : 'balanced';
  const idealTarget = STREAM_TARGETS[focus] || STREAM_TARGETS.balanced;
  const effectiveTarget = hasStreamTargets(selectParams?.effStreamTarget)
    ? selectParams.effStreamTarget
    : idealTarget;
  const rareStream = selectParams?.rareStream && typeof selectParams.rareStream === 'object'
    ? selectParams.rareStream
    : null;
  const counts = Object.fromEntries(STREAMS.map((s) => [s, 0]));
  for (const p of selection || []) counts[normalizeStream(p.stream)]++;
  const total = selection.length || 0;
  return {
    focus,
    total,
    idealStreamTarget: roundStreamTarget(idealTarget),
    effectiveStreamTarget: roundStreamTarget(effectiveTarget),
    distribution: STREAMS.map((stream) => ({
      stream,
      count: counts[stream] || 0,
      pct: total > 0 ? Math.round(((counts[stream] || 0) / total) * 100) : 0,
      targetPct: Math.round((Number(effectiveTarget[stream]) || 0) * 100),
      idealTargetPct: Math.round((Number(idealTarget[stream]) || 0) * 100),
      rare: rareStream ? rareStream[stream] === true : null
    }))
  };
}

function hasStreamTargets(value) {
  return !!value && typeof value === 'object' && STREAMS.every((stream) => Number.isFinite(Number(value[stream])));
}

function roundStreamTarget(value) {
  const out = {};
  for (const stream of STREAMS) out[stream] = diagnosisNumberOrNull(value?.[stream]) ?? 0;
  return out;
}

function buildBeatCoverageDiagnosis(groups) {
  let covered = 0;
  let possible = 0;
  const byBeat = Object.fromEntries(BEATS.map((beat) => [beat, 0]));
  const perChapter = [];
  for (const [idx, group] of (groups || []).entries()) {
    const present = new Set();
    for (const p of group.photos || []) if (p.beat) present.add(p.beat);
    for (const beat of BEATS) if (present.has(beat)) byBeat[beat]++;
    covered += present.size;
    possible += BEATS.length;
    perChapter.push({
      chapter: group.chapter ? group.chapter.id : null,
      label: group.chapter ? `Kapitel ${idx + 1}` : 'Ohne Kapitel',
      covered: present.size,
      possible: BEATS.length,
      missing: BEATS.filter((beat) => !present.has(beat))
    });
  }
  return { covered, possible, pct: possible > 0 ? Math.round((covered / possible) * 100) : null, byBeat, perChapter };
}

function normalizeTauSliderPos(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

function buildRunMetadata({ all, chapters, presets, selectParams, pipelineState, backend, browser, platform }) {
  return {
    photoCount: all.length,
    okPhotoCount: all.filter((p) => p.status !== 'failed').length,
    failedPhotoCount: all.filter((p) => p.status === 'failed').length,
    chapterCount: Array.isArray(chapters) ? chapters.length : 0,
    presets: {
      selectionMode: ['chronicle', 'balanced', 'highlights'].includes(presets?.selectionMode) ? presets.selectionMode : 'balanced',
      focus: ['people', 'places', 'balanced'].includes(presets?.focus) ? presets.focus : 'balanced',
      techStrict: ['strict', 'moment'].includes(presets?.techStrict) ? presets.techStrict : 'moment',
      maxPickCap: normalizeMaxPickCap(presets),
      tauSliderPos: normalizeTauSliderPos(presets?.tauSliderPos)
    },
    tau: {
      auto: diagnosisNumberOrNull(selectParams?.tauAuto),
      effective: diagnosisNumberOrNull(selectParams?.tauEffective),
      sliderPos: diagnosisNumberOrNull(selectParams?.tauSliderPos ?? presets?.tauSliderPos),
      offset: diagnosisNumberOrNull(selectParams?.tauOffset ?? (Number(selectParams?.tauEffective) - Number(selectParams?.tauAuto)))
    },
    browser: browser || null,
    platform: platform || null,
    backend: backend || 'unknown',
    pipelineVersion: pipelineState?.pipelineVersion ?? null,
    stages: sanitizeStageStates(pipelineState?.stages || {}),
    runtimeMs: null
  };
}

function sanitizeStageStates(stages) {
  const out = {};
  for (const key of Object.keys(stages || {}).sort()) {
    const stage = stages[key] || {};
    out[key] = {
      status: stage.status || null,
      implVersion: stage.implVersion || null,
      error: stage.error || null
    };
  }
  return out;
}

function buildEvidenceRows(selection, rejected, selectedIds, overrideHistory) {
  const seen = new Set();
  const combined = [];
  for (const p of [...(selection || []), ...(rejected || [])]) {
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    combined.push(p);
  }
  return sortChronologically(combined).map((photo) => evidenceRow(photo, selectedIds.has(photo.id), overrideHistory.get(photo.id) || []));
}

function evidenceRow(photo, picked, history) {
  return {
    id: photo.id ?? null,
    filename: photo.name ?? null,
    chapter: photo.chapterId ?? null,
    scene: photo.sceneId ?? null,
    stream: photo.stream ?? null,
    beat: photo.beat ?? null,
    picked: !!picked,
    rejectReason: picked ? (photo.rejectReason ?? null) : diagnosisRejectReason(photo),
    overridden: history.length > 0,
    overrideHistory: history.map((ov) => ({ type: ov.type, ts: ov.ts, prevReason: ov.prevReason })),
    scores: {
      tech: diagnosisTechMean(photo),
      moment: diagnosisNumberOrNull(photo.vlm?.momentScore),
      smile: photo.faces ? diagnosisNumberOrNull(photo.faces.smile) : null
    },
    vlm: {
      caption: photo.vlm?.caption ?? null,
      shotType: photo.vlm?.shotType ?? null,
      activity: photo.vlm?.activity ?? null,
      mood: photo.vlm?.mood ?? null,
      placeCategory: photo.vlm?.placeCategory ?? photo.vlm?.place ?? null
    },
    clusterId: photo.clusterId ?? null
  };
}

function buildOverrideHistory(overrides) {
  const map = new Map();
  for (const ov of overrides || []) {
    if (!ov?.photoId) continue;
    if (!map.has(ov.photoId)) map.set(ov.photoId, []);
    map.get(ov.photoId).push({
      type: ov.type || null,
      ts: ov.ts ?? null,
      prevReason: ov.prevReason ?? null
    });
  }
  for (const list of map.values()) list.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || String(a.type || '').localeCompare(String(b.type || '')));
  return map;
}

function countSelectionByChapter(selection) {
  const map = new Map();
  for (const p of selection || []) {
    const key = diagnosisChapterKey(p?.chapterId);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function countOverridesByChapter(overrides, byId) {
  const map = new Map();
  for (const ov of overrides || []) {
    const p = byId.get(ov?.photoId);
    const key = diagnosisChapterKey(p?.chapterId);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function diagnosisChapterKey(id) { return Number.isInteger(id) ? `chapter:${id}` : 'chapter:null'; }
function chapterValueFromKey(key) {
  if (key === 'chapter:null') return null;
  const n = Number(String(key).replace('chapter:', ''));
  return Number.isInteger(n) ? n : null;
}

function compareChapterKeys(a, b) {
  const av = chapterValueFromKey(a);
  const bv = chapterValueFromKey(b);
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return av - bv;
}

function diagnosisChapterLabel(key, chapters) {
  const id = chapterValueFromKey(key);
  if (id === null) return 'Ohne Kapitel';
  const idx = (chapters || []).findIndex((ch) => ch && ch.id === id);
  return idx >= 0 ? `Kapitel ${idx + 1}` : `Kapitel ${id + 1}`;
}

function diagnosisRejectReason(photo) {
  if (!photo) return null;
  if (photo._effectiveRejectReason) return photo._effectiveRejectReason;
  if (photo.rejectReason) return photo.rejectReason;
  if (photo.status === 'failed') return 'failed';
  if (photo.repr === false && photo.clusterId) return 'duplicate';
  return null;
}

function isPreviouslyRejected(photo) {
  if (!photo) return false;
  if (photo.picked !== true) return true;
  return !!diagnosisRejectReason(photo);
}

function diagnosisTechMean(photo) {
  if (!photo?.tech) return null;
  const sharpness = diagnosisNumberOrNull(photo.tech.sharpness);
  const exposure = diagnosisNumberOrNull(photo.tech.exposure);
  if (sharpness == null || exposure == null) return null;
  return diagnosisRound4((sharpness + exposure) / 2);
}

function diagnosisNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? diagnosisRound4(n) : null;
}

function diagnosisRound4(value) { return Math.round(value * 10000) / 10000; }

/* =====================================================
   EINGANGSDIAGNOSE
   ===================================================== */
/**
 * @param {object[]} photos
 * @returns {{count:number, ok:number, failed:number, heicPct:number|null,
 *            gpsPct:number|null, timedPct:number|null}}
 */
export function computeDiagnostics(photos) {
  const count = photos.length;
  if (count === 0) return { count: 0, ok: 0, failed: 0, heicPct: null, gpsPct: null, timedPct: null };
  let heic = 0, gps = 0, timed = 0, ok = 0, failed = 0;
  for (const p of photos) {
    if (HEIC_RE.test(p.name || '')) heic++;
    if (p.gps) gps++;
    if (p.takenAt != null) timed++;
    if (p.status === 'failed') failed++; else ok++;
  }
  return { count, ok, failed, heicPct: pct(heic, count), gpsPct: pct(gps, count), timedPct: pct(timed, count) };
}

function pct(n, total) { return total > 0 ? Math.round((100 * n) / total) : null; }

/* =====================================================
   WEBGPU-DETECTION (einmalig, gecacht)
   ===================================================== */
let _webgpuPromise = null;

/** @returns {Promise<'gpu'|'wasm'>} */
export function detectWebGPU() {
  if (_webgpuPromise) return _webgpuPromise;
  _webgpuPromise = (async () => {
    try {
      if (!('gpu' in navigator) || !navigator.gpu) return 'wasm';
      const adapter = await navigator.gpu.requestAdapter();
      return adapter ? 'gpu' : 'wasm';
    } catch (_) {
      return 'wasm';
    }
  })();
  return _webgpuPromise;
}

/* =====================================================
   LAUFZEITSCHÄTZUNG
   ===================================================== */
// Grobe Sekunden pro Bild über die gesamte ML-Pipeline (alle Stufen zusammen).
// Kalibriert an §7: ~300 Fotos ≲ 1 h mit WebGPU → ~12 s/Bild. CPU/WASM deutlich
// langsamer. Bewusst konservative, dokumentierte Schätzwerte (keine Messung).
const SEC_PER_PHOTO_GPU = 12;
const SEC_PER_PHOTO_CPU = 40;

/**
 * @param {number} count
 * @param {'gpu'|'wasm'} backend
 * @returns {{ seconds:number, text:string, backend:'gpu'|'wasm' }}
 */
export function estimateRuntime(count, backend) {
  const perPhoto = backend === 'gpu' ? SEC_PER_PHOTO_GPU : SEC_PER_PHOTO_CPU;
  const seconds = Math.round(count * perPhoto);
  return { seconds, text: humanizeDuration(seconds), backend };
}

/** Sekunden → lesbarer Text (de). */
export function humanizeDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '—';
  const s = Math.round(totalSeconds);
  if (s < 60) return `~${s} Sek`;
  const m = Math.round(s / 60);
  if (m < 60) return `~${m} Min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `~${h} Std` : `~${h} Std ${rem} Min`;
}
