// js/pipeline/s5_vlm.js
// Stufe 5 (§10.4): Florence-2 VLM-Tagging nur für Cluster-Repräsentanten.
// E8.2: Florence-2 bleibt reine Inferenzquelle (<MORE_DETAILED_CAPTION>, <OD>).
// Die Strukturfelder entstehen deterministisch aus vlmRaw + vorhandenen
// Metadaten; place/activity werden per Zero-Shot gegen vorhandene CLIP-
// Bild-Embeddings abgeleitet, nicht mehr per Caption-Keyword-System.

import { loadModel, unloadModel } from '../models.js';
import {
  CLIP_MODEL_ID,
  CLIP_MODEL_REVISION,
  FLORENCE_MODEL_ID,
  FLORENCE_MODEL_REVISION,
  TRANSFORMERS_JS_URL
} from '../deps.js';

const KEY = 'vlm';
export const implVersion = 'vlm-v3';

export const TASK_MORE_DETAILED_CAPTION = '<MORE_DETAILED_CAPTION>';
export const TASK_OD = '<OD>';

export const FLORENCE_MODEL_KEY = 'florence-2-base-ft';
export const MODEL_KEY = FLORENCE_MODEL_KEY; // Rückwärtskompatibler Exportname aus E8.
export const MODEL_ID = FLORENCE_MODEL_ID;
export const MODEL_REVISION = FLORENCE_MODEL_REVISION;

export const CLIP_TEXT_MODEL_KEY = 'clip-text-base-patch16';
export const ZS_PROMPTS_VERSION = 'zs-p1';
export const ZS_TEXT_DTYPE = 'fp16';
export const TRANSFORMERS_JS_VERSION = extractTransformersVersion(TRANSFORMERS_JS_URL);

export const MAX_NEW_TOKENS = Object.freeze({
  [TASK_MORE_DETAILED_CAPTION]: 256,
  [TASK_OD]: 512
});

export const BATCH_SIZE = 10;
export const ETA_WINDOW = 10;

// Startwerte gemäß E8.2 §4. Browser-Golden-Set-Kalibrierung bleibt als
// Abnahmeschritt erforderlich; die Schwellen sind getrennt geführt, damit die
// Kalibrierwerte ohne Schemaänderung pro Feld ersetzt werden können.
export const TAU_ABS = Object.freeze({ place: 0.22, activity: 0.22 });
export const TAU_MARGIN = Object.freeze({ place: 0.01, activity: 0.01 });
export const EPS_DECISION = 0.005;

export const SHOT_KEYWORDS = Object.freeze({
  detailExplicit: [
    'close-up', 'close up', 'closeup', 'macro', 'detail of', 'texture',
    'plate of', 'piece of', 'slice of', 'bowl of', 'cup of', 'dish of',
    'food on', 'bread on'
  ],
  wideStrong: [
    'wide shot', 'very wide shot', 'panorama', 'panoramic', 'aerial',
    'skyline', 'vast', 'view of', 'wide view', 'scenery', 'landscape',
    'beach from above'
  ],
  wideWeak: ['field', 'mountain-', 'valley', 'coast', 'sky', 'clear blue sky', 'sky above'],
  placeRelevant: [
    'landscape', 'field', 'mountain-', 'beach', 'coast', 'valley', 'sky',
    'water', 'city', 'building-', 'scenery'
  ],
  faceWideExceptions: ['group', 'crowd', 'landscape', 'panorama', 'wide shot', 'view']
});

export const DETAIL_BLOCKERS = Object.freeze([
  'person', 'people', 'man', 'woman', 'child', 'group', 'crowd',
  'building-', 'church', 'cathedral', 'castle', 'tower', 'bridge',
  'statue-', 'sculpture-', 'monument', 'architecture', 'facade',
  'mountain-', 'landscape', 'field', 'beach', 'coast', 'water', 'sky', 'tree-'
]);

export const MOOD_KEYWORDS = Object.freeze({
  negative: ['sad', 'crying', 'angry', 'storm-', 'rainy', 'dark', 'gloomy', 'foggy', 'damaged', 'abandoned'],
  positive: ['smiling', 'laughing', 'happy', 'joyful', 'cheerful', 'celebrat-', 'sunny', 'bright', 'colorful', 'playful', 'fun']
});

