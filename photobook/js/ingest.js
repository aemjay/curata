// js/ingest.js
// Arbeitsmengen-Orchestrierung (Kuratierung Phase A). Die photos-Store-
// Mitgliedschaft ist additiv und wechselt nur über den Add-Batch-Pfad bzw. applyWorksetMutation().
// Decode/Hashing passiert außerhalb von IDB-Write-Transaktionen.

import { EXIFR_URL, LIBHEIF_URL } from './deps.js';
import * as db from './db.js';
import { revokeAllThumbUrls, revokeThumbUrl } from './thumbs.js';
import { isPipelineActive, normalizeState, statusFromPersistedPipeline } from './pipeline/runner.js';

export const ADD_BATCH_SIZE = 200;
export const DECODE_CONCURRENCY = 6;
export const MAIN_THREAD_HEIC_CONCURRENCY = 1;
const REBASE_ATTEMPTS = 4;
const THUMB_SHORT = 512;
const JPEG_QUALITY = 0.82;

const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|gif|bmp|avif)$/i;
const HEIC_EXT = /\.(heic|heif)$/i;

/** Session-gültige Zuordnung Bild-ID → File (für Export). */
export const fileMap = new Map();
export function getOriginalFile(id) { return fileMap.get(id) || null; }
export function originalFileMapSize() { return fileMap.size; }
export function missingOriginalIds(ids) { return (ids || []).filter((id) => !fileMap.has(id)); }

/** Lokaler Epoch-/Generationsschutz: ein Reset darf alte Async-Fortsetzungen nie
 * wieder in fileMap, State oder ObjectURL-Cache schreiben lassen. */
let currentOperationGeneration = 0;
let currentWorksetEpoch = null;
let mutationQueue = Promise.resolve();
let activeWritePromise = null;

export class IngestError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'IngestError';
    this.cause = cause;
  }
}

/** Deterministische kanonische ID-Reihenfolge; nützlich für pure Tests. */
export function canonicalizeWorksetIds(ids) {
  return Array.from(new Set((ids || []).filter(Boolean))).sort();
}

/** folderSignature == worksetSignature; schützt die Mitglieder-Version, keinen Ordner. */
export async function computeWorksetSignature(ids) {
  return sha1Hex(canonicalizeWorksetIds(ids).join('|'));
}

function newWorksetEpoch() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function enqueueMutation(job) {
  const run = mutationQueue.then(job, job);
  mutationQueue = run.catch(() => {});
  return run;
}

function operationIsCurrent(operation) {
  return operation.localOperationGeneration === currentOperationGeneration
    && operation.expectedWorksetEpoch === currentWorksetEpoch;
}

function guarded(operation, effect) {
  if (!operationIsCurrent(operation)) return false;
  effect();
  return true;
}

function isValidEpoch(value) { return typeof value === 'string' && value.length > 0; }
function isValidRevision(value) { return Number.isInteger(value) && value >= 0; }

async function ensureConsistentSnapshot(snapshot) {
  const expectedSignature = await computeWorksetSignature(snapshot.ids);
  if (!isValidEpoch(snapshot.worksetEpoch) || !isValidRevision(snapshot.worksetRevision)) {
    throw new db.WorksetSupersededError('Arbeitsmengen-Meta fehlt oder ist unvollständig.');
  }
  if (snapshot.folderSignaturePending !== undefined || snapshot.folderSignature !== expectedSignature) {
    throw new db.MembershipWriteError('Arbeitsmenge ist nicht konsistent und muss zurückgesetzt werden.');
  }
  return expectedSignature;
}

function makeRecoveryPayload(message, extras = {}) {
  return {
    hydration: 'recovery',
    recoveryReason: message,
    worksetSignature: null,
    locked: true,
    photos: [], chapters: [], scenes: [], persons: [], overrides: [], presets: null,
    pipelineState: null,
    pipelineStatus: 'idle',
    ...extras
  };
}

/**
 * Liest und klassifiziert die persistierte Arbeitsmenge atomar genug für den
 * Bootstrap. Legacy-Migration ergänzt ausschließlich Epoch/Revision; Analyse,
 * Auswahl, Overrides und Signatur bleiben unangetastet.
 */
