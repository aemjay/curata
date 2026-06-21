// js/beats.js
// Single Source of Truth für Beat-Terminologie. Bewusst nicht in einer
// Komponente verortet, damit UI-Komponenten und Selektionsbegründungen die
// Labels ohne Komponenten-zu-Komponenten-Abhängigkeit teilen können.

export const BEATS = ['establishing', 'action', 'detail', 'hero', 'transition'];

export function beatLabel(beat) {
  if (beat === 'establishing') return 'Aufmacher';
  if (beat === 'action') return 'Aktion';
  if (beat === 'detail') return 'Detail';
  if (beat === 'hero') return 'Hero';
  if (beat === 'transition') return 'Übergang';
  return 'ohne Beat';
}
