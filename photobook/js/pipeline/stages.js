// js/pipeline/stages.js
// STAGES-Registry (§10.4). Die Registry ist die einzige Wahrheit über Stufen-
// Metadaten: implVersion, Validator, Reset, Stub-Status und Invalidierungslisten.

import { runTechnical, validateTechnical, resetTechnical, implVersion as technicalVersion } from './s1_technical.js';
import { runChapters, validateChapters, resetChapters, implVersion as chaptersVersion } from './s2_chapters.js';
import { runFaces, validateFaces, resetFaces, implVersion as facesVersion } from './s3_faces.js';
import { runPersonsStub, validatePersonsStub, resetPersonsStub } from './s3b_persons.js';
import { runEmbeddings, validateEmbeddings, resetEmbeddings, implVersion as embeddingsVersion } from './s4_embeddings.js';
import { runVlm, validateVlm, resetVlm, implVersion as vlmVersion } from './s5_vlm.js';
import { runScenes, validateScenes, resetScenes, implVersion as scenesVersion } from './s5b_scenes.js';
import { runSelect, validateSelect, resetSelect, implVersion as selectVersion } from './s6_select.js';

function yieldToLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Erzeugt einen No-op-Stub mit korrektem Rückgabevertrag (§10.4).
 * Lässt alle Photo-Felder unangetastet (null) und meldet {status:'skipped'}.
 * @param {string} key
 */
function makeStub(key) {
  return async function stubStage({ photos, signal, onProgress }) {
    const total = photos ? photos.length : 0;
    if (total === 0) { onProgress?.(0, 0); return { status: 'skipped' }; }
    for (let i = 0; i < total; i++) {
      if (signal && signal.aborted) return { status: 'skipped' };
      onProgress?.(i + 1, total);
      if ((i & 15) === 0) await yieldToLoop();
    }
    console.info(`[pipeline] Stufe '${key}' übersprungen (Stub — noch nicht implementiert).`);
    return { status: 'skipped' };
  };
}

function validateStub() { return false; }
async function resetNoop(photos, db, context) { void photos; void db; void context; }

/**
 * @typedef {Object} Stage
 * @property {string} key
 * @property {number|string} num
 * @property {string} label
 * @property {string} implVersion
 * @property {Function} run
 * @property {Function} validate
 * @property {Function} reset
 * @property {boolean} isStub
 * @property {string[]} invalidates
 */

/** @type {Stage[]} */
export const STAGES = [
  {
    key: 'technical', num: 1, label: 'Technik-Analyse', implVersion: technicalVersion,
    run: runTechnical, validate: validateTechnical, reset: resetTechnical,
    isStub: false, invalidates: ['embeddings', 'vlm', 'scenes', 'select']
  },
  {
    key: 'chapters', num: 2, label: 'Kapitel (Tag)', implVersion: chaptersVersion,
    run: runChapters, validate: validateChapters, reset: resetChapters,
    isStub: false, invalidates: ['scenes', 'select']
  },
  {
    key: 'faces', num: 3, label: 'Gesichter (P/S/M)', implVersion: facesVersion,
    run: runFaces, validate: validateFaces, reset: resetFaces,
    isStub: false, invalidates: ['persons', 'embeddings', 'vlm', 'scenes', 'select']
  },
  {
    key: 'persons', num: '3b', label: 'Personen-IDs', implVersion: 'stub',
    run: runPersonsStub, validate: validatePersonsStub, reset: resetPersonsStub,
    isStub: true, invalidates: ['select']
  },
  {
    key: 'embeddings', num: 4, label: 'Ähnlichkeit', implVersion: embeddingsVersion,
    run: runEmbeddings, validate: validateEmbeddings, reset: resetEmbeddings,
    isStub: false, invalidates: ['vlm', 'scenes', 'select']
  },
  {
    key: 'vlm', num: 5, label: 'Bildanalyse (VLM)', implVersion: vlmVersion,
    run: runVlm, validate: validateVlm, reset: resetVlm,
    isStub: false, invalidates: ['scenes', 'select']
  },
  {
    key: 'scenes', num: '5b', label: 'Szenen', implVersion: scenesVersion,
    run: runScenes, validate: validateScenes, reset: resetScenes,
    isStub: false, invalidates: ['select']
  },
  {
    key: 'select', num: 6, label: 'Auswahl', implVersion: selectVersion,
    run: runSelect, validate: validateSelect, reset: resetSelect,
    isStub: false, invalidates: []
  },
];

export function getStage(key) {
  return STAGES.find((stage) => stage.key === key) || null;
}