export const ZS_PROMPTS = Object.freeze({
  place: Object.freeze({
    beach: [
      'a photo taken at the beach',
      'a sandy beach by the sea',
      'people at the seaside',
      'a coastal shore with waves'
    ],
    mountains: [
      'a photo of mountains',
      'an alpine landscape with peaks',
      'a mountain valley',
      'hills and a mountain ridge'
    ],
    water: [
      'a lake or a river',
      'a waterfall',
      'a harbor with boats on the water',
      'a canal'
    ],
    city: [
      'a city street with buildings',
      'an urban scene in a town',
      'a town square',
      'modern architecture in a city'
    ],
    landmark: [
      'a famous landmark or monument',
      'a historic cathedral or church',
      'an old castle or palace',
      'a statue or sculpture',
      'ancient ruins or a temple'
    ],
    nature: [
      'a forest with trees',
      'a green field or meadow',
      'a garden or park',
      'flowers and plants in nature'
    ],
    indoor: [
      'an indoor room interior',
      'inside a restaurant or cafe',
      'an indoor hall or museum interior',
      'a hotel room'
    ]
  }),
  activity: Object.freeze({
    celebration: [
      'people celebrating at a party',
      'a festival or wedding celebration',
      'people dancing and toasting',
      'fireworks at a celebration'
    ],
    playing_sports: [
      'people playing a game or sport',
      'children playing',
      'a person running or cycling',
      'someone doing sports outdoors'
    ],
    swimming_beach: [
      'people swimming in the water',
      'someone bathing in a pool',
      'a person surfing',
      'people playing in the water at the beach'
    ],
    hiking_nature: [
      'people hiking on a trail',
      'a hiker with a backpack in the mountains',
      'people trekking through nature'
    ],
    eating_drinking: [
      'people eating a meal together',
      'food served on a table at a restaurant',
      'someone drinking coffee at a cafe',
      'a dish of food'
    ],
    sightseeing: [
      'tourists visiting a landmark',
      'people sightseeing at a monument',
      'a tourist looking at a historic building'
    ],
    walking: [
      'people walking down a street',
      'a person strolling through a town'
    ],
    shopping_market: [
      'people shopping at a market',
      'a market stall with goods',
      'someone browsing in a store'
    ],
    driving_transport: [
      'a person riding a motorcycle or scooter',
      'people on a train or a bus',
      'a boat or ferry ride',
      'someone riding a bicycle'
    ],
    posing: [
      'a person posing for a portrait photo',
      'someone smiling at the camera for a picture'
    ],
    resting: [
      'people sitting and relaxing',
      'a person lying down and resting',
      'someone sunbathing or lounging'
    ]
  })
});

export const PLACE_CATEGORIES = Object.freeze(['beach', 'mountains', 'water', 'city', 'landmark', 'nature', 'indoor']);
export const ACTIVITY_CATEGORIES = Object.freeze([
  'celebration', 'playing_sports', 'swimming_beach', 'hiking_nature',
  'eating_drinking', 'sightseeing', 'walking', 'shopping_market',
  'driving_transport', 'posing', 'resting'
]);

// Nur Diagnose-Hinweise; keine Entscheidungslogik für place/activity.
export const CAPTION_HINT_KEYWORDS = Object.freeze({
  place: Object.freeze({
    landmark: ['cathedral', 'church', 'castle', 'monument', 'tower', 'bridge', 'temple', 'ruins', 'palace', 'fountain', 'statue', 'sculpture-'],
    beach: ['beach', 'sand', 'ocean', 'sea', 'coast', 'shore', 'palm'],
    mountains: ['mountain-', 'alpine', 'peak', 'valley', 'cliff', 'glacier', 'summit'],
    water: ['lake', 'river', 'waterfall', 'harbor', 'marina', 'canal'],
    city: ['street', 'city', 'building-', 'square', 'market', 'alley', 'sidewalk'],
    nature: ['forest', 'tree-', 'field', 'meadow', 'garden', 'park', 'flower-'],
    indoor: ['room', 'indoor', 'inside', 'interior', 'hall', 'kitchen', 'restaurant interior']
  }),
  activity: Object.freeze({
    eating_drinking: ['eating', 'drinking', 'meal', 'restaurant', 'cafe', 'coffee', 'dish of', 'food'],
    driving_transport: ['motorcycle', 'scooter', 'train', 'bus', 'boat', 'ferry', 'bicycle'],
    sightseeing: ['visiting', 'sightseeing', 'monument', 'cathedral', 'castle', 'ruins', 'temple'],
    swimming_beach: ['swimming', 'pool', 'surf', 'snorkel'],
    hiking_nature: ['hiking', 'trail', 'trekking', 'backpack'],
    celebration: ['celebrat-', 'party', 'festival', 'wedding', 'fireworks']
  })
});

export const MOMENT_WEIGHTS = Object.freeze({ activity: 0.35, interaction: 0.20, face: 0.25, visualRole: 0.20 });
export const ACTIVITY_SCORE = Object.freeze({
  celebration: 0.90,
  playing_sports: 0.90,
  swimming_beach: 0.90,
  hiking_nature: 0.75,
  eating_drinking: 0.75,
  sightseeing: 0.75,
  walking: 0.55,
  posing: 0.55,
  shopping_market: 0.55,
  driving_transport: 0.55,
  resting: 0.40,
  null: 0.35
});
export const INTERACTION_KEYWORDS = Object.freeze([
  'talking', 'holding', 'hugging', 'playing', 'sitting together',
  'standing together', 'group of people', 'crowd', 'family', 'friends'
]);

export const VLM_LABELS_DE = Object.freeze({
  wide: 'Totale', medium: 'Halbnah', detail: 'Detail',
  celebration: 'Feiern', playing_sports: 'Spiel & Sport', swimming_beach: 'Baden',
  hiking_nature: 'Wandern', eating_drinking: 'Essen & Trinken', sightseeing: 'Besichtigung',
  walking: 'Spaziergang', shopping_market: 'Einkaufen', driving_transport: 'Unterwegs',
  posing: 'Posieren', resting: 'Entspannen',
  positive: 'positiv', neutral: 'neutral', negative: 'negativ',
  beach: 'Strand', mountains: 'Berge', water: 'Wasser', city: 'Stadt',
  landmark: 'Sehenswürdigkeit', nature: 'Natur', indoor: 'Innenraum'
});

const VALID_SHOT_TYPES = new Set([null, 'wide', 'medium', 'detail']);
const VALID_MOODS = new Set([null, 'positive', 'neutral', 'negative']);
const VALID_PLACES = new Set([null, ...PLACE_CATEGORIES]);

