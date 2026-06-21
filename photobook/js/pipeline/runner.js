// js/pipeline/runner.js
// Stufen-Runner (§10.4) plus Phase-A-Arbeitsmengen-Lifecycle. Die Pipeline-
// Logik/Registry bleibt unverändert; ergänzt werden ausschließlich Start-Lock,
// persistierter worksetLocked-Marker und die Fehler-/Token-Semantik (§4.9).

import { STAGES, getStage } from './stages.js';
import * as db from '../db.js';

const PIPELINE_STATE_KEY = 'pipelineState';
const PIPELINE_VERSION = 1;

let _controller = null;
let _active = false;
let _nextPipelineStartToken = 0;

export class StageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StageError';
    this.cause = cause;
  }
}

export function isPipelineActive() {
  return _active;
}

export function hasPersistedStageEvidence(saved) {
  return Object.values(saved?.stages || {}).some((stage) =>
    ['active', 'done', 'skipped', 'error'].includes(stage?.status)
  );
}

/**
 * Legacy ohne Feld ist konservativ LOCKED. Phase-A false+Nicht-Pending ist
 * unmöglich und damit Korruption; der Runner wirft laut, Hydration nutzt diese
 * Funktion und übersetzt den Fehler in Recovery.
 */
export function derivePersistedWorksetLock(saved) {
  if (!saved) return false;
  if (!Object.prototype.hasOwnProperty.call(saved, 'worksetLocked')) return true;
  if (typeof saved.worksetLocked !== 'boolean') throw new Error('Ungültiger worksetLocked-Marker');
  if (!saved.worksetLocked && hasPersistedStageEvidence(saved)) {
    throw new Error('Widersprüchlicher Pipeline-Lock-Zustand');
  }
  return saved.worksetLocked;
}

async function currentSignature() {
  return (await db.getMeta('folderSignature')) ?? null;
}

async function loadValidState(folderSignature) {
  const saved = await db.getMeta(PIPELINE_STATE_KEY);
  if (!saved || saved.pipelineVersion !== PIPELINE_VERSION) return null;
  if ((saved.folderSignature ?? null) !== (folderSignature ?? null)) return null;
  if (!saved.stages || typeof saved.stages !== 'object') return null;
  return saved;
}

function emptyStageState(stage) {
  return { status: 'pending', implVersion: stage.implVersion, error: null };
}

export function normalizeState(saved, folderSignature) {
  const state = {
    folderSignature: folderSignature ?? null,
    pipelineVersion: PIPELINE_VERSION,
    // Die Lock-Quelle ist nicht der Stage-Status. Der Marker überlebt die
    // Pause-Serialisierung active -> pending und ist monoton bis Reset/Clear.
    worksetLocked: derivePersistedWorksetLock(saved),
    stages: {}
  };
  for (const stage of STAGES) {
    const previous = saved?.stages?.[stage.key];
    if (previous && ['pending', 'active', 'done', 'skipped', 'error'].includes(previous.status)) {
      state.stages[stage.key] = {
        status: previous.status === 'active' ? 'pending' : previous.status,
        implVersion: previous.implVersion || null,
        error: previous.error || null
      };
    } else {
      state.stages[stage.key] = emptyStageState(stage);
    }
  }
  return state;
}

export function statusFromPersistedPipeline(pipelineState) {
  const stages = Object.values(pipelineState?.stages || {});
  if (stages.length > 0 && stages.every((stage) => ['done', 'skipped'].includes(stage?.status))) return 'done';
  if (stages.some((stage) => stage?.status === 'error')) return 'error';
  return pipelineState?.worksetLocked ? 'paused' : 'idle';
}

async function persistState(pipelineState) {
  await db.putMeta(PIPELINE_STATE_KEY, pipelineState);
}

function dispatchState(dispatch, pipelineState, status, activeKey = null, error = null) {
  const stageIndex = activeKey ? STAGES.findIndex((stage) => stage.key === activeKey) : -1;
  dispatch?.({
    type: 'PIPELINE_STATE',
    payload: {
      status,
      stage: stageIndex,
      activeKey,
      stages: cloneStages(pipelineState.stages),
      error
    }
  });
}

