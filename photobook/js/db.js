// js/db.js
// Einziger IndexedDB-Zugriffspunkt (§10.3). Arbeitsmengen-Mitgliedschaft wird
// ausschließlich über commitWorksetMutation() geändert; Pipeline-Stufen dürfen
// bestehende Records nur noch update-only schreiben.

const DB_NAME = 'photobook';
const DB_VERSION = 2;

const STORE_PHOTOS = 'photos';
const STORE_THUMBS = 'thumbs';
const STORE_EMBEDDINGS = 'embeddings';
const STORE_FACE_EMBEDDINGS = 'faceEmbeddings';
const STORE_VLM_RAW = 'vlmRaw';
const STORE_META = 'meta';

// Reset-Scope für „Neue Arbeitsmenge“. worksetEpoch/-Revision werden danach
// bewusst frisch geschrieben, nicht nur gelöscht.
const FOLDER_META_KEYS = [
  'folderSignature', 'folderSignaturePending', 'pipelineState', 'chapters',
  'scenes', 'overrides', 'persons', 'selectParams'
];

let _dbPromise = null;

export class MembershipWriteError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'MembershipWriteError';
    this.cause = cause;
  }
}

export class WorksetRevisionMismatchError extends Error {
  constructor(message = 'Arbeitsmengen-Revision hat sich geändert.') {
    super(message);
    this.name = 'WorksetRevisionMismatchError';
  }
}

export class WorksetSupersededError extends Error {
  constructor(message = 'Arbeitsmenge wurde durch einen Reset ersetzt.') {
    super(message);
    this.name = 'WorksetSupersededError';
  }
}

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (err) { reject(err); return; }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) db.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_THUMBS)) db.createObjectStore(STORE_THUMBS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_EMBEDDINGS)) db.createObjectStore(STORE_EMBEDDINGS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_FACE_EMBEDDINGS)) db.createObjectStore(STORE_FACE_EMBEDDINGS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_VLM_RAW)) db.createObjectStore(STORE_VLM_RAW, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn('[db] open blocked — anderer Tab offen?');
  });
  return _dbPromise;
}

async function tx(stores, mode, work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let result;
    let settled = false;
    let transaction;
    try { transaction = db.transaction(stores, mode); }
    catch (err) { reject(err); return; }
    transaction.oncomplete = () => { if (!settled) { settled = true; resolve(result); } };
    transaction.onerror = () => { if (!settled) { settled = true; reject(transaction.error); } };
    transaction.onabort = () => { if (!settled) { settled = true; reject(transaction.error || new Error('IDB-Transaktion abgebrochen')); } };
    Promise.resolve().then(() => work(transaction)).then(
      (value) => { result = value; },
      (err) => {
        try { transaction.abort(); } catch (_) {}
        if (!settled) { settled = true; reject(err); }
      }
    );
  });
}

function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestMany(requests) {
  return Promise.all(requests.map(reqAsPromise));
}

function validRevision(value) {
  return Number.isInteger(value) && value >= 0;
}

function validEpoch(value) {
  return typeof value === 'string' && value.length > 0;
}

function hasPersistedStageEvidence(pipelineState) {
  return Object.values(pipelineState?.stages || {}).some((stage) =>
    ['active', 'done', 'skipped', 'error'].includes(stage?.status)
  );
}

function isCuratingPipelineState(pipelineState, signature) {
  if (!pipelineState) return true;
  if (pipelineState.worksetLocked !== false) return false;
  if ((pipelineState.folderSignature ?? null) !== (signature ?? null)) return false;
  const stages = Object.values(pipelineState.stages || {});
  return stages.length > 0 && stages.every((stage) => stage?.status === 'pending');
}

/* =====================================================
   PHOTOS — update-only für Pipeline/Stages
   ===================================================== */

export async function putPhotos(photos) {
  if (!Array.isArray(photos) || photos.length === 0) return;
  const db = await openDB();
  await new Promise((resolve, reject) => {
    let settled = false;
    const transaction = db.transaction(STORE_PHOTOS, 'readwrite');
    const store = transaction.objectStore(STORE_PHOTOS);
    const keysReq = store.getAllKeys();
    const fail = (err) => {
      try { transaction.abort(); } catch (_) {}
      if (!settled) { settled = true; reject(err); }
    };
    keysReq.onerror = () => fail(keysReq.error);
    keysReq.onsuccess = () => {
      const existing = new Set(keysReq.result || []);
      const unknown = photos.find((photo) => !existing.has(photo?.id));
      if (unknown) {
        fail(new MembershipWriteError(`Unbekannte Photo-ID in putPhotos(): ${unknown.id || '(leer)'}`));
        return;
      }
      for (const photo of photos) store.put(photo);
    };
    transaction.oncomplete = () => { if (!settled) { settled = true; resolve(); } };
    transaction.onerror = () => { if (!settled) { settled = true; reject(transaction.error); } };
    transaction.onabort = () => { if (!settled) { settled = true; reject(transaction.error || new Error('putPhotos abgebrochen')); } };
  });
}

