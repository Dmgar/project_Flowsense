import type { Camera } from './types';

export function observationDeskSelection(selectedIds: string[], cameras: Camera[]) {
  const selected = [...new Set(selectedIds)].flatMap(id => cameras.find(camera => camera.id === id) || []);
  const videoSources = selected.filter(camera => Boolean(camera.stream_url));
  const playable = videoSources.slice(0, 4);
  const overflowIds = videoSources.slice(4).map(camera => camera.id);
  const unsupportedIds = selected.filter(camera => !camera.stream_url).map(camera => camera.id);
  const missingIds = [...new Set(selectedIds)].filter(id => !cameras.some(camera => camera.id === id));
  const invalidIds = new Set([...unsupportedIds, ...missingIds, ...overflowIds]);
  const recoveryMessages = [
    missingIds.length ? `${missingIds.length} saved ${missingIds.length === 1 ? 'camera is' : 'cameras are'} no longer in the catalog` : '',
    unsupportedIds.length ? `${unsupportedIds.length} saved ${unsupportedIds.length === 1 ? 'camera does' : 'cameras do'} not provide video` : '',
    overflowIds.length ? `the selection includes ${overflowIds.length} video ${overflowIds.length === 1 ? 'camera beyond' : 'cameras beyond'} the four-camera limit` : '',
  ].filter(Boolean);

  return {
    playable,
    unsupportedIds,
    missingIds,
    overflowIds,
    invalidIds,
    recoveryMessages,
    usedSlots: playable.length,
    availableSlots: Math.max(0, 4 - playable.length),
    isFull: playable.length >= 4,
  };
}
