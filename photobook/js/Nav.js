// js/Nav.js
import { h, useContext, htm as _htm } from './deps.js';
const html = _htm.bind(h);
import { AppContext } from './ctx.js';

const STEPS = [
  { id: 'start',      label: 'Laden',       num: '1' },
  { id: 'processing', label: 'Verarbeitung', num: '2' },
  { id: 'review',     label: 'Review',       num: '3' },
  { id: 'export',     label: 'Export',       num: '4' },
];

// Reihenfolge für "done"-Bestimmung
const SCREEN_ORDER = ['start', 'processing', 'review', 'export'];

function getStepState(stepId, currentScreen) {
  const currentIdx = SCREEN_ORDER.indexOf(currentScreen);
  const stepIdx    = SCREEN_ORDER.indexOf(stepId);
  if (stepIdx === currentIdx) return 'active';
  if (stepIdx < currentIdx)  return 'done';
  return 'pending';
}

// Einfache SVG-Icons als Inline-Komponenten
function IconCamera() {
  return html`
    <svg class="nav-brand-icon" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="7" width="22" height="16" rx="3" stroke="currentColor" stroke-width="1.5"/>
      <circle cx="13" cy="15" r="4" stroke="currentColor" stroke-width="1.5"/>
      <path d="M9 7V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.5"/>
      <circle cx="20" cy="11" r="1" fill="currentColor"/>
    </svg>
  `;
}

export function Nav({ theme = 'dark', onToggleTheme }) {
  const { state, dispatch } = useContext(AppContext);
  const { screen, photos, pipeline } = state;

  function navigate(screenId) {
    dispatch({ type: 'SET_SCREEN', screen: screenId });
  }

  // Status-Pill Inhalt
  const photosLoaded = photos.length > 0;
  const pipelineRunning = pipeline.status === 'running';

  return html`
    <nav class="nav" role="navigation" aria-label="Haupt-Navigation">

      <!-- Wortmarke -->
      <div class="nav-brand">
        <${IconCamera} />
        <span class="nav-brand-name">
          <strong>Curata</strong>
        </span>
      </div>

      <div class="nav-divider" aria-hidden="true"></div>

      <!-- Film-Strip Steps -->
      <ol class="nav-steps" role="list">
        ${STEPS.map(step => {
          const state_ = getStepState(step.id, screen);
          return html`
            <li class=${'nav-step ' + state_} key=${step.id}>
              <button
                class="nav-step-btn"
                onClick=${() => navigate(step.id)}
                aria-current=${state_ === 'active' ? 'step' : undefined}
                aria-label=${'Schritt ' + step.num + ': ' + step.label}
                title=${step.label}
              >
                <span class="step-frame" aria-hidden="true">
                  ${state_ === 'done'
                    ? html`<svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4l3 3 5-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>`
                    : step.num
                  }
                </span>
                <span class="step-label">${step.label}</span>
              </button>
            </li>
          `;
        })}
      </ol>

      <!-- Status-Pill -->
      <div class="nav-status">
        ${pipelineRunning
          ? html`
              <div class="status-pill">
                <span class="status-dot amber"></span>
                Verarbeitung läuft
              </div>`
          : photosLoaded
          ? html`
              <div class="status-pill">
                <span class="status-dot green"></span>
                <span>${photos.length}</span> Fotos
              </div>`
          : html`
              <div class="status-pill">
                <span class="status-dot"></span>
                Keine Fotos
              </div>`
        }
      </div>

      <button
        class="theme-toggle"
        type="button"
        onClick=${onToggleTheme}
        aria-label=${theme === 'light' ? 'Dunkles Theme aktivieren' : 'Helles Theme aktivieren'}
        title=${theme === 'light' ? 'Dunkles Theme' : 'Helles Theme'}
      >
        <span aria-hidden="true">${theme === 'light' ? '☾' : '☼'}</span>
        <span>${theme === 'light' ? 'Dark' : 'Light'}</span>
      </button>

    </nav>
  `;
}