export async function hydrateWorkset() {
  let snapshot;
  try { snapshot = await db.getWorksetSnapshot(); }
  catch (error) { return makeRecoveryPayload('IndexedDB konnte nicht gelesen werden.'); }

  const ids = canonicalizeWorksetIds(snapshot.ids);
  const expectedSignature = await computeWorksetSignature(ids);
  const hasEpoch = isValidEpoch(snapshot.worksetEpoch);
  const hasRevision = isValidRevision(snapshot.worksetRevision);
  const hasSignature = typeof snapshot.folderSignature === 'string';

  if (snapshot.folderSignaturePending !== undefined) {
    return makeRecoveryPayload('Ein unvollständiger Arbeitsmengen-Vorgang wurde gefunden.');
  }

  if (ids.length === 0) {
    if (!hasEpoch && !hasRevision && !hasSignature) {
      const epoch = newWorksetEpoch();
      try { await db.writeWorksetMeta({ epoch, revision: 0, signature: expectedSignature }); }
      catch (_) { return makeRecoveryPayload('Leere Arbeitsmenge konnte nicht initialisiert werden.'); }
      snapshot = await db.getWorksetSnapshot();
    } else if (!(hasEpoch && hasRevision && hasSignature && snapshot.folderSignature === expectedSignature)) {
      return makeRecoveryPayload('Leere Arbeitsmengen-Meta ist unvollständig oder widersprüchlich.');
    }
  } else if (!hasEpoch && !hasRevision && hasSignature && snapshot.folderSignature === expectedSignature) {
    // Verlustfreie v6/E13.3-Migration.
    const epoch = newWorksetEpoch();
    try { await db.writeWorksetMeta({ epoch, revision: 0, signature: snapshot.folderSignature }); }
    catch (_) { return makeRecoveryPayload('Legacy-Arbeitsmenge konnte nicht migriert werden.'); }
    snapshot = await db.getWorksetSnapshot();
  } else if (!(hasEpoch && hasRevision && hasSignature && snapshot.folderSignature === expectedSignature)) {
    return makeRecoveryPayload('Arbeitsmengen-Signatur oder Epoch/Revision passt nicht zum Foto-Bestand.');
  }

  // Snapshot ggf. nach Initialisierung/Migration neu lesen.
  if (!isValidEpoch(snapshot.worksetEpoch) || !isValidRevision(snapshot.worksetRevision)) {
    snapshot = await db.getWorksetSnapshot();
  }
  if (!isValidEpoch(snapshot.worksetEpoch) || !isValidRevision(snapshot.worksetRevision)
      || snapshot.folderSignature !== expectedSignature) {
    return makeRecoveryPayload('Arbeitsmengen-Meta ist nach der Initialisierung nicht konsistent.');
  }

  let pipelineState = snapshot.pipelineState || null;
  let locked = false;
  let pipelineStatus = 'idle';
  if (pipelineState) {
    if (pipelineState.pipelineVersion !== 1 || (pipelineState.folderSignature ?? null) !== expectedSignature || !pipelineState.stages) {
      return makeRecoveryPayload('Persistierter Pipeline-State passt nicht zur Arbeitsmenge.');
    }
    try {
      pipelineState = normalizeState(pipelineState, expectedSignature);
      // raw active wird normalisiert; Legacy ohne Marker wird hier bewusst als
      // worksetLocked:true materialisiert, damit die Sperre reload-stabil ist.
      await db.putMeta('pipelineState', pipelineState);
      locked = pipelineState.worksetLocked === true;
      pipelineStatus = statusFromPersistedPipeline(pipelineState);
    } catch (error) {
      return makeRecoveryPayload(error?.message || 'Ungültiger Pipeline-Lock-Zustand.');
    }
  }

  try {
    const [photos, chapters, scenes, persons, overrides, presets] = await Promise.all([
      db.getAllPhotos(), db.getMeta('chapters'), db.getMeta('scenes'), db.getMeta('persons'),
      db.getMeta('overrides'), db.getMeta('presets')
    ]);
    currentWorksetEpoch = snapshot.worksetEpoch;
    return {
      hydration: 'ready',
      recoveryReason: null,
      worksetSignature: expectedSignature,
      worksetEpoch: snapshot.worksetEpoch,
      worksetRevision: snapshot.worksetRevision,
      locked,
      photos: (photos || []).map(normalizeRecord),
      chapters: Array.isArray(chapters) ? chapters : [],
      scenes: Array.isArray(scenes) ? scenes : [],
      persons: Array.isArray(persons) ? persons : [],
      overrides: Array.isArray(overrides) ? overrides : [],
      presets: presets && typeof presets === 'object' ? presets : null,
      pipelineState,
      pipelineStatus
    };
  } catch (error) {
    return makeRecoveryPayload('Arbeitsmengen-Daten konnten nicht vollständig hydratisiert werden.');
  }
}

/** Decode-Vorbereitung für genau eine neue Mitgliedschaft. */
async function prepareAdd(item, operation = null) {
  try {
    if (operation && !operationIsCurrent(operation)) throw new db.WorksetSupersededError();
    await ensureWorker();
    const result = await processOne(item, operation);
    return {
      record: normalizeRecord(result.record),
      thumbBlob: result.thumbBlob || null
    };
  } catch (error) {
    if (error instanceof db.WorksetSupersededError) throw error;
    return { record: makeFailedRecord(item, reasonFor(item, 'Bild nicht dekodierbar')), thumbBlob: null };
  }
}

/**
 * Die einzige Arbeitsmengen-Mutation. A-Core verwendet bewusst Einzeloperationen
 * (eine Datei/Add bzw. ein Remove je IDB-Transaktion). Revision rebaset; Epoch
 * bricht ab. Alle UI-/fileMap-Effekte folgen erst nach Commit und Guard.
 */
