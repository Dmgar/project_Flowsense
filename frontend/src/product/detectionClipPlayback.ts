export function crossingReviewOffset(offsetSeconds: number, leadInSeconds = 2): number {
  if (!Number.isFinite(offsetSeconds)) return 0;
  return Math.max(0, offsetSeconds - Math.max(0, Number.isFinite(leadInSeconds) ? leadInSeconds : 0));
}

export function missingDetectionClipMessage(hasLinkedClip: boolean): string {
  return hasLinkedClip
    ? 'This detection is linked to a clip that is still recording or has not loaded in the review list yet. Try again after the next video refresh.'
    : 'No saved video clip is linked to this detection.';
}

export function playSavedClipAt(video: HTMLVideoElement, offsetSeconds: number, onError: (message: string) => void): void {
  const seek = () => {
    const requestedOffset = Number.isFinite(offsetSeconds) ? Math.max(0, offsetSeconds) : 0;
    const lastPlayablePoint = Number.isFinite(video.duration) ? Math.max(0, video.duration - .1) : requestedOffset;
    video.currentTime = Math.min(requestedOffset, lastPlayablePoint);
  };

  if (video.readyState >= 1) seek();
  else {
    video.preload = 'auto';
    video.addEventListener('loadedmetadata', seek, { once: true });
    video.addEventListener('error', () => {
      onError(video.error?.message || 'The saved clip could not be decoded by this browser.');
    }, { once: true });
  }

  // Request playback during the user's click. Waiting for loadedmetadata first
  // loses browser user activation and can silently leave the clip at 0:00.
  try {
    void video.play().catch(reason => {
      onError(reason instanceof Error ? reason.message : 'The browser could not start the saved clip.');
    });
  } catch (reason) {
    onError(reason instanceof Error ? reason.message : 'The browser could not start the saved clip.');
  }
}
