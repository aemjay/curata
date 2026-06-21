// js/models.js
// Zentraler Modell-Loader (§10.6). Alle ML-Stufen laden Modelle über diese
// Datei, damit Cache-/Backend-Konfiguration, Fortschritt und Entladen an einer
// Stelle liegen. Es ist nie mehr als ein Modell gleichzeitig geladen.

import { TRANSFORMERS_JS_URL, TRANSFORMERS_WASM_PATH } from './deps.js';

const loaded = new Map();
let configured = false;
let transformersPromise = null;
let webgpuPromise = null;
let activeKey = null;

/**
 * Lädt ein Modell genau einmal je key. loaderFn erhält das dynamisch geladene
 * Transformers-Modul, das bevorzugte Backend und einen Fortschritts-Adapter.
 * Bei WebGPU-Initialisierungsfehlern wird automatisch auf WASM zurückgefallen.
 * @template T
 * @param {string} key
 * @param {(ctx:{transformers:object, device:'webgpu'|'wasm', onProgress?:Function})=>Promise<T>} loaderFn
 * @param {(info:object)=>void=} onProgress
 * @returns {Promise<T>}
 */
export async function loadModel(key, loaderFn, onProgress) {
  if (loaded.has(key)) return loaded.get(key).value;

  // Vertrag: maximal ein ML-Modell gleichzeitig. Falls eine andere Stufe noch
  // Referenzen hält, wird sie konservativ entladen, bevor das neue Modell lädt.
  if (activeKey && activeKey !== key) await unloadModel(activeKey);

  const transformers = await loadTransformers();
  const preferred = await hasWebGPU() ? 'webgpu' : 'wasm';

  try {
    onProgress?.({ status: 'initiate', key, device: preferred });
    const value = await loaderFn({ transformers, device: preferred, onProgress });
    loaded.set(key, { value });
    activeKey = key;
    return value;
  } catch (err) {
    if (preferred !== 'webgpu') throw err;
    console.warn(`[models] WebGPU-Ladevorgang für ${key} fehlgeschlagen; Fallback auf WASM.`, err);
    onProgress?.({ status: 'fallback', key, from: 'webgpu', to: 'wasm', error: readable(err) });
    const value = await loaderFn({ transformers, device: 'wasm', onProgress });
    loaded.set(key, { value });
    activeKey = key;
    return value;
  }
}

/**
 * Gibt Modellreferenzen frei. Transformers.js/ONNXRuntime räumt den Rest nach
 * GC auf; dispose()/close() wird genutzt, wenn das Objekt es anbietet.
 * @param {string} key
 */
export async function unloadModel(key) {
  const entry = loaded.get(key);
  if (!entry) return;
  loaded.delete(key);
  if (activeKey === key) activeKey = null;
  await disposeDeep(entry.value);
  // Dem Browser eine Chance geben, große ArrayBuffers/ONNX-Sessions freizugeben.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Einmalige WebGPU-Erkennung.
 * @returns {Promise<boolean>}
 */
export function hasWebGPU() {
  if (webgpuPromise) return webgpuPromise;
  webgpuPromise = (async () => {
    try {
      if (!('gpu' in navigator) || !navigator.gpu) return false;
      const adapter = await navigator.gpu.requestAdapter();
      return !!adapter;
    } catch (_) {
      return false;
    }
  })();
  return webgpuPromise;
}

/** @returns {Promise<object>} */
async function loadTransformers() {
  if (!transformersPromise) {
    transformersPromise = import(TRANSFORMERS_JS_URL).then((mod) => {
      configureEnv(mod.env);
      return mod;
    });
  }
  return transformersPromise;
}

function configureEnv(env) {
  if (!env || configured) return;
  configured = true;

  // Browser-Cache/Cache API ist in Transformers.js im Browser vorgesehen; die
  // Property-Namen unterscheiden sich leicht zwischen Versionen. Deshalb nur
  // setzen, wenn vorhanden.
  if ('useBrowserCache' in env) env.useBrowserCache = true;
  if ('allowRemoteModels' in env) env.allowRemoteModels = true;
  if ('allowLocalModels' in env) env.allowLocalModels = false;

  // Fallback-WASM-Artefakte aus derselben gepinnten Paketversion laden.
  try {
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = TRANSFORMERS_WASM_PATH;
    }
  } catch (_) { /* env-Struktur kann je Version variieren. */ }
}

async function disposeDeep(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);

  for (const method of ['dispose', 'close']) {
    if (typeof value[method] === 'function') {
      try { await value[method](); } catch (_) {}
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) await disposeDeep(item, seen);
    return;
  }

  for (const k of Object.keys(value)) {
    const child = value[k];
    if (child && typeof child === 'object') await disposeDeep(child, seen);
  }
}

function readable(err) {
  return err && err.message ? String(err.message) : String(err || 'Unbekannter Fehler');
}