export async function applyWorksetMutation({ type, file = null, id = null, dispatch, onProgress = null }) {
  if (type !== 'add' && type !== 'remove') throw new Error('Unbekannter Arbeitsmengen-Mutationstyp.');
  // Generation/Epoch werden beim Einreihen festgehalten. Ein noch nicht
  // gestarteter Alt-Job darf nach einem Reset nicht zur neuen Menge gehören.
  const operation = {
    localOperationGeneration: currentOperationGeneration,
    expectedWorksetEpoch: currentWorksetEpoch
  };
  return enqueueMutation(async () => {
    if (!operationIsCurrent(operation) && operation.expectedWorksetEpoch !== null) {
      throw new db.WorksetSupersededError();
    }

    let initial = await db.getWorksetSnapshot();
    await ensureConsistentSnapshot(initial);
    if (!operation.expectedWorksetEpoch) operation.expectedWorksetEpoch = initial.worksetEpoch;
    if (operation.expectedWorksetEpoch !== initial.worksetEpoch || !operationIsCurrent(operation)) {
      throw new db.WorksetSupersededError();
    }

    let item = null;
    let prepared = null;
    if (type === 'add') {
      if (!file) throw new Error('Datei für Add-Mutation fehlt.');
      item = { file, id: await photoId(file), isHeic: isHeicFile(file) };
      if (initial.ids.includes(item.id)) {
        guarded(operation, () => fileMap.set(item.id, file));
        return { changed: false, reason: 'already-member', id: item.id };
      }
      prepared = await prepareAdd(item, operation);
      if (!operationIsCurrent(operation)) throw new db.WorksetSupersededError();
    } else {
      if (!id) throw new Error('ID für Remove-Mutation fehlt.');
      if (!initial.ids.includes(id)) return { changed: false, reason: 'not-member', id };
    }

    // Revision kann durch eine parallele Browser-/Tab-Mutation weitergelaufen
    // sein. Rebase berechnet ausschließlich Signatur/Plan neu; Epoch nie.
    for (let attempt = 0; attempt < 4; attempt++) {
      const snapshot = attempt === 0 ? initial : await db.getWorksetSnapshot();
      await ensureConsistentSnapshot(snapshot);
      if (snapshot.worksetEpoch !== operation.expectedWorksetEpoch || !operationIsCurrent(operation)) {
        throw new db.WorksetSupersededError();
      }

      const isMember = snapshot.ids.includes(type === 'add' ? item.id : id);
      if (type === 'add' && isMember) {
        guarded(operation, () => fileMap.set(item.id, file));
        return { changed: false, reason: 'already-member', id: item.id };
      }
      if (type === 'remove' && !isMember) return { changed: false, reason: 'not-member', id };

      const nextIds = type === 'add'
        ? [...snapshot.ids, item.id]
        : snapshot.ids.filter((existingId) => existingId !== id);
      const nextSignature = await computeWorksetSignature(nextIds);
      if (!operationIsCurrent(operation)) throw new db.WorksetSupersededError();

      try {
        activeWritePromise = db.commitWorksetMutation({
          expectedWorksetEpoch: snapshot.worksetEpoch,
          expectedWorksetRevision: snapshot.worksetRevision,
          nextSignature,
          adds: type === 'add' ? [prepared] : [],
          removeIds: type === 'remove' ? [id] : []
        });
        const committed = await activeWritePromise;
        activeWritePromise = null;
        if (!operationIsCurrent(operation)) throw new db.WorksetSupersededError();

        if (type === 'add') {
          guarded(operation, () => {
            fileMap.set(item.id, file);
            dispatch?.({ type: 'ADD_PHOTOS', payload: [prepared.record], worksetEpoch: committed.worksetEpoch, worksetRevision: committed.worksetRevision, worksetSignature: committed.folderSignature });
            onProgress?.({ type: 'add', id: item.id, changed: true });
          });
        } else {
          guarded(operation, () => {
            fileMap.delete(id);
            revokeThumbUrl(id);
            dispatch?.({ type: 'REMOVE_PHOTOS', ids: [id], worksetEpoch: committed.worksetEpoch, worksetRevision: committed.worksetRevision, worksetSignature: committed.folderSignature });
            onProgress?.({ type: 'remove', id, changed: true });
          });
        }
        guarded(operation, () => {
          try { navigator.storage?.persist?.().catch(() => {}); } catch (_) {}
        });
        return { changed: true, ...committed };
      } catch (error) {
        activeWritePromise = null;
        if (error instanceof db.WorksetRevisionMismatchError) continue;
        throw error;
      }
    }
    throw new db.WorksetRevisionMismatchError('Arbeitsmenge konnte nach mehreren Rebase-Versuchen nicht geändert werden.');
  });
}