const DTYPE_LADDER = Object.freeze({
  webgpu: [
    {
      label: 'webgpu-q4-mix',
      device: 'webgpu',
      dtype: {
        embed_tokens: 'fp16',
        vision_encoder: 'fp16',
        encoder_model: 'q4',
        decoder_model_merged: 'q4'
      }
    },
    { label: 'webgpu-fp32', device: 'webgpu', dtype: 'fp32' }
  ],
  wasm: [
    { label: 'wasm-fp32', device: 'wasm', dtype: 'fp32' }
  ]
});

const debugStore = new Map();

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
export async function runVlm({ photos, db, dispatch, signal, onProgress }) {
  installZsDebugHelper();

  const candidates = (photos || []).filter((p) => p && p.repr === true && p.status === 'ok');
  const pending = candidates.filter((p) => {
    normalizeStageFails(p);
    return p.vlm == null && !p.stageFails[KEY];
  });

  const total = pending.length;
  let done = 0;
  let changed = [];
  let florence = null;
  let rawKeys = new Set();
  let zsAssets = null;
  const durations = [];

  onProgress?.(0, total);
  if (total === 0) return { status: 'done' };

  try {
    zsAssets = await ensureZsAssets(db, onModelProgress);

    try {
      rawKeys = new Set(await db.getVlmRawKeys());
    } catch (err) {
      throw new StageError('VLM-Rohdaten-Store konnte nicht gelesen werden.', err);
    }

    const needsModel = pending.some((p) => !rawKeys.has(p.id));
    if (needsModel) {
      try { florence = await loadFlorence(onModelProgress); }
      catch (err) { throw new StageError('Florence-2-Modell konnte nicht geladen werden.', err); }
    }

    for (const photo of pending) {
      if (signal?.aborted) { await flush(); return { status: 'done' }; }
      const t0 = performanceNow();
      normalizeStageFails(photo);

      try {
        let raw = null;
        if (rawKeys.has(photo.id)) {
          try { raw = await db.getVlmRaw(photo.id); }
          catch (err) { throw new StageError('VLM-Rohdaten konnten nicht aus IndexedDB gelesen werden.', err); }
        }

        if (!raw) {
          if (!florence) {
            try { florence = await loadFlorence(onModelProgress); }
            catch (err) { throw new StageError('Florence-2-Modell konnte nicht geladen werden.', err); }
          }

          let caption;
          try {
            caption = await generateCaption(florence, db, photo.id);
          } catch (err) {
            photo.vlm = null;
            photo.stageFails[KEY] = readableReason(err, 'Florence-2-Caption fehlgeschlagen');
            changed.push(photo);
            done++;
            rememberDuration(t0);
            onProgress?.(done, total);
            if (changed.length >= BATCH_SIZE) await flush();
            continue;
          }

          if (signal?.aborted) {
            // Caption bewusst verwerfen: kein partieller vlmRaw-Record.
            await flush();
            return { status: 'done' };
          }

          let odLabels = [];
          let odBboxes = [];
          try {
            const od = await generateOd(florence, db, photo.id);
            odLabels = od.labels;
            odBboxes = od.bboxes;
          } catch (_) {
            // Degradierter Modus: Caption ist verwertbar, OD bleibt leer.
            odLabels = [];
            odBboxes = [];
          }

          raw = {
            caption,
            odLabels,
            odBboxes,
            modelId: `${MODEL_ID}@${MODEL_REVISION}`,
            ts: Date.now()
          };

          try {
            await db.putVlmRaw(photo.id, raw);
            rawKeys.add(photo.id);
          } catch (err) {
            throw new StageError('VLM-Rohdaten konnten nicht in IndexedDB gespeichert werden.', err);
          }
        }

        const imgEmbeddingInfo = await readImageEmbedding(db, photo.id);
        if (!imgEmbeddingInfo.vector) {
          console.warn('[vlm] Kein CLIP-Bild-Embedding für Repräsentant; place/activity werden null.', photo.id);
        }

        try {
          photo.vlm = deriveVlm(raw, photo, imgEmbeddingInfo.vector, zsAssets, imgEmbeddingInfo.norm);
          delete photo.stageFails[KEY];
        } catch (err) {
          photo.vlm = fallbackVlm(raw);
          delete photo.stageFails[KEY];
          console.warn('[vlm] Ableitungs-Fallback genutzt.', photo.id, err);
        }
        changed.push(photo);
      } catch (err) {
        if (err instanceof StageError) throw err;
        photo.vlm = null;
        photo.stageFails[KEY] = readableReason(err, 'VLM-Ableitung fehlgeschlagen');
        changed.push(photo);
      }

      done++;
      rememberDuration(t0);
      onProgress?.(done, total);
      if (changed.length >= BATCH_SIZE) await flush();
      await yieldToLoop();
    }

    await flush();
    onProgress?.(total, total);
    return { status: 'done' };
  } catch (err) {
    if (err instanceof StageError) throw err;
    throw new StageError('VLM-Stufe ist fehlgeschlagen.', err);
  } finally {
    if (florence) await unloadModel(FLORENCE_MODEL_KEY);
  }

  async function flush() {
    if (changed.length === 0) return;
    const batch = changed;
    changed = [];
    try {
      await db.putPhotos(batch);
      dispatch?.({ type: 'UPDATE_PHOTOS', payload: batch });
    } catch (err) {
      throw new StageError('VLM-Photo-Records konnten nicht in IndexedDB gespeichert werden.', err);
    }
  }

  function onModelProgress(info) {
    void info;
  }

  function rememberDuration(startMs) {
    const dt = performanceNow() - startMs;
    if (Number.isFinite(dt) && dt > 0) {
      durations.push(dt);
      if (durations.length > ETA_WINDOW) durations.shift();
    }
  }
}