export async function getAllPhotos() {
  return tx(STORE_PHOTOS, 'readonly', (t) => reqAsPromise(t.objectStore(STORE_PHOTOS).getAll()));
}

export async function getPhoto(id) {
  return tx(STORE_PHOTOS, 'readonly', (t) => reqAsPromise(t.objectStore(STORE_PHOTOS).get(id)));
}

/* =====================================================
   THUMBS
   ===================================================== */

export async function putThumb(id, blob) {
  await tx(STORE_THUMBS, 'readwrite', (t) => t.objectStore(STORE_THUMBS).put({ id, blob }));
}

export async function putThumbs(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  await tx(STORE_THUMBS, 'readwrite', (t) => {
    const store = t.objectStore(STORE_THUMBS);
    for (const entry of entries) store.put({ id: entry.id, blob: entry.blob });
  });
}

export async function getThumb(id) {
  const record = await tx(STORE_THUMBS, 'readonly', (t) => reqAsPromise(t.objectStore(STORE_THUMBS).get(id)));
  return record?.blob;
}

/* =====================================================
   EMBEDDINGS / VLM RAW
   ===================================================== */

export async function putEmbedding(id, vector) {
  await tx(STORE_EMBEDDINGS, 'readwrite', (t) => t.objectStore(STORE_EMBEDDINGS).put({ id, vector }));
}

export async function getEmbedding(id) {
  const record = await tx(STORE_EMBEDDINGS, 'readonly', (t) => reqAsPromise(t.objectStore(STORE_EMBEDDINGS).get(id)));
  return record?.vector;
}

export async function putFaceEmbeddings(id, vectors) {
  await tx(STORE_FACE_EMBEDDINGS, 'readwrite', (t) => t.objectStore(STORE_FACE_EMBEDDINGS).put({ id, vectors }));
}

export async function getFaceEmbeddings(id) {
  const record = await tx(STORE_FACE_EMBEDDINGS, 'readonly', (t) => reqAsPromise(t.objectStore(STORE_FACE_EMBEDDINGS).get(id)));
  return record?.vectors;
}

export async function putVlmRaw(id, data) {
  await tx(STORE_VLM_RAW, 'readwrite', (t) => t.objectStore(STORE_VLM_RAW).put({ id, ...data }));
}

export async function getVlmRaw(id) {
  const record = await tx(STORE_VLM_RAW, 'readonly', (t) => reqAsPromise(t.objectStore(STORE_VLM_RAW).get(id)));
  if (!record) return undefined;
  const { id: _id, ...data } = record;
  return data;
}

export async function getVlmRawKeys() {
  return tx(STORE_VLM_RAW, 'readonly', (t) => reqAsPromise(t.objectStore(STORE_VLM_RAW).getAllKeys()));
}

/* =====================================================
   META
   ===================================================== */

export async function putMeta(key, value) {
  await tx(STORE_META, 'readwrite', (t) => t.objectStore(STORE_META).put({ key, value }));
}

export async function getMeta(key) {
  const record = await tx(STORE_META, 'readonly', (t) => reqAsPromise(t.objectStore(STORE_META).get(key)));
  return record?.value;
}

export async function deleteMeta(key) {
  await tx(STORE_META, 'readwrite', (t) => t.objectStore(STORE_META).delete(key));
}

/** Liest IDs, Epoch und Revision in genau einer readonly-Transaktion. */
export async function getWorksetSnapshot() {
  return tx([STORE_PHOTOS, STORE_META], 'readonly', async (t) => {
    const photos = t.objectStore(STORE_PHOTOS);
    const meta = t.objectStore(STORE_META);
    const [ids, epochRec, revisionRec, signatureRec, pendingRec, pipelineRec] = await requestMany([
      photos.getAllKeys(),
      meta.get('worksetEpoch'),
      meta.get('worksetRevision'),
      meta.get('folderSignature'),
      meta.get('folderSignaturePending'),
      meta.get('pipelineState')
    ]);
    return {
      ids: Array.from(ids || []).sort(),
      worksetEpoch: epochRec?.value,
      worksetRevision: revisionRec?.value,
      folderSignature: signatureRec?.value,
      folderSignaturePending: pendingRec?.value,
      pipelineState: pipelineRec?.value
    };
  });
}