/** Additiver Batch-Wrapper; Doppelte IDs im Input: erster Eintrag gewinnt. */
export async function addFilesToWorkset(fileList, {
  dispatch,
  onProgress,
  batchSize = ADD_BATCH_SIZE,
  decodeConcurrency = DECODE_CONCURRENCY
} = {}) {
  const operation = {
    localOperationGeneration: currentOperationGeneration,
    expectedWorksetEpoch: currentWorksetEpoch
  };

  return enqueueMutation(async () => {
    if (!operationIsCurrent(operation) && operation.expectedWorksetEpoch !== null) {
      throw new db.WorksetSupersededError();
    }

    const items = await collectUniqueAddItems(fileList);
    const total = items.length;
    let done = 0;
    let changed = 0;
    let failed = 0;
    const safeBatchSize = Math.max(1, Number.isFinite(batchSize) ? Math.trunc(batchSize) : ADD_BATCH_SIZE);
    const safeDecodeConcurrency = Math.max(1, Number.isFinite(decodeConcurrency) ? Math.trunc(decodeConcurrency) : DECODE_CONCURRENCY);

    const noteProgress = (meta = {}) => {
      done++;
      onProgress?.(done, total, { resumed: false, ...meta });
    };

    try {
      for (let offset = 0; offset < items.length; offset += safeBatchSize) {
        if (!operationIsCurrent(operation) && operation.expectedWorksetEpoch !== null) {
          throw new db.WorksetSupersededError();
        }

        const batch = items.slice(offset, offset + safeBatchSize);
        const snapshot = await readMutationSnapshot(operation);
        const existing = new Set(snapshot.ids);
        const candidates = [];

        for (const item of batch) {
          if (existing.has(item.id)) {
            guarded(operation, () => fileMap.set(item.id, item.file));
            noteProgress({ changed: false, skipped: true, reason: 'already-member' });
          } else {
            candidates.push(item);
          }
        }

        if (candidates.length === 0) continue;

        const preparedEntries = await decodePreparedBatch(candidates, operation, safeDecodeConcurrency, (entry) => {
          if (entry.prepared.record.status === 'failed') failed++;
          noteProgress({ changed: true, id: entry.item.id, failed: entry.prepared.record.status === 'failed' });
        });
        if (!operationIsCurrent(operation)) throw new db.WorksetSupersededError();

        const committed = await commitPreparedAddBatch(preparedEntries, snapshot, operation, dispatch);
        changed += committed.added;
      }
    } finally {
      teardownWorker();
    }

    return { count: total, changed, failed, resumed: false };
  });
}

async function collectUniqueAddItems(fileList) {
  const seen = new Set();
  const items = [];
  for (const file of Array.from(fileList || []).filter(isImageLike)) {
    const id = await photoId(file);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ file, id, isHeic: isHeicFile(file) });
  }
  return items;
}

async function readMutationSnapshot(operation) {
  const snapshot = await db.getWorksetSnapshot();
  await ensureConsistentSnapshot(snapshot);
  if (!operation.expectedWorksetEpoch) operation.expectedWorksetEpoch = snapshot.worksetEpoch;
  if (snapshot.worksetEpoch !== operation.expectedWorksetEpoch || !operationIsCurrent(operation)) {
    throw new db.WorksetSupersededError();
  }
  return snapshot;
}

async function decodePreparedBatch(items, operation, concurrency, onPrepared) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runLane() {
    while (nextIndex < items.length) {
      if (!operationIsCurrent(operation)) throw new db.WorksetSupersededError();
      const index = nextIndex++;
      const item = items[index];
      const prepared = await prepareAdd(item, operation);
      if (!operationIsCurrent(operation)) throw new db.WorksetSupersededError();
      const entry = { item, prepared };
      results[index] = entry;
      onPrepared?.(entry);
    }
  }

  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, () => runLane());
  await Promise.all(lanes);
  return results.filter(Boolean);
}

async function commitPreparedAddBatch(preparedEntries, initialSnapshot, operation, dispatch) {
  let lastSeenCommitted = 0;
  for (let attempt = 0; attempt < REBASE_ATTEMPTS; attempt++) {
    const snapshot = attempt === 0 ? initialSnapshot : await readMutationSnapshot(operation);
    if (snapshot.worksetEpoch !== operation.expectedWorksetEpoch || !operationIsCurrent(operation)) {
      throw new db.WorksetSupersededError();
    }

    const existing = new Set(snapshot.ids);
    const adds = [];
    const filesForAddedIds = new Map();
    for (const entry of preparedEntries) {
      const id = entry?.prepared?.record?.id;
      if (!id) continue;
      if (existing.has(id)) {
        guarded(operation, () => fileMap.set(id, entry.item.file));
        continue;
      }
      adds.push(entry.prepared);
      filesForAddedIds.set(id, entry.item.file);
    }

    if (adds.length === 0) return { added: 0, committed: null };

    const nextIds = [...snapshot.ids, ...adds.map((entry) => entry.record.id)];
    const nextSignature = await computeWorksetSignature(nextIds);
    if (!operationIsCurrent(operation)) throw new db.WorksetSupersededError();

    try {
      activeWritePromise = db.commitWorksetMutation({
        expectedWorksetEpoch: snapshot.worksetEpoch,
        expectedWorksetRevision: snapshot.worksetRevision,
        nextSignature,
        adds,
        removeIds: []
      });
      const committed = await activeWritePromise;
      activeWritePromise = null;
      if (!operationIsCurrent(operation)) throw new db.WorksetSupersededError();

      const committedIds = new Set(committed?.addedIds || adds.map((entry) => entry.record.id));
      const committedRecords = adds
        .map((entry) => entry.record)
        .filter((record) => committedIds.has(record.id));
      lastSeenCommitted = committedRecords.length;

      guarded(operation, () => {
        for (const record of committedRecords) {
          const file = filesForAddedIds.get(record.id);
          if (file) fileMap.set(record.id, file);
        }
        dispatch?.({
          type: 'ADD_PHOTOS',
          payload: committedRecords,
          worksetEpoch: committed.worksetEpoch,
          worksetRevision: committed.worksetRevision,
          worksetSignature: committed.folderSignature
        });
        try { navigator.storage?.persist?.().catch(() => {}); } catch (_) {}
      });
      return { added: committedRecords.length, committed };
    } catch (error) {
      activeWritePromise = null;
      if (error instanceof db.WorksetRevisionMismatchError) continue;
      throw error;
    }
  }
  throw new db.WorksetRevisionMismatchError(
    `Arbeitsmenge konnte nach mehreren Rebase-Versuchen nicht geändert werden (${lastSeenCommitted} vorbereitete Adds).`
  );
}