/**
 * Validator (§10.4): reine Strukturprüfung, keine IDB-Zugriffe.
 * @param {object[]} photos
 * @returns {boolean}
 */
export function validateVlm(photos) {
  const candidates = (photos || []).filter((p) => p && p.repr === true && p.status === 'ok');
  for (const p of candidates) {
    normalizeStageFails(p);
    if (p.stageFails[KEY]) continue;
    if (!p.vlm || typeof p.vlm !== 'object') return false;
    if (typeof p.vlm.caption !== 'string') return false;
    if (!VALID_SHOT_TYPES.has(p.vlm.shotType ?? null)) return false;
    if (!VALID_MOODS.has(p.vlm.mood ?? null)) return false;
    if (!VALID_PLACES.has(p.vlm.place ?? null)) return false;
    if (!(p.vlm.activity === null || typeof p.vlm.activity === 'string')) return false;
    const ms = p.vlm.momentScore;
    if (!(ms === null || (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 && ms <= 1))) return false;
  }
  return true;
}

/**
 * Reset gemäß E8 D3/E8.2 §6: konservativ alle photo.vlm zurücksetzen;
 * vlmRaw und Zero-Shot-Text-Embedding-Assets bleiben erhalten.
 * @param {object[]} photos
 * @param {object} db
 * @param {object=} context
 */
export async function resetVlm(photos, db, context) {
  void context;
  const changed = [];
  for (const p of photos || []) {
    if (!p) continue;
    normalizeStageFails(p);
    const had = p.vlm != null || Object.prototype.hasOwnProperty.call(p.stageFails, KEY);
    if (!had) continue;
    p.vlm = null;
    delete p.stageFails[KEY];
    changed.push(p);
  }
  for (let i = 0; i < changed.length; i += BATCH_SIZE) {
    await db.putPhotos(changed.slice(i, i + BATCH_SIZE));
  }
}

export function deriveVlm(rawInput, photo, imgEmbedding = null, zsAssets = null, imgEmbeddingNorm = null) {
  const raw = normalizeRaw(rawInput);
  const caption = raw.caption.trim();
  if (!caption) return { caption: '', shotType: null, activity: null, mood: null, place: null, momentScore: null };

  const odObjects = normalizeOdObjects(raw);
  const metrics = odMetrics(odObjects);
  const degradedOd = odObjects.length === 0;

  const shotType = deriveShotType(caption, metrics, photo, degradedOd, raw.odLabels);
  const mood = deriveMood(caption, photo);
  const zs = classifyZsFields(imgEmbedding, zsAssets);
  const place = zs.chosen.place;
  const activity = zs.chosen.activity;
  const momentScore = deriveMomentScore({ caption, activity, mood, place, shotType, photo });

  const debug = makeZsDebug({ zs, place, activity, caption, odLabels: raw.odLabels, imgEmbeddingNorm });
  rememberDebug(photo?.id, debug);
  logDiagnosticContradictions(photo?.id, caption, raw.odLabels, { place, activity });

  return { shotType, activity, mood, place, momentScore, caption };
}

async function ensureZsAssets(db, onProgress) {
  const key = buildZsAssetKey(ZS_TEXT_DTYPE);
  let existing;
  try {
    existing = await db.getMeta(key);
  } catch (err) {
    throw new StageError('Zero-Shot-Text-Embedding-Asset konnte nicht aus dem Meta-Store gelesen werden.', err);
  }

  if (isValidZsAsset(existing, ZS_TEXT_DTYPE)) return normalizeZsAsset(existing);

  try {
    const generated = await generateZsAssets(onProgress);
    const generatedKey = buildZsAssetKey(generated.textDtype);
    await db.putMeta(generatedKey, generated);
    return normalizeZsAsset(generated);
  } catch (err) {
    if (err instanceof StageError) throw err;
    throw new StageError('Zero-Shot-Text-Embedding-Assets konnten nicht erzeugt werden.', err);
  }
}

async function generateZsAssets(onProgress) {
  let clipText = null;
  try {
    clipText = await loadClipText(onProgress);
    const flat = flattenPrompts(ZS_PROMPTS);
    const embeddings = await encodeTextPrompts(clipText, flat.prompts);
    const dims = embeddings.dims;
    const vectors = buildCategoryVectors(flat, embeddings);

    return {
      modelId: CLIP_MODEL_ID,
      modelRevision: CLIP_MODEL_REVISION,
      transformersJsVersion: TRANSFORMERS_JS_VERSION,
      textDtype: ZS_TEXT_DTYPE,
      promptsVersion: ZS_PROMPTS_VERSION,
      dims,
      vectors: vectorsToPlain(vectors),
      ts: Date.now()
    };
  } finally {
    if (clipText) await unloadModel(CLIP_TEXT_MODEL_KEY);
  }
}

async function loadClipText(onProgress) {
  return loadModel(CLIP_TEXT_MODEL_KEY, async ({ transformers, device, onProgress: progress }) => {
    const { AutoTokenizer, CLIPTextModelWithProjection } = transformers;
    if (!AutoTokenizer || !CLIPTextModelWithProjection) {
      throw new Error('Transformers.js exportiert AutoTokenizer/CLIPTextModelWithProjection nicht.');
    }

    const common = {
      revision: CLIP_MODEL_REVISION,
      progress_callback: progressAdapter(progress || onProgress)
    };
    const tokenizer = await AutoTokenizer.from_pretrained(CLIP_MODEL_ID, common);
    const textModel = await CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL_ID, {
      ...common,
      device,
      dtype: ZS_TEXT_DTYPE
    });

    return {
      tokenizer,
      textModel,
      device,
      textDtype: ZS_TEXT_DTYPE,
      async dispose() {
        try { await textModel.dispose?.(); } catch (_) {}
      }
    };
  }, onProgress);
}