function cloneStages(stages) {
  const clone = {};
  for (const [key, value] of Object.entries(stages || {})) clone[key] = { ...value };
  return clone;
}

function stageMessage(error) {
  return error?.message ? String(error.message) : String(error || 'Unbekannter Fehler');
}

export async function startPipeline({ dispatch }) {
  if (_active) return;
  await runPipeline({ dispatch });
}

export async function resumePipeline({ dispatch }) {
  if (_active) return;
  await runPipeline({ dispatch });
}

export function pausePipeline() {
  if (_controller) _controller.abort();
}

async function runPipeline({ dispatch }) {
  const startToken = ++_nextPipelineStartToken;
  let persistedWorksetLock = false;
  let folderSignature = null;
  let worksetEpoch = null;
  let pipelineState = null;
  let photos = null;

  // ABSICHTLICH die erste Anweisung: kein await/DB-Zugriff davor (§4.9).
  dispatch?.({ type: 'WORKSET_PIPELINE_STARTING', startToken });
  _active = true;
  _controller = new AbortController();
  const signal = _controller.signal;

  const establishLock = () => {
    if (persistedWorksetLock) return;
    persistedWorksetLock = true;
    dispatch?.({
      type: 'WORKSET_PIPELINE_LOCK_ESTABLISHED',
      startToken,
      worksetEpoch,
      worksetSignature: folderSignature
    });
  };

  // Jede erste erfolgreiche Persistenz eines Nicht-Pending-Stage-States läuft
  // hierdurch. Damit enthält die DB den Lock, bevor der UI-Token gelöst wird.
  const persistLockedStageState = async (key, stageState) => {
    pipelineState.stages[key] = stageState;
    pipelineState.worksetLocked = true;
    await persistState(pipelineState);
    establishLock();
  };

  const notifyPipelineError = (message, activeKey = null) => {
    if (pipelineState) dispatchState(dispatch, pipelineState, 'error', activeKey, message);
    else dispatch?.({ type: 'PIPELINE_ERROR', error: message });
  };

  try {
    // Identität VOR jeder Lock-Bestätigung laden (L1).
    [folderSignature, worksetEpoch] = await Promise.all([
      currentSignature(),
      db.getMeta('worksetEpoch')
    ]);
    const saved = await loadValidState(folderSignature);
    pipelineState = normalizeState(saved, folderSignature);

    // L1a: Der geladene Marker belegt bereits einen persistierten Lock. Token
    // daher vor einem möglichen Re-Persistenzfehler lösen; bei Legacy wurde der
    // Marker bereits während Hydration materialisiert.
    if (pipelineState.worksetLocked === true) establishLock();
    await persistState(pipelineState);

    dispatchState(dispatch, pipelineState, 'running');
    photos = await db.getAllPhotos();
  } catch (error) {
    const message = stageMessage(error);
    if (!persistedWorksetLock) {
      dispatch?.({ type: 'WORKSET_PIPELINE_START_ABORTED', startToken, error: message });
    } else {
      // F1: nach jeder bestätigten Sperre ist auch ein bloßer Setup-Fehler ein
      // PIPELINE_ERROR; der zuvor persistierte Zustand bleibt dabei unverändert.
      notifyPipelineError(message);
    }
    _active = false;
    _controller = null;
    return;
  }

  for (let index = 0; index < STAGES.length; index++) {
    const stage = STAGES[index];
    const key = stage.key;
    try {
      const current = pipelineState.stages[key] || emptyStageState(stage);
      const canSkipDone =
        current.status === 'done' &&
        current.implVersion === stage.implVersion &&
        await stage.validate(photos, db, { dispatch });

      if (canSkipDone) {
        // Ein done-State kann nur aus einem bereits LOCKED Bestand stammen;
        // normalisieren/persistieren ist trotzdem legitim und marker-erhaltend.
        pipelineState.stages[key] = { status: 'done', implVersion: stage.implVersion, error: null };
        await persistState(pipelineState);
        dispatchState(dispatch, pipelineState, 'running', key);
        dispatch?.({ type: 'PIPELINE_STAGE_PROGRESS', key, stage: index, progress: { done: photos.length, total: photos.length } });
        continue;
      }

      await persistLockedStageState(key, { status: 'active', implVersion: stage.implVersion, error: null });
      await stage.reset(photos, db, { reason: 'implVersion:changed' });
      dispatchState(dispatch, pipelineState, 'running', key);

      const result = await stage.run({
        photos,
        db,
        dispatch,
        signal,
        onProgress: (done, total) => dispatch?.({
          type: 'PIPELINE_STAGE_PROGRESS', key, stage: index, progress: { done, total }
        })
      });

      if (signal.aborted) {
        pipelineState.stages[key] = { status: 'pending', implVersion: stage.implVersion, error: null };
        await persistState(pipelineState);
        dispatchState(dispatch, pipelineState, 'paused', key);
        _active = false;
        _controller = null;
        return;
      }

      const status = result?.status === 'skipped' ? 'skipped' : 'done';
      await persistLockedStageState(key, { status, implVersion: stage.implVersion, error: null });
      dispatchState(dispatch, pipelineState, 'running', key);

      if (status === 'done') {
        await invalidateDownstream(key, {
          photos,
          db,
          dispatch,
          pipelineState,
          context: { reason: `stage:${key}:done` },
          status: 'running'
        });
        await persistState(pipelineState);
        dispatchState(dispatch, pipelineState, 'running', key);
      }
    } catch (error) {
      const message = stageMessage(error);
      try {
        await persistLockedStageState(key, { status: 'error', implVersion: stage.implVersion, error: message });
        notifyPipelineError(message, key);
      } catch (persistError) {
        const finalMessage = `${message}${persistError ? ' (Fehlerstatus nicht persistierbar)' : ''}`;
        if (!persistedWorksetLock) {
          dispatch?.({ type: 'WORKSET_PIPELINE_START_ABORTED', startToken, error: finalMessage });
        } else {
          notifyPipelineError(finalMessage, key);
        }
      }
      _active = false;
      _controller = null;
      return;
    }
  }

  dispatch?.({ type: 'UPDATE_PHOTOS', payload: photos });
  dispatchState(dispatch, pipelineState, 'done');
  _active = false;
  _controller = null;
}