/** Rückwärtskompatibler Exportname; Semantik ist ab Phase A additiv. */
export const runIngest = addFilesToWorkset;

export async function removePhotoFromWorkset(id, { dispatch } = {}) {
  return applyWorksetMutation({ type: 'remove', id, dispatch });
}

async function waitForActiveWrite() {
  const active = activeWritePromise;
  if (active) {
    try { await active; } catch (_) {}
  }
}

/** Reset-Barriere: alte Vorbereitung darf nach Reset keine lokalen Folgen haben. */
export async function startNewWorkset({ dispatch } = {}) {
  if (isPipelineActive()) throw new db.MembershipWriteError('Neue Arbeitsmenge ist während eines laufenden Runners gesperrt.');
  currentOperationGeneration++;
  teardownWorker();
  await waitForActiveWrite();
  const epoch = newWorksetEpoch();
  const emptySignature = await computeWorksetSignature([]);
  await db.resetWorkset({ epoch, emptySignature });
  currentWorksetEpoch = epoch;
  fileMap.clear();
  revokeAllThumbUrls();
  dispatch?.({ type: 'NEW_WORKSET', payload: { worksetEpoch: epoch, worksetSignature: emptySignature } });
  return { epoch, emptySignature };
}

/** Privacy-Clear ist hart: inklusive presets und sämtlicher Meta/Stores. */
export async function clearAllWorkset({ dispatch } = {}) {
  if (isPipelineActive()) throw new db.MembershipWriteError('Privacy-Clear ist während eines laufenden Runners gesperrt.');
  currentOperationGeneration++;
  teardownWorker();
  await waitForActiveWrite();
  await db.clearAll();
  currentWorksetEpoch = null;
  fileMap.clear();
  revokeAllThumbUrls();
  dispatch?.({ type: 'PRIVACY_CLEAR' });
}

/** Re-Attach betrifft nur session-gültige File-Handles, nie Membership. */
export async function attachOriginalFiles(fileList, expectedIds = []) {
  const expected = new Set(expectedIds || []);
  const attached = [];
  for (const file of Array.from(fileList || []).filter(isImageLike)) {
    const id = await photoId(file);
    if (expected.size === 0 || expected.has(id)) {
      fileMap.set(id, file);
      attached.push(id);
    }
  }
  return { scanned: attached.length, attached, missing: missingOriginalIds([...expected]) };
}

/** Worker-Singleton + Main-Thread-libheif-Cache. */
let _worker = null;
let _workerReady = null;
let _workerInitCancel = null;
let _heicInWorker = true;
let _mainLibheif = null;
let _mainLibheifBroken = false;
const _workerPending = new Set();
const runMainThreadHeic = createConcurrencyLimiter(MAIN_THREAD_HEIC_CONCURRENCY);

/* =====================================================
   EINZELBILD-VERARBEITUNG
   ===================================================== */
async function processOne(item, operation = null) {
  const { id, isHeic } = item;
  if (isHeic && !_heicInWorker) return heicMainThread(item, operation);
  const wr = await sendToWorker({ type: 'decode', id, file: item.file, isHeic });
  if (wr.ok) {
    return {
      record: buildRecord(item, {
        width: wr.width, height: wr.height, takenAt: wr.takenAt, gps: wr.gps,
        exifOptics: wr.exifOptics, exifTime: wr.exifTime, status: 'ok'
      }),
      thumbBlob: wr.thumbBlob
    };
  }
  if (wr.isHeic && wr.heicUnavailable) { _heicInWorker = false; return heicMainThread(item, operation); }
  if (wr.isHeic && wr.decodeFailed) return { record: makeFailedRecord(item, 'HEIC nicht dekodierbar'), thumbBlob: null };
  return { record: makeFailedRecord(item, 'Bild nicht dekodierbar'), thumbBlob: null };
}

async function heicMainThread(item, operation = null) {
  return runMainThreadHeic(() => {
    if (operation && !operationIsCurrent(operation)) throw new db.WorksetSupersededError();
    return heicMainThreadUnbounded(item);
  });
}

