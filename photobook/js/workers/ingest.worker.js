// js/workers/ingest.worker.js
// Einziger Worker des Projekts (§9.1).
// Aufgaben: Decode + Downscale (~512 px kürzere Seite), EXIF (exifr),
// JPEG-Thumb erzeugen. HEIC über libheif-WASM (Ebene 1 der Fallback-Leiter).
//
// CDN-URLs werden NICHT hier hartkodiert, sondern per init-Nachricht aus
// ingest.js übergeben (Quelle: deps.js). Damit bleibt deps.js die einzige
// Stelle mit Versions-Pins, ohne das UI-Framework in den Worker zu ziehen.

const THUMB_SHORT = 512;     // Ziel: kürzere Seite ~512 px
const JPEG_QUALITY = 0.82;

let EXIFR_URL = null;
let LIBHEIF_URL = null;

let _exifrPromise = null;    // Modul-Cache exifr
let _libheif = null;         // gecachtes libheif-Modul
let _libheifBroken = false;  // Import dauerhaft fehlgeschlagen → nicht erneut versuchen

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg) return;

  if (msg.type === 'init') {
    EXIFR_URL = msg.exifrUrl;
    LIBHEIF_URL = msg.libheifUrl;
    self.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'decode') {
    let result;
    try {
      result = await processFile(msg.id, msg.file, !!msg.isHeic);
    } catch (err) {
      // Sicherheitsnetz: jeder unerwartete Fehler wird als Einzelbild-Fehler
      // gemeldet, der Worker bleibt am Leben (§9.4).
      result = { ok: false, isHeic: !!msg.isHeic, error: String(err && err.message || err) };
    }
    self.postMessage({ type: 'result', id: msg.id, ...result });
    return;
  }
};

/**
 * Verarbeitet eine Datei zu Metadaten + Thumb-Blob.
 * Wirft nie nach außen; Fehler werden als { ok:false, … } zurückgegeben.
 */
async function processFile(id, file, isHeic) {
  // --- Pixel-Quelle bestimmen ---
  let oriented;   // { bitmap, width, height } — volle (orientierte) Auflösung
  if (isHeic) {
    if (_libheifBroken) {
      // Worker-seitiges libheif nicht verfügbar → Main-Thread soll übernehmen.
      return { ok: false, isHeic: true, heicUnavailable: true };
    }
    try {
      oriented = await decodeHeic(file);
    } catch (err) {
      if (err && err.__importFailed) {
        _libheifBroken = true;
        return { ok: false, isHeic: true, heicUnavailable: true, error: String(err.message) };
      }
      // libheif geladen, aber diese Datei ließ sich nicht dekodieren (z. B. defekt).
      return { ok: false, isHeic: true, decodeFailed: true, error: String(err && err.message || err) };
    }
  } else {
    try {
      oriented = await decodeStandard(file);
    } catch (err) {
      return { ok: false, isHeic: false, decodeFailed: true, error: String(err && err.message || err) };
    }
  }

  // --- Thumb erzeugen ---
  let thumbBlob;
  try {
    thumbBlob = await makeThumb(oriented.bitmap, oriented.width, oriented.height);
  } finally {
    if (oriented.bitmap && oriented.bitmap.close) oriented.bitmap.close();
  }

  // --- EXIF (Datum + GPS/Optik/Zeit-Rohfelder); Fehler hier sind nicht fatal ---
  const exif = await readExif(file);

  return {
    ok: true,
    isHeic,
    width: oriented.width,
    height: oriented.height,
    takenAt: exif.takenAt,
    gps: exif.gps,
    exifOptics: exif.exifOptics,
    exifTime: exif.exifTime,
    thumbBlob
  };
}

/* =====================================================
   STANDARD-DECODE (JPEG/PNG/WebP …)
   ===================================================== */
async function decodeStandard(file) {
  // imageOrientation:'from-image' → Maße entsprechen der dargestellten Lage (§10.2).
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

/* =====================================================
   HEIC-DECODE (libheif-WASM)
   ===================================================== */
async function getLibheif() {
  if (_libheif) return _libheif;
  let mod;
  try {
    mod = await import(/* webpackIgnore: true */ LIBHEIF_URL);
  } catch (err) {
    const e = new Error('libheif-Import fehlgeschlagen: ' + (err && err.message || err));
    e.__importFailed = true;
    throw e;
  }
  let lib = mod.default ?? mod;
  // Manche Builds exportieren eine Factory-Funktion oder ein Promise.
  try {
    if (typeof lib === 'function') lib = await lib();
    if (lib && typeof lib.then === 'function') lib = await lib;
    if (lib && !lib.HeifDecoder && lib.default && lib.default.HeifDecoder) lib = lib.default;
  } catch (err) {
    const e = new Error('libheif-Initialisierung fehlgeschlagen: ' + (err && err.message || err));
    e.__importFailed = true;
    throw e;
  }
  if (!lib || typeof lib.HeifDecoder !== 'function') {
    const e = new Error('libheif: HeifDecoder nicht gefunden');
    e.__importFailed = true;
    throw e;
  }
  _libheif = lib;
  return lib;
}

async function decodeHeic(file) {
  const lib = await getLibheif();   // wirft __importFailed wenn Modul nicht ladbar
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
      image.display(imageData, (out) => {
        if (!out) reject(new Error('HEIC: display fehlgeschlagen'));
        else resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
  // Speicher der libheif-Bildobjekte freigeben, falls API vorhanden.
  try { if (typeof image.free === 'function') image.free(); } catch (_) {}
  try { if (typeof decoder.free === 'function') decoder.free(); } catch (_) {}

  const bitmap = await createImageBitmap(imageData);
  return { bitmap, width, height };
}

/* =====================================================
   THUMB-ERZEUGUNG (OffscreenCanvas → JPEG)
   ===================================================== */
async function makeThumb(bitmap, width, height) {
  const { w, h } = targetSize(width, height, THUMB_SHORT);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
}

function targetSize(w, h, targetShort) {
  const short = Math.min(w, h);
  if (short <= targetShort) return { w, h };
  const scale = targetShort / short;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/* =====================================================
   EXIF (exifr) — Datum + GPS/Optik/Zeit-Rohfelder, robust pro Datei
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

function loadExifr() {
  if (!_exifrPromise) {
    _exifrPromise = import(/* webpackIgnore: true */ EXIFR_URL)
      .then((m) => m.default ?? m)
      .catch((err) => {
        // exifr nicht ladbar → kein EXIF, aber kein Abbruch.
        console.warn('[worker] exifr-Import fehlgeschlagen:', err);
        _exifrPromise = null; // erneuter Versuch beim nächsten Bild erlaubt
        return null;
      });
  }
  return _exifrPromise;
}

async function readExif(file) {
  const result = {
    takenAt: null,
    gps: null,
    exifOptics: emptyExifOptics(),
    exifTime: emptyExifTime()
  };
  const exifr = await loadExifr();
  if (!exifr) {
    result.takenAt = file.lastModified;
    return result;
  }

  try {
    // G0.5: Datum, GPS, Optik und Zeit-Rohfelder werden in EINEM Parse-Lauf gelesen.
    const parsed = await exifr.parse(file, { pick: EXIF_PICK, reviveValues: false });
    applyParsedExif(result, parsed);
  } catch (_) { /* EXIF-Fehler ignorieren; Decode bleibt gültig */ }

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
