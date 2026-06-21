// js/app.js
import { h, render, useEffect, useReducer, useState, htm as _htm } from './deps.js';

const html = _htm.bind(h);

import { AppContext }       from './ctx.js';
import { Nav }              from './Nav.js';
import { StartScreen }      from './screens/StartScreen.js';
import { ProcessingScreen } from './screens/ProcessingScreen.js';
import { ReviewScreen }     from './screens/ReviewScreen.js';
import { ExportScreen }     from './screens/ExportScreen.js';
import { hydrateWorkset }    from './ingest.js';

/* =====================================================
   INITIAL STATE
   ===================================================== */
const DEFAULT_PRESETS = {
  // 'chronicle' | 'balanced' | 'highlights'
  // Steuert Floor + Konzentrations-Malus λ im Solver; E13.2 nutzt qualitäts-adaptives τ.
  // Beeinflusst NIE die Reihenfolge — Chronologie ist immer Sortierung.
  selectionMode: 'balanced',
  focus:         'balanced',   // 'people' | 'balanced' | 'places'
  techStrict:    'moment',     // 'strict' | 'moment'
  maxPickCap:    null,         // optionales Sicherheitslimit; null = Auto-Umfang ohne Cap
  tauSliderPos:  0             // [-1,+1], 0 = Auto-Punkt; negativ = mehr behalten, positiv = strenger
};

const initialState = {
  screen: 'start',
  photos: [],
  presets: { ...DEFAULT_PRESETS },
  pipeline: {
    status: 'idle',
    stage:  -1,
    activeKey: null,
    progress: {},
    stages: {},
    error: null
  },
  selection: [],
  rejected:  [],
  overrides: [],
  chapters:  [],
  scenes:    [],
  persons:   [],
  hydration: 'hydrating',            // 'hydrating' | 'ready' | 'recovery'
  recoveryReason: null,
  worksetSignature: null,
  worksetEpoch: null,
  worksetRevision: null,
  worksetLocked: false,
  worksetSessionStartToken: null,
  worksetStartPreviousStatus: null,
  worksetStartError: null
};


function normalizeOverride(payload) {
  const raw = payload || {};
  const type = ['swap', 'include', 'exclude', 'reorder'].includes(raw.type) ? raw.type : 'include';
  const photoId = raw.photoId || raw.toId || raw.fromId || null;
  return {
    type,
    photoId,
    ts: raw.ts || Date.now(),
    prevReason: raw.prevReason ?? raw.reason ?? null
  };
}

function normalizeOverrides(payload) {
  return (Array.isArray(payload) ? payload : [])
    .map(normalizeOverride)
    .filter((ov) => ov.photoId);
}

/* =====================================================
   REDUCER
   ===================================================== */