async function heicMainThreadUnbounded(item) {
  if (_mainLibheifBroken) return { record: makeFailedRecord(item, 'HEIC nicht dekodierbar'), thumbBlob: null };
  try {
    const { thumbBlob, width, height } = await decodeHeicMain(item.file);
    const exif = await readExifMain(item.file);
    return {
      record: buildRecord(item, {
        width, height, takenAt: exif.takenAt, gps: exif.gps,
        exifOptics: exif.exifOptics, exifTime: exif.exifTime, status: 'ok'
      }),
      thumbBlob
    };
  } catch (error) {
    if (error?.__importFailed) _mainLibheifBroken = true;
    return { record: makeFailedRecord(item, 'HEIC nicht dekodierbar'), thumbBlob: null };
  }
}

function createConcurrencyLimiter(max) {
  const limit = Math.max(1, Math.trunc(max || 1));
  let active = 0;
  const queue = [];

  const pump = () => {
    if (active >= limit || queue.length === 0) return;
    const job = queue.shift();
    active++;
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        active--;
        pump();
      });
  };

  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}

/* =====================================================
   WORKER-VERWALTUNG (gepufferte Outstanding Requests)
   ===================================================== */
async function ensureWorker() {
  if (_worker) return _workerReady;
  _worker = new Worker(new URL('./workers/ingest.worker.js', import.meta.url), { type: 'module' });
  _workerReady = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => { if (!settled) { settled = true; cleanup(); fn(arg); } };
    const onReady = (event) => { if (event.data?.type === 'ready') finish(resolve); };
    const onError = (error) => finish(reject, new Error('Worker-Init fehlgeschlagen: ' + (error?.message || error)));
    const cleanup = () => {
      _worker?.removeEventListener('message', onReady);
      _worker?.removeEventListener('error', onError);
      clearTimeout(timer);
      _workerInitCancel = null;
    };
    _workerInitCancel = () => finish(reject, new Error('Worker beendet'));
    const timer = setTimeout(() => finish(reject, new Error('Worker-Init Timeout')), 15000);
    _worker.addEventListener('message', onReady);
    _worker.addEventListener('error', onError);
    _worker.postMessage({ type: 'init', exifrUrl: EXIFR_URL, libheifUrl: LIBHEIF_URL });
  });
  _workerReady.catch(() => teardownWorker());
  return _workerReady;
}

function sendToWorker(message) {
  return new Promise((resolve) => {
    const entry = { resolve, cleanup: null, isHeic: !!message.isHeic };
    const cleanup = () => {
      _worker?.removeEventListener('message', onMessage);
      _worker?.removeEventListener('error', onError);
      _workerPending.delete(entry);
    };
    const finish = (value) => { cleanup(); resolve(value); };
    const onMessage = (event) => {
      const data = event.data;
      if (data?.type === 'result' && data.id === message.id) finish(data);
    };
    const onError = (error) => finish({
      ok: false,
      isHeic: !!message.isHeic,
      decodeFailed: !message.isHeic,
      error: String(error?.message || error)
    });
    entry.cleanup = cleanup;
    _workerPending.add(entry);
    _worker.addEventListener('message', onMessage);
    _worker.addEventListener('error', onError);
    _worker.postMessage(message);
  });
}

function teardownWorker() {
  // Ein Reset beendet auch Decode-Wartezeiten. Das dabei entstehende Ergebnis
  // wird vom Operation-Guard verworfen und darf den Reset nicht blockieren.
  _workerInitCancel?.();
  for (const entry of Array.from(_workerPending)) {
    entry.cleanup?.();
    entry.resolve({ ok: false, isHeic: entry.isHeic, decodeFailed: !entry.isHeic, error: 'Worker beendet' });
  }
  _workerPending.clear();
  if (_worker) {
    try { _worker.terminate(); } catch (_) {}
    _worker = null;
    _workerReady = null;
  }
}

/* =====================================================
   MAIN-THREAD HEIC-DECODE (spiegelt Worker-Logik)
   ===================================================== */
async function getMainLibheif() {
  if (_mainLibheif) return _mainLibheif;
  let mod;
  try {
    mod = await import(LIBHEIF_URL);
  } catch (err) {
    const e = new Error('libheif (Main) Import fehlgeschlagen: ' + (err && err.message || err));
    e.__importFailed = true;
    throw e;
  }
  let lib = mod.default ?? mod;
  try {
    if (typeof lib === 'function') lib = await lib();
    if (lib && typeof lib.then === 'function') lib = await lib;
    if (lib && !lib.HeifDecoder && lib.default && lib.default.HeifDecoder) lib = lib.default;
  } catch (err) {
    const e = new Error('libheif (Main) Init fehlgeschlagen: ' + (err && err.message || err));
    e.__importFailed = true;
    throw e;
  }
  if (!lib || typeof lib.HeifDecoder !== 'function') {
    const e = new Error('libheif (Main): HeifDecoder nicht gefunden');
    e.__importFailed = true;
    throw e;
  }
  _mainLibheif = lib;
  return lib;
}