/** Atomare Erstinitialisierung / Legacy-Migration der Arbeitsmengen-Meta. */
export async function writeWorksetMeta({ epoch, revision, signature, clearPending = true }) {
  if (!validEpoch(epoch) || !validRevision(revision) || typeof signature !== 'string') {
    throw new Error('Ungültige Arbeitsmengen-Meta.');
  }
  await tx(STORE_META, 'readwrite', (t) => {
    const meta = t.objectStore(STORE_META);
    meta.put({ key: 'worksetEpoch', value: epoch });
    meta.put({ key: 'worksetRevision', value: revision });
    meta.put({ key: 'folderSignature', value: signature });
    if (clearPending) meta.delete('folderSignaturePending');
  });
}

/**
 * Einzige Membership-Schreibgrenze. Alle Datenänderungen, Artefakt-Löschungen,
 * neue Signatur, Revision und pipelineState-Löschung passieren in EINER tx.
 * Vorbereitung/Hash/Decode muss vorher geschehen.
 */
export async function commitWorksetMutation({
  expectedWorksetEpoch,
  expectedWorksetRevision,
  nextSignature,
  adds = [],
  removeIds = []
}) {
  if (!validEpoch(expectedWorksetEpoch)) throw new WorksetSupersededError('Arbeitsmengen-Epoch fehlt.');
  if (!validRevision(expectedWorksetRevision)) throw new WorksetRevisionMismatchError('Arbeitsmengen-Revision fehlt.');
  if (typeof nextSignature !== 'string') throw new Error('Neue Arbeitsmengen-Signatur fehlt.');

  const db = await openDB();
  const stores = [STORE_PHOTOS, STORE_THUMBS, STORE_EMBEDDINGS, STORE_FACE_EMBEDDINGS, STORE_VLM_RAW, STORE_META];
  return new Promise((resolve, reject) => {
    let settled = false;
    let outcome = null;
    const transaction = db.transaction(stores, 'readwrite');
    const photos = transaction.objectStore(STORE_PHOTOS);
    const thumbs = transaction.objectStore(STORE_THUMBS);
    const embeddings = transaction.objectStore(STORE_EMBEDDINGS);
    const faceEmbeddings = transaction.objectStore(STORE_FACE_EMBEDDINGS);
    const vlmRaw = transaction.objectStore(STORE_VLM_RAW);
    const meta = transaction.objectStore(STORE_META);

    const fail = (err) => {
      try { transaction.abort(); } catch (_) {}
      if (!settled) { settled = true; reject(err); }
    };

    const reads = {
      epoch: meta.get('worksetEpoch'),
      revision: meta.get('worksetRevision'),
      signature: meta.get('folderSignature'),
      pending: meta.get('folderSignaturePending'),
      pipelineState: meta.get('pipelineState')
    };
    for (const request of Object.values(reads)) request.onerror = () => fail(request.error);

    let completedReads = 0;
    const maybeCommit = () => {
      completedReads++;
      if (completedReads !== Object.keys(reads).length || settled) return;
      const currentEpoch = reads.epoch.result?.value;
      const currentRevision = reads.revision.result?.value;
      const currentSignature = reads.signature.result?.value;
      const currentPending = reads.pending.result?.value;
      const pipelineState = reads.pipelineState.result?.value;

      if (currentEpoch !== expectedWorksetEpoch || !validEpoch(currentEpoch)) {
        fail(new WorksetSupersededError());
        return;
      }
      if (currentRevision !== expectedWorksetRevision || !validRevision(currentRevision)) {
        fail(new WorksetRevisionMismatchError());
        return;
      }
      if (currentPending !== undefined) {
        fail(new MembershipWriteError('Arbeitsmenge ist wegen eines Pending-Markers nicht mutierbar.'));
        return;
      }
      if (!isCuratingPipelineState(pipelineState, currentSignature)) {
        fail(new MembershipWriteError('Arbeitsmenge ist gesperrt oder der Pipeline-State ist nicht kuratierbar.'));
        return;
      }

      const addIds = new Set();
      for (const entry of adds) {
        if (!entry?.record?.id || addIds.has(entry.record.id)) continue;
        addIds.add(entry.record.id);
        photos.put(entry.record);
        if (entry.thumbBlob) thumbs.put({ id: entry.record.id, blob: entry.thumbBlob });
      }
      const removeSet = new Set(removeIds || []);
      for (const id of removeSet) {
        photos.delete(id);
        thumbs.delete(id);
        embeddings.delete(id);
        faceEmbeddings.delete(id);
        vlmRaw.delete(id);
      }

      meta.put({ key: 'folderSignature', value: nextSignature });
      meta.put({ key: 'worksetRevision', value: currentRevision + 1 });
      meta.delete('folderSignaturePending');
      // M1: nie an die neue Signatur re-binden. Ein All-Pending-Fragment trägt
      // keinen Fortschritt und darf die Mutation nicht überleben.
      meta.delete('pipelineState');
      outcome = {
        worksetEpoch: currentEpoch,
        worksetRevision: currentRevision + 1,
        folderSignature: nextSignature,
        addedIds: Array.from(addIds),
        removedIds: Array.from(removeSet)
      };
    };
    for (const request of Object.values(reads)) request.onsuccess = maybeCommit;

    transaction.oncomplete = () => { if (!settled) { settled = true; resolve(outcome); } };
    transaction.onerror = () => { if (!settled) { settled = true; reject(transaction.error); } };
    transaction.onabort = () => { if (!settled) { settled = true; reject(transaction.error || new Error('Arbeitsmengen-Mutation abgebrochen')); } };
  });
}