/**
 * Invalidiert exakt die übergebenen Stufen und ruft deren reset() auf. Keine
 * transitive Auflösung: stageKeys ist die vollständige Zielmenge.
 */
export async function invalidateStages(stageKeys, options = {}) {
  const localDb = options.db || db;
  const photos = options.photos || await localDb.getAllPhotos();
  let pipelineState = options.pipelineState;
  if (!pipelineState) {
    const folderSignature = await currentSignature();
    pipelineState = normalizeState(await loadValidState(folderSignature), folderSignature);
  }

  const uniqueKeys = Array.from(new Set(Array.isArray(stageKeys) ? stageKeys : []));
  for (const targetKey of uniqueKeys) {
    const target = getStage(targetKey);
    if (!target) throw new StageError(`Unbekannte Pipeline-Stufe für Invalidierung: ${targetKey}`);
    await target.reset(photos, localDb, options.context || null);
    pipelineState.stages[targetKey] = { status: 'pending', implVersion: target.implVersion, error: null };
    options.dispatch?.({
      type: 'PIPELINE_STAGE_PROGRESS',
      key: targetKey,
      stage: STAGES.indexOf(target),
      progress: { done: 0, total: photos.length }
    });
  }

  if (!options.pipelineState) await persistState(pipelineState);
  options.dispatch?.({
    type: 'PIPELINE_STATE',
    payload: {
      status: options.status || (options.pipelineState ? 'running' : 'idle'),
      stage: -1,
      activeKey: null,
      stages: cloneStages(pipelineState.stages),
      error: null
    }
  });
  return { photos, pipelineState };
}

export async function invalidateDownstream(key, options = {}) {
  const source = getStage(key);
  if (!source) throw new StageError(`Unbekannte Pipeline-Stufe für Invalidierung: ${key}`);
  return invalidateStages(source.invalidates || [], options);
}