async function decodeHeicMain(file) {
  const lib = await getMainLibheif();
  const buf = new Uint8Array(await file.arrayBuffer());
  const decoder = new lib.HeifDecoder();
  const images = decoder.decode(buf);
  if (!images || !images.length) throw new Error('HEIC: keine Bilddaten');
  const image = images[0];
  const width = image.get_width();
  const height = image.get_height();
  if (!width || !height) throw new Error('HEIC: ungültige Maße');

  const imageData = new ImageData(width, height);
  await new Promise((resolve, reject) => {
    try {
      image.display(imageData, (out) => out ? resolve() : reject(new Error('HEIC: display fehlgeschlagen')));
    } catch (err) { reject(err); }
  });
  try { if (typeof image.free === 'function') image.free(); } catch (_) {}
  try { if (typeof decoder.free === 'function') decoder.free(); } catch (_) {}

  const { w, h } = targetSize(width, height, THUMB_SHORT);
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const bmp = await createImageBitmap(imageData);
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const thumbBlob = await canvasToJpegBlob(canvas);
  return { thumbBlob, width, height };
}

/* =====================================================
   EXIF auf dem Main-Thread (für Ebene-2-Pfad)
   ===================================================== */
const EXIF_PICK = [
  'DateTimeOriginal', 'CreateDate', 'ModifyDate', 'OffsetTimeOriginal',
  'GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef',
  'GPSAltitude', 'GPSAltitudeRef', 'GPSImgDirection', 'GPSImgDirectionRef',
  'GPSDateStamp', 'GPSTimeStamp',
  'FocalLength', 'FocalLengthIn35mmFormat', 'FocalLengthIn35mmFilm',
  'DigitalZoomRatio', 'LensModel', 'Make', 'Model',
  'FNumber', 'ISO', 'ExposureTime'
];

let _mainExifr = null;
async function getMainExifr() {
  if (_mainExifr) return _mainExifr;
  try {
    const m = await import(EXIFR_URL);
    _mainExifr = m.default ?? m;
  } catch (err) {
    console.warn('[ingest] exifr (Main) Import fehlgeschlagen:', err);
    _mainExifr = null;
  }
  return _mainExifr;
}

async function readExifMain(file) {
  const result = {
    takenAt: null,
    gps: null,
    exifOptics: emptyExifOptics(),
    exifTime: emptyExifTime()
  };
  const exifr = await getMainExifr();
  if (exifr) {
    try {
      // G0.5: Datum, GPS, Optik und Zeit-Rohfelder werden in EINEM Parse-Lauf gelesen.
      const parsed = await exifr.parse(file, { pick: EXIF_PICK, reviveValues: false });
      applyParsedExif(result, parsed);
    } catch (_) {}
  }
  if (result.takenAt == null) result.takenAt = file.lastModified;
  return result;
}

function applyParsedExif(result, parsed) {
  if (!parsed || typeof parsed !== 'object') return;

  result.exifTime = {
    dateTimeOriginalRaw: stringOrNull(parsed.DateTimeOriginal),
    offsetTimeOriginal: stringOrNull(parsed.OffsetTimeOriginal),
    gpsDateStamp: stringOrNull(parsed.GPSDateStamp),
    gpsTimeStamp: gpsTimeStampString(parsed.GPSTimeStamp)
  };

  result.exifOptics = {
    focalLength: numberOrNull(parsed.FocalLength),
    focalLength35mm: numberOrNull(parsed.FocalLengthIn35mmFormat ?? parsed.FocalLengthIn35mmFilm),
    digitalZoomRatio: numberOrNull(parsed.DigitalZoomRatio),
    lensModel: stringOrNull(parsed.LensModel),
    make: stringOrNull(parsed.Make),
    model: stringOrNull(parsed.Model),
    fNumber: numberOrNull(parsed.FNumber),
    iso: numberOrNull(parsed.ISO),
    exposureTime: numberOrNull(parsed.ExposureTime)
  };

  const d = parseExifDateMs(parsed.DateTimeOriginal)
    ?? parseExifDateMs(parsed.CreateDate)
    ?? parseExifDateMs(parsed.ModifyDate);
  if (d != null) result.takenAt = d;

  const lat = gpsCoordToDecimal(parsed.latitude ?? parsed.GPSLatitude, parsed.GPSLatitudeRef);
  const lon = gpsCoordToDecimal(parsed.longitude ?? parsed.GPSLongitude, parsed.GPSLongitudeRef);
  if (lat != null && lon != null) {
    result.gps = {
      lat,
      lon,
      alt: gpsAltitude(parsed.GPSAltitude, parsed.GPSAltitudeRef),
      dir: numberOrNull(parsed.GPSImgDirection)
    };
  }
}

function emptyExifOptics() {
  return {
    focalLength: null,
    focalLength35mm: null,
    digitalZoomRatio: null,
    lensModel: null,
    make: null,
    model: null,
    fNumber: null,
    iso: null,
    exposureTime: null
  };
}

function emptyExifTime() {
  return {
    dateTimeOriginalRaw: null,
    offsetTimeOriginal: null,
    gpsDateStamp: null,
    gpsTimeStamp: null
  };
}