/** Expliziter, weicher Arbeitsmengen-Reset (§4.5). */
export async function resetWorkset({ epoch, emptySignature }) {
  if (!validEpoch(epoch) || typeof emptySignature !== 'string') throw new Error('Ungültiger Reset-Zustand.');
  await tx(
    [STORE_PHOTOS, STORE_THUMBS, STORE_EMBEDDINGS, STORE_FACE_EMBEDDINGS, STORE_VLM_RAW, STORE_META],
    'readwrite',
    (t) => {
      t.objectStore(STORE_PHOTOS).clear();
      t.objectStore(STORE_THUMBS).clear();
      t.objectStore(STORE_EMBEDDINGS).clear();
      t.objectStore(STORE_FACE_EMBEDDINGS).clear();
      t.objectStore(STORE_VLM_RAW).clear();
      const meta = t.objectStore(STORE_META);
      for (const key of FOLDER_META_KEYS) meta.delete(key);
      meta.put({ key: 'worksetEpoch', value: epoch });
      meta.put({ key: 'worksetRevision', value: 0 });
      meta.put({ key: 'folderSignature', value: emptySignature });
    }
  );
}

/** Historische Replace-Helfer bleiben nur für Alt-Aufrufe bestehen; Phase A nutzt sie nicht. */
export async function markFolderIngestPending(signature) {
  await tx(STORE_META, 'readwrite', (t) => {
    const meta = t.objectStore(STORE_META);
    meta.put({ key: 'folderSignaturePending', value: signature });
    meta.delete('folderSignature');
  });
}

export async function commitFolderSignature(signature) {
  await tx(STORE_META, 'readwrite', (t) => {
    const meta = t.objectStore(STORE_META);
    meta.put({ key: 'folderSignature', value: signature });
    meta.delete('folderSignaturePending');
  });
}

export async function clearFolderData() {
  await tx(
    [STORE_PHOTOS, STORE_THUMBS, STORE_EMBEDDINGS, STORE_FACE_EMBEDDINGS, STORE_VLM_RAW, STORE_META],
    'readwrite',
    (t) => {
      t.objectStore(STORE_PHOTOS).clear();
      t.objectStore(STORE_THUMBS).clear();
      t.objectStore(STORE_EMBEDDINGS).clear();
      t.objectStore(STORE_FACE_EMBEDDINGS).clear();
      t.objectStore(STORE_VLM_RAW).clear();
      const meta = t.objectStore(STORE_META);
      for (const key of FOLDER_META_KEYS) meta.delete(key);
    }
  );
}

export async function clearAll() {
  await tx(
    [STORE_PHOTOS, STORE_THUMBS, STORE_EMBEDDINGS, STORE_FACE_EMBEDDINGS, STORE_VLM_RAW, STORE_META],
    'readwrite',
    (t) => {
      t.objectStore(STORE_PHOTOS).clear();
      t.objectStore(STORE_THUMBS).clear();
      t.objectStore(STORE_EMBEDDINGS).clear();
      t.objectStore(STORE_FACE_EMBEDDINGS).clear();
      t.objectStore(STORE_VLM_RAW).clear();
      t.objectStore(STORE_META).clear();
    }
  );
}

export const DB_INFO = { name: DB_NAME, version: DB_VERSION };
export const WORKSET_META_KEYS = { FOLDER_META_KEYS: [...FOLDER_META_KEYS] };