export function reducer(state, action) {
  switch (action.type) {
    case 'HYDRATE_WORKSET': {
      const payload = action.payload || {};
      const persisted = payload.pipelineState || null;
      return {
        ...state,
        screen: 'start',
        hydration: payload.hydration === 'ready' ? 'ready' : 'recovery',
        recoveryReason: payload.recoveryReason || null,
        worksetSignature: payload.worksetSignature || null,
        worksetEpoch: payload.worksetEpoch || null,
        worksetRevision: Number.isInteger(payload.worksetRevision) ? payload.worksetRevision : null,
        worksetLocked: payload.locked === true,
        worksetSessionStartToken: null,
        worksetStartPreviousStatus: null,
        worksetStartError: null,
        photos: payload.photos || [],
        chapters: payload.chapters || [],
        scenes: payload.scenes || [],
        persons: payload.persons || [],
        overrides: normalizeOverrides(payload.overrides),
        presets: payload.presets ? { ...state.presets, ...payload.presets } : state.presets,
        pipeline: {
          status: payload.pipelineStatus || 'idle',
          stage: -1,
          activeKey: null,
          progress: {},
          stages: persisted?.stages || {},
          error: null
        }
      };
    }
    case 'WORKSET_PIPELINE_STARTING':
      return {
        ...state,
        worksetSessionStartToken: action.startToken,
        worksetStartPreviousStatus: state.pipeline.status,
        worksetStartError: null
      };
    case 'WORKSET_PIPELINE_LOCK_ESTABLISHED':
      if (state.worksetSessionStartToken !== action.startToken) return state;
      return {
        ...state,
        worksetSessionStartToken: null,
        worksetLocked: true,
        worksetStartError: null,
        worksetStartPreviousStatus: null
      };
    case 'WORKSET_PIPELINE_START_ABORTED':
      if (state.worksetSessionStartToken !== action.startToken) return state;
      return {
        ...state,
        screen: 'start',
        worksetSessionStartToken: null,
        worksetStartError: action.error || 'Verarbeitung konnte nicht gestartet werden.',
        worksetStartPreviousStatus: null,
        pipeline: {
          ...state.pipeline,
          status: state.worksetLocked
            ? (state.worksetStartPreviousStatus === 'done' ? 'done' : 'paused')
            : 'idle',
          error: null
        }
      };
    case 'ADD_PHOTOS': {
      const incoming = action.payload || [];
      if (incoming.length === 0) return state;
      const known = new Map(state.photos.map((photo) => [photo.id, photo]));
      for (const photo of incoming) known.set(photo.id, photo);
      return {
        ...state,
        photos: Array.from(known.values()),
        worksetEpoch: action.worksetEpoch || state.worksetEpoch,
        worksetRevision: Number.isInteger(action.worksetRevision) ? action.worksetRevision : state.worksetRevision,
        worksetSignature: action.worksetSignature || state.worksetSignature,
        worksetLocked: false,
        worksetStartError: null,
        pipeline: { status: 'idle', stage: -1, activeKey: null, progress: {}, stages: {}, error: null }
      };
    }
    case 'REMOVE_PHOTOS': {
      const ids = new Set(action.ids || []);
      if (ids.size === 0) return state;
      return {
        ...state,
        photos: state.photos.filter((photo) => !ids.has(photo.id)),
        chapters: [], scenes: [], persons: [], overrides: [], selection: [], rejected: [],
        worksetEpoch: action.worksetEpoch || state.worksetEpoch,
        worksetRevision: Number.isInteger(action.worksetRevision) ? action.worksetRevision : state.worksetRevision,
        worksetSignature: action.worksetSignature || state.worksetSignature,
        worksetLocked: false,
        worksetStartError: null,
        pipeline: { status: 'idle', stage: -1, activeKey: null, progress: {}, stages: {}, error: null }
      };
    }
    case 'NEW_WORKSET':
      return {
        ...state,
        screen: 'start', photos: [], selection: [], rejected: [], overrides: [], chapters: [], scenes: [], persons: [],
        hydration: 'ready', recoveryReason: null,
        worksetEpoch: action.payload?.worksetEpoch || null,
        worksetRevision: 0,
        worksetSignature: action.payload?.worksetSignature || null,
        worksetLocked: false, worksetSessionStartToken: null, worksetStartPreviousStatus: null, worksetStartError: null,
        pipeline: { status: 'idle', stage: -1, activeKey: null, progress: {}, stages: {}, error: null }
      };
    case 'PRIVACY_CLEAR':
      return {
        ...initialState,
        hydration: 'ready'
      };
    case 'SET_SCREEN':
      return { ...state, screen: action.screen };
    case 'SET_PRESETS':
      return { ...state, presets: { ...state.presets, ...action.payload } };
    case 'SET_PHOTOS':
      return { ...state, photos: action.payload };
    case 'RESET_PIPELINE':
      return {
        ...state,
        pipeline: {
          status: 'idle',
          stage: -1,
          activeKey: null,
          progress: {},
          stages: {},
          error: null
        }
      };
    case 'UPDATE_PHOTOS': {
      // Teilmengen-Merge per id (§10.5): bestehende Records werden gemerged,
      // neue angehängt. Einfügereihenfolge bleibt stabil (Ingest-Reihenfolge).
      const incoming = action.payload || [];
      if (incoming.length === 0) return state;
      const map = new Map(state.photos.map((p) => [p.id, p]));
      for (const rec of incoming) {
        const prev = map.get(rec.id);
        map.set(rec.id, prev ? { ...prev, ...rec } : rec);
      }
      return { ...state, photos: Array.from(map.values()) };
    }
    case 'PIPELINE_STATE':
      return {
        ...state,
        pipeline: {
          ...state.pipeline,
          ...action.payload,
          progress: state.pipeline.progress || {}
        }
      };
    case 'PIPELINE_STAGE_PROGRESS':
      return {
        ...state,
        pipeline: {
          ...state.pipeline,
          stage: action.stage ?? state.pipeline.stage,
          activeKey: action.key ?? state.pipeline.activeKey,
          progress: {
            ...state.pipeline.progress,
            [action.stage]: action.progress ?? {},
            [action.key]: action.progress ?? {}
          }
        }
      };
    case 'PIPELINE_START':
      return { ...state, pipeline: { ...state.pipeline, status: 'running', stage: 0, error: null } };
    case 'PIPELINE_STAGE':
      return {
        ...state,
        pipeline: {
          ...state.pipeline,
          stage: action.stage,
          progress: { ...state.pipeline.progress, [action.stage]: action.progress ?? {} }
        }
      };
    case 'PIPELINE_PAUSE':
      return { ...state, pipeline: { ...state.pipeline, status: 'paused' } };
    case 'PIPELINE_RESUME':
      return { ...state, pipeline: { ...state.pipeline, status: 'running', error: null } };
    case 'PIPELINE_DONE':
      return { ...state, pipeline: { ...state.pipeline, status: 'done', activeKey: null, error: null } };
    case 'PIPELINE_ERROR':
      return { ...state, pipeline: { ...state.pipeline, status: 'error', error: action.error } };
    case 'SET_SELECTION':
      return { ...state, selection: action.payload };
    case 'SET_REJECTED':
      return { ...state, rejected: action.payload };
    case 'SET_OVERRIDES':
      return { ...state, overrides: normalizeOverrides(action.payload) };
    case 'RESET_PRESETS':
      return { ...state, presets: { ...DEFAULT_PRESETS } };
    case 'ADD_OVERRIDE': {
      const payload = normalizeOverride(action.payload);
      return payload.photoId ? { ...state, overrides: [...state.overrides, payload] } : state;
    }
    case 'TOGGLE_PICK': {
      if (!action.photoId) return state;
      const photo = state.photos.find((p) => p.id === action.photoId);
      const solverPicked = photo?.picked === true;
      const rest = state.overrides.filter((ov) =>
        ov.photoId !== action.photoId || (ov.type !== 'include' && ov.type !== 'exclude')
      );
      if (action.picked === solverPicked) {
        return { ...state, overrides: rest };
      }
      const payload = normalizeOverride({
        type: action.picked ? 'include' : 'exclude',
        photoId: action.photoId,
        prevReason: action.reason || null
      });
      return payload.photoId ? { ...state, overrides: [...rest, payload] } : { ...state, overrides: rest };
    }
    case 'SWAP_PICK': {
      const payload = normalizeOverride({
        type: 'swap',
        photoId: action.photoId || action.toId,
        prevReason: action.reason || null
      });
      return payload.photoId ? { ...state, overrides: [...state.overrides, payload] } : state;
    }
    case 'MOVE_PICK': {
      const payload = normalizeOverride({
        type: 'reorder',
        photoId: action.photoId,
        prevReason: action.reason || null
      });
      return payload.photoId ? { ...state, overrides: [...state.overrides, payload] } : state;
    }
    case 'SET_CHAPTERS':
      return { ...state, chapters: action.payload };
    case 'SET_SCENES':
      return { ...state, scenes: action.payload };
    case 'SET_PERSONS':
      return { ...state, persons: action.payload };
    default:
      console.warn('[reducer] unbekannte Action:', action.type);
      return state;
  }
}