async function encodeTextPrompts(clipText, prompts) {
  const inputs = await clipText.tokenizer(prompts, { padding: true, truncation: true });
  const out = await clipText.textModel(inputs);
  const tensor = out?.text_embeds || out?.pooler_output;
  if (!tensor || !isVector(tensor.data)) throw new Error('CLIP-Textmodell lieferte keine text_embeds.');

  const rows = Array.isArray(tensor.dims) && tensor.dims.length >= 2 ? Number(tensor.dims[0]) : prompts.length;
  const dims = Array.isArray(tensor.dims) && tensor.dims.length >= 2 ? Number(tensor.dims[1]) : Math.floor(tensor.data.length / rows);
  if (!Number.isFinite(rows) || rows !== prompts.length || !Number.isFinite(dims) || dims <= 0) {
    throw new Error('CLIP-Textmodell lieferte unerwartete Embedding-Dimensionen.');
  }
  return { data: tensor.data, rows, dims };
}

function flattenPrompts(promptsByField) {
  const prompts = [];
  const entries = [];
  for (const field of ['place', 'activity']) {
    for (const [category, list] of Object.entries(promptsByField[field] || {})) {
      const start = prompts.length;
      for (const prompt of list) prompts.push(prompt);
      entries.push({ field, category, start, count: prompts.length - start });
    }
  }
  return { prompts, entries };
}

function buildCategoryVectors(flat, embeddings) {
  const vectors = { place: {}, activity: {} };
  for (const entry of flat.entries) {
    const mean = new Float32Array(embeddings.dims);
    for (let i = 0; i < entry.count; i++) {
      const row = entry.start + i;
      const offset = row * embeddings.dims;
      for (let j = 0; j < embeddings.dims; j++) mean[j] += embeddings.data[offset + j];
    }
    const div = entry.count || 1;
    for (let j = 0; j < mean.length; j++) mean[j] /= div;
    vectors[entry.field][entry.category] = normalizeVector(mean).vector;
  }
  return vectors;
}

function vectorsToPlain(vectors) {
  const out = { place: {}, activity: {} };
  for (const field of ['place', 'activity']) {
    for (const [category, vector] of Object.entries(vectors[field] || {})) {
      out[field][category] = Array.from(vector);
    }
  }
  return out;
}

function normalizeZsAsset(asset) {
  const out = { ...asset, vectors: { place: {}, activity: {} } };
  for (const field of ['place', 'activity']) {
    for (const [category, vector] of Object.entries(asset?.vectors?.[field] || {})) {
      out.vectors[field][category] = normalizeVector(vector).vector;
    }
  }
  return out;
}

function isValidZsAsset(asset, textDtype) {
  if (!asset || typeof asset !== 'object') return false;
  if (asset.modelId !== CLIP_MODEL_ID) return false;
  if (asset.modelRevision !== CLIP_MODEL_REVISION) return false;
  if (asset.transformersJsVersion !== TRANSFORMERS_JS_VERSION) return false;
  if (asset.textDtype !== textDtype) return false;
  if (asset.promptsVersion !== ZS_PROMPTS_VERSION) return false;
  if (!Number.isFinite(asset.dims) || asset.dims <= 0) return false;
  for (const category of PLACE_CATEGORIES) if (!isVectorOfDim(asset.vectors?.place?.[category], asset.dims)) return false;
  for (const category of ACTIVITY_CATEGORIES) if (!isVectorOfDim(asset.vectors?.activity?.[category], asset.dims)) return false;
  return true;
}

function buildZsAssetKey(textDtype) {
  return `vlmTextEmb:${CLIP_MODEL_ID}:${CLIP_MODEL_REVISION}:${TRANSFORMERS_JS_VERSION}:${textDtype}:${ZS_PROMPTS_VERSION}`;
}

async function readImageEmbedding(db, id) {
  try {
    const existing = await db.getEmbedding(id);
    if (!isVector(existing)) return { vector: null, norm: null };
    const normalized = normalizeVector(existing);
    return { vector: normalized.vector, norm: normalized.norm };
  } catch (err) {
    console.warn('[vlm] CLIP-Bild-Embedding konnte nicht gelesen werden.', id, err);
    return { vector: null, norm: null };
  }
}

function classifyZsFields(imgEmbedding, zsAssets) {
  const place = classifyZeroShot('place', PLACE_CATEGORIES, imgEmbedding, zsAssets);
  const activity = classifyZeroShot('activity', ACTIVITY_CATEGORIES, imgEmbedding, zsAssets);
  return {
    place,
    activity,
    chosen: { place: place.chosen, activity: activity.chosen }
  };
}

function classifyZeroShot(field, categories, imgEmbedding, zsAssets) {
  if (!imgEmbedding || !zsAssets?.vectors?.[field]) return { rows: [], chosen: null };
  const rows = [];
  for (const category of categories) {
    const catEmb = zsAssets.vectors[field][category];
    if (!catEmb) continue;
    rows.push({ category, sim: dot(imgEmbedding, catEmb) });
  }
  rows.sort((a, b) => b.sim - a.sim || a.category.localeCompare(b.category));
  if (rows.length === 0) return { rows, chosen: null };
  const best = rows[0];
  const second = rows[1] || { sim: -Infinity };
  const absGap = best.sim - TAU_ABS[field];
  const marginGap = (best.sim - second.sim) - TAU_MARGIN[field];
  const stable = absGap >= EPS_DECISION && marginGap >= EPS_DECISION;
  return { rows, chosen: stable ? best.category : null };
}

