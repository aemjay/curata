// js/deps.js
// Alle CDN-Abhängigkeiten zentralisiert.
// Wird einmal gecacht; alle anderen Module importieren von hier.

export {
  h,
  render,
  createContext,
  Fragment
} from 'https://esm.sh/preact@10.23.1';

export {
  useState,
  useEffect,
  useCallback,
  useReducer,
  useContext,
  useRef,
  useMemo
} from 'https://esm.sh/preact@10.23.1/hooks';

export { default as htm } from 'https://esm.sh/htm@3.1.1';

/* -----------------------------------------------------------------
   Worker-seitige Abhängigkeiten (Etappe 2 / Ingest).
   Bewusst NUR als gepinnte URL-Konstanten, nicht als statische
   Re-Exports: Der Ingest-Worker und der Main-Thread-HEIC-Fallback
   laden sie per dynamischem import() — so wird das UI-Framework
   (preact/htm) nie in den Worker-Kontext gezogen, und schwere
   WASM-Module werden erst bei Bedarf geladen.
   Damit bleibt deps.js dennoch die EINZIGE Stelle mit CDN-URLs.
   ----------------------------------------------------------------- */
export const EXIFR_URL   = 'https://esm.sh/exifr@7.1.3';
export const LIBHEIF_URL = 'https://esm.sh/libheif-js@1.18.2/wasm-bundle';

/* -----------------------------------------------------------------
   MediaPipe Vision Tasks (Etappe 5 / FaceLandmarker).
   Gepinnte Version: jsDelivr listet @mediapipe/tasks-vision 0.10.35
   als aktuelle Paketversion. Vision-Bundle und WASM-Assets bleiben
   zentral hier, Modell-Asset ebenso.
   ----------------------------------------------------------------- */
export const MEDIAPIPE_TASKS_VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';
export const MEDIAPIPE_TASKS_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
export const MEDIAPIPE_FACE_LANDMARKER_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/* -----------------------------------------------------------------
   Transformers.js (Etappe 6+ / CLIP, VLM, Face-Embeddings).
   Gepinnt auf die aktuelle stabile v3-Dokumentationslinie. Die Library
   wird dynamisch in models.js geladen; schwere ONNX/WASM-Artefakte werden
   erst bei Bedarf angefordert. wasmPaths zeigt auf dieselbe gepinnte
   Version, damit auch Fallback-Backend-Artefakte nicht implizit auf latest
   rutschen.
   ----------------------------------------------------------------- */
export const TRANSFORMERS_JS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
export const TRANSFORMERS_WASM_PATH = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';


/* -----------------------------------------------------------------
   CLIP Embeddings / Zero-Shot (Etappe 6 + Etappe 8.2).
   Single Source of Truth fuer Vision-Embeddings und VLM-Zero-Shot-
   Text-Embeddings. Revision ist bewusst gepinnt, nicht 'main'.
   Kurz-Commit laut HF-Commit-History: 342fdf2 (aktueller Metadatenstand);
   ONNX-Text-Tower-Artefakte liegen im selben Checkpoint.
   ----------------------------------------------------------------- */
export const CLIP_MODEL_ID = 'Xenova/clip-vit-base-patch16';
export const CLIP_MODEL_REVISION = '342fdf2';


/* -----------------------------------------------------------------
   Florence-2 VLM (Etappe 8).
   Modellrevision explizit gepinnt; die genutzte HF-Revision ist
   e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f.
   ----------------------------------------------------------------- */
export const FLORENCE_MODEL_ID = 'onnx-community/Florence-2-base-ft';
export const FLORENCE_MODEL_REVISION = 'e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f';

/* -----------------------------------------------------------------
   JSZip (Etappe 12 / Export).
   Version 3.10.1 ist laut offizieller JSZip-Dokumentation und cdnjs
   der aktuelle stabile Stand; bewusst kein latest-Pfad.
   ----------------------------------------------------------------- */
export { default as JSZip } from 'https://esm.sh/jszip@3.10.1';
