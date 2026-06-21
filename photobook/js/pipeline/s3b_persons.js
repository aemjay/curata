// js/pipeline/s3b_persons.js
// Stufe 3b — persons bleibt bis Etappe 11 ein echter Registry-Stub.
// Keine Ableitungen, keine Persistenz, kein Done-Status.

export async function runPersonsStub({ photos, signal, onProgress }) {
  const total = photos ? photos.length : 0;
  if (total === 0) { onProgress?.(0, 0); return { status: 'skipped' }; }
  for (let i = 0; i < total; i++) {
    if (signal && signal.aborted) return { status: 'skipped' };
    onProgress?.(i + 1, total);
    if ((i & 15) === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { status: 'skipped' };
}

export function validatePersonsStub() { return false; }
export async function resetPersonsStub(photos, db, context) { void photos; void db; void context; }