async function loadFlorence(onProgress) {
  return loadModel(FLORENCE_MODEL_KEY, async ({ transformers, device, onProgress: progress }) => {
    const { Florence2ForConditionalGeneration, AutoProcessor, load_image } = transformers;
    if (!Florence2ForConditionalGeneration || !AutoProcessor || !load_image) {
      throw new Error('Transformers.js exportiert Florence2ForConditionalGeneration/AutoProcessor/load_image nicht.');
    }

    const ladder = device === 'webgpu' ? DTYPE_LADDER.webgpu : DTYPE_LADDER.wasm;
    let lastError = null;
    for (const variant of ladder) {
      try {
        const common = {
          revision: MODEL_REVISION,
          progress_callback: progressAdapter(progress || onProgress)
        };
        const processor = await AutoProcessor.from_pretrained(MODEL_ID, common);
        const model = await Florence2ForConditionalGeneration.from_pretrained(MODEL_ID, {
          ...common,
          device: variant.device,
          dtype: variant.dtype
        });
        return {
          processor,
          model,
          load_image,
          device: variant.device,
          dtypeLabel: variant.label,
          async dispose() {
            try { await model.dispose?.(); } catch (_) {}
          }
        };
      } catch (err) {
        lastError = err;
        try { progress?.({ status: 'dtype-fallback', key: FLORENCE_MODEL_KEY, variant: variant.label, error: readableReason(err, 'Ladefehler') }); } catch (_) {}
      }
    }
    throw lastError || new Error('Kein Florence-2-dtype-Pfad konnte geladen werden.');
  }, onProgress);
}

async function generateCaption(florence, db, id) {
  const payload = await withRetry(() => generateTask(florence, db, id, TASK_MORE_DETAILED_CAPTION), 1);
  const caption = extractTaskText(payload.result, TASK_MORE_DETAILED_CAPTION).trim();
  if (!caption) throw new Error('Florence-2 lieferte eine leere Caption');
  return caption;
}

async function generateOd(florence, db, id) {
  const payload = await withRetry(() => generateTask(florence, db, id, TASK_OD), 1);
  return extractOd(payload.result, payload.imageSize);
}

async function generateTask(florence, db, id, task) {
  const blob = await db.getThumb(id);
  if (!blob) throw new Error('Thumbnail nicht verfügbar');
  const image = await loadImageFromBlob(florence.load_image, blob);
  const prompts = florence.processor.construct_prompts(task);
  const inputs = await florence.processor(image, prompts);
  const generated = await florence.model.generate({
    ...inputs,
    max_new_tokens: MAX_NEW_TOKENS[task],
    do_sample: false,
    num_beams: 1
  });
  const text = florence.processor.batch_decode(generated, { skip_special_tokens: false })[0];
  const imageSize = image?.size || [image?.width, image?.height].filter((v) => Number.isFinite(v));
  return { result: florence.processor.post_process_generation(text, task, imageSize), imageSize };
}

async function loadImageFromBlob(loadImage, blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function withRetry(fn, retries) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fn(); }
    catch (err) { last = err; if (attempt < retries) await yieldToLoop(); }
  }
  throw last;
}

function extractTaskText(result, task) {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  const value = result[task];
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) if (typeof v === 'string') return v;
  }
  for (const v of Object.values(result)) if (typeof v === 'string') return v;
  return '';
}

function extractOd(result, imageSize) {
  const od = result?.[TASK_OD] || result || {};
  const labels = Array.isArray(od.labels) ? od.labels.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const boxes = Array.isArray(od.bboxes) ? od.bboxes : Array.isArray(od.boxes) ? od.boxes : [];
  const bboxes = boxes.map((box) => normalizeBox(box, imageSize)).filter(Boolean);
  const n = Math.min(labels.length, bboxes.length);
  return { labels: labels.slice(0, n), bboxes: bboxes.slice(0, n) };
}

function normalizeBox(box, imageSize) {
  if (!Array.isArray(box) && !(box && typeof box.length === 'number')) return null;
  const arr = Array.from(box).map((v) => Number(v));
  if (arr.length < 4 || arr.some((v) => !Number.isFinite(v))) return null;
  let [x1, y1, x2, y2] = arr;
  // Florence-2 post_process_generation gibt typischerweise Pixelkoordinaten aus;
  // falls schon normiert, bleibt die Division aus.
  const maxCoord = Math.max(Math.abs(x1), Math.abs(y1), Math.abs(x2), Math.abs(y2));
  if (maxCoord > 1) {
    const size = Array.isArray(imageSize) ? imageSize : [];
    const w = Number(size[0]) || maxCoord || 1;
    const h = Number(size[1]) || maxCoord || 1;
    x1 /= w; x2 /= w; y1 /= h; y2 /= h;
  }
  const a = clamp01(Math.min(x1, x2));
  const b = clamp01(Math.min(y1, y2));
  const c = clamp01(Math.max(x1, x2));
  const d = clamp01(Math.max(y1, y2));
  if (c <= a || d <= b) return null;
  return [a, b, c, d];
}

function normalizeRaw(raw) {
  return {
    caption: typeof raw?.caption === 'string' ? raw.caption : '',
    odLabels: Array.isArray(raw?.odLabels) ? raw.odLabels.map((x) => String(x || '').trim()).filter(Boolean) : [],
    odBboxes: Array.isArray(raw?.odBboxes) ? raw.odBboxes.map((b) => normalizeBox(b)).filter(Boolean) : [],
    modelId: typeof raw?.modelId === 'string' ? raw.modelId : '',
    ts: Number.isFinite(raw?.ts) ? raw.ts : 0
  };
}

