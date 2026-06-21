// js/ctx.js
// Nur der Context-Export — kein State hier.
// State und Reducer leben in app.js, um Zirkel-Imports zu vermeiden.

import { createContext } from './deps.js';

/** @type {import('preact').Context<{state: AppState, dispatch: Function}>} */
export const AppContext = createContext(null);

/**
 * @typedef {Object} AppState
 * @property {'start'|'processing'|'review'|'export'} screen
 * @property {Photo[]}  photos
 * @property {Presets}  presets
 * @property {Pipeline} pipeline
 * @property {Photo[]}  selection
 * @property {Photo[]}  rejected
 * @property {Override[]} overrides
 * @property {Chapter[]} chapters
 * @property {Scene[]} scenes
 * @property {Person[]} persons
 * @property {'hydrating'|'ready'|'recovery'} hydration
 * @property {string|null} recoveryReason
 * @property {string|null} worksetSignature
 * @property {string|null} worksetEpoch
 * @property {number|null} worksetRevision
 * @property {boolean} worksetLocked
 * @property {number|null} worksetSessionStartToken
 * @property {string|null} worksetStartError
 */

/**
 * Kapitel (E4 schreibt start/end/count; chronologisch).
 * @typedef {Object} Chapter
 * @property {number} id
 * @property {number} start  — frühestes takenAt im Kapitel (epoch ms)
 * @property {number} end    — spätestes takenAt im Kapitel (epoch ms)
 * @property {number} count  — Anzahl Bilder
 */


/**
 * Szene (E13.1): zusammenhängende Aufnahme-Situation strikt innerhalb eines Tags.
 * @typedef {Object} Scene
 * @property {string} id
 * @property {number} chapterId
 * @property {number} index
 * @property {number} start
 * @property {number} end
 * @property {number} count
 * @property {number} reprCount
 * @property {string|null} place
 * @property {string|null} activity
 * @property {string[]} photoIds
 * @property {string[]} reprIds
 */

/**
 * Photo-Record (§10.2). Die schreibende Etappe steht je Feld dahinter.
 * Embeddings sind NIE Teil des Records (eigene IDB-Stores).
 * @typedef {Object} Photo
 * @property {string}  id            E2: SHA-1 aus `${name}|${size}|${lastModified}`
 * @property {string}  name          E2
 * @property {number}  size          E2
 * @property {number}  lastModified  E2
 * @property {number}  width         E2 (nach Orientierung)
 * @property {number}  height        E2 (nach Orientierung)
 * @property {number|null} takenAt   E2: EXIF DateTimeOriginal (epoch ms), Fallback lastModified
 * @property {{lat:number, lon:number, alt:number|null, dir:number|null}|null} gps  E2; alt/dir ab G0.5. Altbestände können alt/dir undefined haben; Leser behandeln undefined wie null.
 * @property {{focalLength:number|null, focalLength35mm:number|null, digitalZoomRatio:number|null, lensModel:string|null, make:string|null, model:string|null, fNumber:number|null, iso:number|null, exposureTime:number|null}|null} exifOptics  G0.5/R2: konservierte Optik-Rohfelder inkl. Blende/ISO/Belichtungszeit; fehlende Tags null, keine Interpretation.
 * @property {{dateTimeOriginalRaw:string|null, offsetTimeOriginal:string|null, gpsDateStamp:string|null, gpsTimeStamp:string|null}|null} exifTime  G0.5: konservierte Zeit-Rohfelder; keine inferredUtc/timeConfidence-Ableitungen.
 * @property {'ok'|'failed'} status  E2+: Einzelbild-Fehler, Pipeline läuft weiter
 * @property {string|null} failReason  E2+: lesbarer Verarbeitungsfehler-Grund (nur bei status 'failed'); getrennt von rejectReason
 * @property {Object.<string,string>} stageFails  R: stageKey → lesbarer Analysefehler-Grund. BERECHNET ⇔ Ergebnisfeld gesetzt ODER stageFails[stageKey] vorhanden.
 * @property {{sharpness:number, exposure:number}|null} tech  E4 (0–1)
 * @property {number|null} chapterId E4/E13.1: Tag/Kapitel
 * @property {string|null} sceneId E13.1: Szene innerhalb des Tags ('scene-<chapterId>-<index>')
 * @property {{count:number, maxBoxRatio:number, blink:boolean, smile:number}|null} faces  E5
 * @property {'P'|'S'|'M'|null} stream  E5
 * @property {string|null} clusterId  E6
 * @property {boolean} repr          E6: Cluster-Repräsentant
 * @property {{shotType:'wide'|'medium'|'detail'|null, activity:string|null, mood:'positive'|'neutral'|'negative'|null, place:'beach'|'mountains'|'water'|'city'|'landmark'|'nature'|'indoor'|null, momentScore:number|null, caption:string}|null} vlm  E8 (nur Ableitungen + Caption-Kopie; Rohdaten in IDB vlmRaw)
 * @property {string[]} personIds    E11 (bis dahin [])
 * @property {'establishing'|'action'|'detail'|'hero'|'transition'|null} beat  E9
 * @property {boolean} picked        E9 + Overrides
 * @property {string|null} reason    E9: lesbare Begründung
 * @property {'duplicate'|'blurry'|'budget'|'redundant'|'stream'|null} rejectReason
 */

/**
 * @typedef {Object} Presets
 * @property {'chronicle'|'balanced'|'highlights'} selectionMode
 *   τ-Schwelle und Szenen-Malus; Reihenfolge bleibt chronologisch.
 *   Beeinflusst NIE die Reihenfolge — Chronologie ist immer Sortierung.
 * @property {'people'|'balanced'|'places'} focus
 * @property {'strict'|'moment'} techStrict
 * @property {number|null} maxPickCap Optionales Sicherheitslimit; null = Auto-Umfang ohne Cap. Legacy targetCount wird nicht als Cap migriert.
 * @property {number} tauSliderPos τ-Reglerposition in [-1,+1]; 0 = Auto-Punkt, negativ = mehr behalten, positiv = strenger.
 */

/**
 * @typedef {Object} PipelineStageState
 * @property {'pending'|'active'|'done'|'skipped'|'error'} status
 * @property {string} implVersion
 * @property {string|null} error
 */

/**
 * @typedef {Object} Pipeline
 * @property {'idle'|'running'|'paused'|'done'|'error'} status
 * @property {number} stage     — aktive Stufe als Index (-1 = keine aktive Stufe)
 * @property {string|null} activeKey
 * @property {Object.<string|number,{done:number,total:number}>} progress
 * @property {Object.<string,PipelineStageState>} stages
 * @property {string|null} [error]
 */

/**
 * @typedef {Object} Person
 * @property {string} id
 * @property {string} label
 * @property {string|null} sampleThumbId
 * @property {string[]} photoIds
 */


/**
 * Review-Override (E10; einheitliches, resume-festes Payload-Schema).
 * @typedef {Object} Override
 * @property {'swap'|'include'|'exclude'|'reorder'} type
 * @property {string} photoId
 * @property {number} ts
 * @property {string|null} prevReason
 */
