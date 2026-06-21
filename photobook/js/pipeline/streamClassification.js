// js/pipeline/streamClassification.js
// Single Source of Truth fuer P/S/M-Stream-Klassifikation aus Face-Metadaten.
// Neutral gehalten, damit Pipeline-Stufe und UI-Invalidierung dieselbe Schwelle nutzen.

export const FOCUS_FACTORS = Object.freeze({ people: 0.5, balanced: 1, places: 2 });

const P_THRESHOLD_BASE = 0.08;
const S_THRESHOLD_BASE = 0.02;

export function focusFactor(focusOrFactor) {
  if (Number.isFinite(Number(focusOrFactor))) return Number(focusOrFactor);
  return FOCUS_FACTORS[focusOrFactor] ?? FOCUS_FACTORS.balanced;
}

export function classifyStreamFromFaces(faces, focusOrFactor = 'balanced') {
  const count = Number(faces?.count ?? 0);
  const maxBoxRatio = Number(faces?.maxBoxRatio ?? 0);
  const factor = focusFactor(focusOrFactor);
  const pThreshold = P_THRESHOLD_BASE * factor;
  const sThreshold = S_THRESHOLD_BASE * factor;

  if (maxBoxRatio > pThreshold) return 'P';
  if (count === 0 || maxBoxRatio < sThreshold) return 'S';
  return 'M';
}