function normalizeOdObjects(raw) {
  const labels = raw.odLabels || [];
  const boxes = raw.odBboxes || [];
  const n = Math.min(labels.length, boxes.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const box = boxes[i];
    const areaRatio = clamp01((box[2] - box[0]) * (box[3] - box[1]));
    out.push({ label: labels[i], box, areaRatio });
  }
  return out;
}

function odMetrics(objects) {
  let maxBoxAreaRatio = 0;
  let sumBoxAreaRatio = 0;
  let personCountFromOd = 0;
  for (const obj of objects || []) {
    maxBoxAreaRatio = Math.max(maxBoxAreaRatio, obj.areaRatio || 0);
    sumBoxAreaRatio += obj.areaRatio || 0;
    if (matchesAny(obj.label, ['person', 'people', 'man', 'woman', 'child', 'boy', 'girl'])) personCountFromOd++;
  }
  return {
    objectCount: objects.length,
    maxBoxAreaRatio,
    sumBoxAreaRatio: clamp01(sumBoxAreaRatio),
    personCountFromOd
  };
}

function deriveShotType(caption, metrics, photo, degradedOd, odLabels = []) {
  if (!caption) return null;

  let shotType;
  if (matchesAny(caption, SHOT_KEYWORDS.detailExplicit)) {
    shotType = 'detail';
  } else if (matchesAny(caption, SHOT_KEYWORDS.wideStrong)) {
    shotType = 'wide';
  } else {
    const weakCount = countDistinctMatches(caption, SHOT_KEYWORDS.wideWeak);
    if (weakCount >= 2 && metrics.maxBoxAreaRatio < 0.25) {
      shotType = 'wide';
    } else if (aspectRatio(photo) >= 1.7 && hasAspectWideSignal(caption)) {
      shotType = 'wide';
    } else if (!degradedOd && metrics.maxBoxAreaRatio >= 0.45 && !hasDetailBlocker(caption, odLabels)) {
      shotType = 'detail';
    } else if (!degradedOd && (metrics.objectCount === 0 || (metrics.sumBoxAreaRatio <= 0.20 && metrics.objectCount <= 5))) {
      shotType = 'wide';
    } else {
      shotType = 'medium';
    }
  }

  if (
    photo?.stream === 'P' &&
    (photo.faces?.maxBoxRatio ?? 0) >= 0.12 &&
    shotType === 'wide' &&
    !matchesAny(caption, SHOT_KEYWORDS.faceWideExceptions)
  ) {
    shotType = 'medium';
  }
  return shotType;
}

function hasAspectWideSignal(caption) {
  return matchesAny(caption, SHOT_KEYWORDS.wideStrong) ||
    matchesAny(caption, SHOT_KEYWORDS.wideWeak) ||
    matchesAny(caption, SHOT_KEYWORDS.placeRelevant);
}

function hasDetailBlocker(caption, odLabels) {
  const source = `${caption || ''} ${(odLabels || []).join(' ')}`;
  return matchesAny(source, DETAIL_BLOCKERS);
}

function deriveMood(caption, photo) {
  if (!caption) return null;
  if (matchesAny(caption, MOOD_KEYWORDS.negative)) return 'negative';
  if (matchesAny(caption, MOOD_KEYWORDS.positive)) return 'positive';
  if ((photo?.stream === 'P' || photo?.stream === 'M') && (photo.faces?.smile ?? 0) >= 0.6) return 'positive';
  return 'neutral';
}

function deriveMomentScore({ caption, activity, mood, place, shotType, photo }) {
  if (!caption) return null;

  const activityScore = ACTIVITY_SCORE[activity ?? 'null'] ?? ACTIVITY_SCORE.null;
  const interactionScore = deriveInteractionScore(caption, photo);
  const faceScore = deriveFaceScore(photo);
  const visualRoleScore = deriveVisualRoleScore({ activity, mood, place, shotType, photo });
  const streamBonus = deriveStreamBonus({ place, shotType, photo });

  return clamp01(
    MOMENT_WEIGHTS.activity * activityScore +
    MOMENT_WEIGHTS.interaction * interactionScore +
    MOMENT_WEIGHTS.face * faceScore +
    MOMENT_WEIGHTS.visualRole * visualRoleScore +
    streamBonus
  );
}

function deriveInteractionScore(caption, photo) {
  if (matchesAny(caption, INTERACTION_KEYWORDS)) return 0.80;
  if ((photo?.faces?.count ?? 0) >= 2) return 0.55;
  return 0.30;
}

function deriveVisualRoleScore({ activity, mood, place, shotType, photo }) {
  if ((photo?.stream === 'P' || photo?.stream === 'M') && mood === 'positive' && (shotType === 'detail' || shotType === 'medium')) return 0.85;
  if (shotType === 'wide' && ['beach', 'mountains', 'water', 'city', 'nature'].includes(place)) return 0.80;
  if (place === 'landmark') return 0.80;
  if (activity === 'sightseeing') return 0.75;
  if (activity === 'eating_drinking' && shotType === 'detail') return 0.70;
  if (activity === 'driving_transport' || activity === 'walking') return 0.60;
  if (place !== null) return 0.55;
  return 0.40;
}

function deriveFaceScore(photo) {
  if (!photo?.faces || photo.stageFails?.faces) return 0.50;
  if (photo.stream === 'S') return 0.45;
  return clamp01(0.5 + 0.5 * (photo.faces.smile ?? 0) - (photo.faces.blink ? 0.25 : 0));
}