function parseExifDateMs(value) {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  const raw = stringOrNull(value);
  if (!raw) return null;
  const m = raw.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const t = new Date(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6])
    ).getTime();
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function gpsCoordToDecimal(value, ref) {
  if (value == null) return null;
  let dec;
  if (typeof value === 'number') dec = value;
  else if (Array.isArray(value)) dec = dmsToDecimal(value);
  else dec = dmsToDecimal(String(value).match(/-?\d+(?:[.,]\d+)?/g) || []);
  if (!Number.isFinite(dec)) return null;
  const r = String(ref || '').trim().toUpperCase();
  if (r === 'S' || r === 'W') return -Math.abs(dec);
  return dec < 0 ? dec : Math.abs(dec);
}

function dmsToDecimal(parts) {
  const nums = parts.map(numberOrNull).filter((v) => v != null);
  if (nums.length === 0) return null;
  const deg = nums[0];
  const min = nums[1] ?? 0;
  const sec = nums[2] ?? 0;
  return Math.abs(deg) + (min / 60) + (sec / 3600);
}

function gpsAltitude(value, ref) {
  const alt = numberOrNull(value);
  if (alt == null) return null;
  const r = String(ref ?? '').trim().toLowerCase();
  const below = ref === 1 || r === '1' || r.includes('below') || r.includes('below sea');
  return below ? -Math.abs(alt) : alt;
}

function gpsTimeStampString(value) {
  if (Array.isArray(value)) {
    const nums = value.map(numberOrNull);
    if (nums.every((v) => v != null)) {
      const [h = 0, m = 0, s = 0] = nums;
      return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
    }
  }
  return stringOrNull(value);
}

function pad2(value) {
  const n = Math.trunc(Number(value));
  return String(Number.isFinite(n) ? n : 0).padStart(2, '0');
}

function numberOrNull(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(value)) {
    if (value.length === 2) {
      const a = numberOrNull(value[0]);
      const b = numberOrNull(value[1]);
      if (a != null && b) return a / b;
    }
    if (value.length === 1) return numberOrNull(value[0]);
    return null;
  }
  if (typeof value === 'object') {
    const n = Number(value.valueOf?.());
    if (Number.isFinite(n)) return n;
    const num = numberOrNull(value.numerator ?? value.num);
    const den = numberOrNull(value.denominator ?? value.den);
    if (num != null && den) return num / den;
  }
  return null;
}

function stringOrNull(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? value.toISOString() : null;
  }
  const s = String(value).trim();
  return s ? s : null;
}

/* =====================================================
   RECORD-BAU (§10.2 — vollständige Form, leere Felder initialisiert)
   ===================================================== */
function buildRecord(item, fields) {
  const f = item.file;
  return {
    id: item.id,
    name: f.name,
    size: f.size,
    lastModified: f.lastModified,
    width: fields.width ?? null,
    height: fields.height ?? null,
    takenAt: fields.takenAt ?? f.lastModified,
    gps: fields.gps ?? null,
    exifOptics: fields.exifOptics ?? emptyExifOptics(),
    exifTime: fields.exifTime ?? emptyExifTime(),
    status: fields.status,
    failReason: fields.failReason ?? null,
    // Nachfolgende Etappen befüllen diese Felder (Form hier konsistent angelegt):
    tech: null,
    chapterId: null,
    sceneId: null,
    faces: null,
    stream: null,
    clusterId: null,
    repr: false,
    vlm: null,
    personIds: [],
    beat: null,
    picked: false,
    reason: null,
    rejectReason: null,
    stageFails: {}
  };
}

function normalizeRecord(record) {
  return {
    ...record,
    stageFails: record && record.stageFails && typeof record.stageFails === 'object' ? record.stageFails : {},
    exifOptics: record && record.exifOptics !== undefined ? record.exifOptics : null,
    exifTime: record && record.exifTime !== undefined ? record.exifTime : null,
    personIds: Array.isArray(record && record.personIds) ? record.personIds : [],
    repr: !!(record && record.repr),
    picked: !!(record && record.picked)
  };
}

function makeFailedRecord(item, reason) {
  // status 'failed' + lesbarer Grund in failReason (§10.2). rejectReason bleibt
  // der Selektions-Semantik vorbehalten und wird hier NICHT belegt.
  return buildRecord(item, {
    width: null, height: null, takenAt: item.file.lastModified,
    gps: null, status: 'failed', failReason: reason
  });
}

function reasonFor(item, fallback) {
  return item.isHeic ? 'HEIC nicht dekodierbar' : fallback;
}

/* =====================================================
   HILFEN
   ===================================================== */
function isImageLike(file) {
  if (!file || typeof file.name !== 'string') return false;
  if (file.type && file.type.startsWith('image/')) return true;
  return IMAGE_EXT.test(file.name);
}

function isHeicFile(file) {
  if (file.type && /image\/(heic|heif)/i.test(file.type)) return true;
  return HEIC_EXT.test(file.name || '');
}

/** SHA-1 aus `${name}|${size}|${lastModified}` → hex (§10.2). */
async function photoId(file) {
  return sha1Hex(`${file.name}|${file.size}|${file.lastModified}`);
}

async function sha1Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function targetSize(w, h, targetShort) {
  const short = Math.min(w, h);
  if (short <= targetShort) return { w, h };
  const scale = targetShort / short;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function canvasToJpegBlob(canvas) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
}