/* =====================================================
   APP-KOMPONENTE
   ===================================================== */
const THEME_STORAGE_KEY = 'photobook.theme';

function initialTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch (err) {
    console.warn('[theme] localStorage nicht verfügbar:', err);
  }
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const normalized = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = normalized;
}

function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    applyTheme(theme);
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); }
    catch (err) { console.warn('[theme] Theme konnte nicht persistiert werden:', err); }
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    hydrateWorkset().then((payload) => {
      if (!cancelled) dispatch({ type: 'HYDRATE_WORKSET', payload });
    }).catch((error) => {
      if (!cancelled) dispatch({
        type: 'HYDRATE_WORKSET',
        payload: { hydration: 'recovery', recoveryReason: error?.message || 'Hydration fehlgeschlagen.' }
      });
    });
    return () => { cancelled = true; };
  }, []);

  const screenMap = {
    start:      html`<${StartScreen} />`,
    processing: html`<${ProcessingScreen} />`,
    review:     html`<${ReviewScreen} />`,
    export:     html`<${ExportScreen} />`,
  };

  return html`
    <${AppContext.Provider} value=${{ state, dispatch }}>
      <div class="app-root">
        <${Nav} theme=${theme} onToggleTheme=${() => setTheme((current) => current === 'light' ? 'dark' : 'light')} />
        <main class="screen-wrapper">
          ${screenMap[state.screen] ?? screenMap.start}
        </main>
      </div>
    <//>
  `;
}

/* =====================================================
   EINSTIEGSPUNKT
   ===================================================== */
if (typeof document !== 'undefined') {
  applyTheme(initialTheme());
  render(html`<${App} />`, document.getElementById('app'));
}