function deriveStreamBonus({ place, shotType, photo }) {
  if (photo?.stream === 'P' && (photo.faces?.smile ?? 0) > 0.4 && !photo.faces?.blink) return 0.05;
  if (photo?.stream === 'M' && place !== null && (photo.faces?.count ?? 0) > 0) return 0.05;
  if (photo?.stream === 'S' && place !== null && shotType === 'wide') return 0.05;
  return 0;
}

function fallbackVlm(raw) {
  return {
    caption: typeof raw?.caption === 'string' ? raw.caption : '',
    shotType: null,
    activity: null,
    mood: null,
    place: null,
    momentScore: null
  };
}

function makeZsDebug({ zs, place, activity, caption, odLabels, imgEmbeddingNorm }) {
  return {
    place: zs.place.rows,
    activity: zs.activity.rows,
    chosen: { place, activity },
    thresholds: { TAU_ABS, TAU_MARGIN, EPS_DECISION },
    imgEmbeddingNorm: Number.isFinite(imgEmbeddingNorm) ? imgEmbeddingNorm : null,
    captionHint: { caption, odLabels }
  };
}

function rememberDebug(photoId, debug) {
  if (!photoId) return;
  debugStore.set(photoId, debug);
}

function installZsDebugHelper() {
  if (typeof window === 'undefined') return;
  window.__vlmZsDebug = (photoId) => {
    const data = debugStore.get(photoId) || null;
    if (!data) {
      console.warn('[vlm-zs] Kein Debug-Datensatz für photoId:', photoId);
      return null;
    }
    try { console.table(data.place); } catch (_) {}
    try { console.table(data.activity); } catch (_) {}
    return data;
  };
}

function logDiagnosticContradictions(photoId, caption, odLabels, chosen) {
  const hintSource = `${caption || ''} ${(odLabels || []).join(' ')}`;
  const placeHints = matchingHintCategories('place', hintSource);
  const activityHints = matchingHintCategories('activity', hintSource);
  if (placeHints.length && (!chosen.place || !placeHints.includes(chosen.place))) {
    console.info('[vlm-zs] Diagnosehinweis place: Caption/OD-Signal weicht vom Zero-Shot-Tag ab.', { photoId, chosen: chosen.place, hints: placeHints });
  }
  if (activityHints.length && (!chosen.activity || !activityHints.includes(chosen.activity))) {
    console.info('[vlm-zs] Diagnosehinweis activity: Caption/OD-Signal weicht vom Zero-Shot-Tag ab.', { photoId, chosen: chosen.activity, hints: activityHints });
  }
}

function matchingHintCategories(field, text) {
  const out = [];
  for (const [category, words] of Object.entries(CAPTION_HINT_KEYWORDS[field] || {})) {
    if (matchesAny(text, words)) out.push(category);
  }
  return out;
}

function matchesAny(text, words) {
  if (!text || !words || words.length === 0) return false;
  return words.some((word) => keywordRegex(word).test(text));
}

function countDistinctMatches(text, words) {
  if (!text || !words) return 0;
  let n = 0;
  for (const word of words) if (keywordRegex(word).test(text)) n++;
  return n;
}

const regexCache = new Map();
function keywordRegex(word) {
  const key = String(word || '').toLowerCase().trim();
  if (regexCache.has(key)) return regexCache.get(key);

  let body;
  if (key.endsWith('-')) {
    body = escapeRegExp(key.slice(0, -1)) + '[a-z]*';
  } else {
    const tokens = key.split(/\s+/).filter(Boolean).map(escapeRegExp);
    if (tokens.length === 0) body = '(?!)';
    else {
      const last = tokens[tokens.length - 1];
      tokens[tokens.length - 1] = `${last}(?:s|es)?`;
      body = tokens.join('\\s+');
    }
  }
  const re = new RegExp(`(^|[^a-z0-9])${body}($|[^a-z0-9])`, 'i');
  regexCache.set(key, re);
  return re;
}

function normalizeVector(input) {
  const src = input instanceof Float32Array ? input : new Float32Array(input);
  const out = new Float32Array(src.length);
  let normSq = 0;
  for (let i = 0; i < src.length; i++) normSq += src[i] * src[i];
  const norm = Math.sqrt(normSq) || 1;
  for (let i = 0; i < src.length; i++) out[i] = src[i] / norm;
  return { vector: out, norm };
}

function dot(a, b) {
  const n = Math.min(a?.length || 0, b?.length || 0);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function isVector(v) {
  return v && typeof v.length === 'number' && v.length > 0;
}

function isVectorOfDim(v, dim) {
  return isVector(v) && v.length === dim;
}

function normalizeStageFails(photo) {
  if (!photo.stageFails || typeof photo.stageFails !== 'object') photo.stageFails = {};
  return photo.stageFails;
}

function progressAdapter(onProgress) {
  return (info) => {
    try { onProgress?.(info || {}); } catch (_) {}
  };
}

function readableReason(err, fallback) {
  const msg = err && err.message ? String(err.message) : '';
  return msg || fallback;
}

function aspectRatio(photo) {
  const w = Number(photo?.width);
  const h = Number(photo?.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 0;
  return Math.max(w, h) / Math.min(w, h);
}

function extractTransformersVersion(url) {
  const m = String(url || '').match(/@huggingface\/transformers@([^/?#]+)/);
  return m ? m[1] : 'unknown';
}

function performanceNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function yieldToLoop() { return new Promise((resolve) => setTimeout(resolve, 0)); }
function clamp01(x) { return Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0; }
function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
