// js/pipeline/presetInvalidation.js
// Gemeinsame Preset-Invalidierung fuer Review/IA-Controls.

import * as db from '../db.js';
import { invalidateStages } from './runner.js';
import { classifyStreamFromFaces } from './streamClassification.js';

export async function markStagePending(stageKey, dispatch) {
  const result = await invalidateStages([stageKey], {
    db,
    dispatch,
    context: { reason: 'presets:changed' },
    status: 'idle'
  });
  dispatch?.({ type: 'UPDATE_PHOTOS', payload: result.photos || [] });
  return result;
}

export async function rederiveStreamsForFocus(focus, dispatch) {
  const photos = await db.getAllPhotos();
  const changed = [];

  for (const photo of photos) {
    if (!photo || photo.status === 'failed' || !photo.faces) continue;
    const nextStream = classifyStreamFromFaces(photo.faces, focus);
    if (photo.stream !== nextStream) {
      photo.stream = nextStream;
      changed.push(photo);
    }
  }

  if (changed.length) await db.putPhotos(changed);
  dispatch?.({ type: 'UPDATE_PHOTOS', payload: photos });
  return { photos, changedPhotoIds: changed.map((p) => p.id) };
}
