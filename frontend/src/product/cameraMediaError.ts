/** Turn browser media decoder errors into a useful recovery message. */
export function cameraMediaErrorMessage(code: number): string {
  switch (code) {
    case 1: return 'Video playback was interrupted. Reconnecting to the camera.';
    case 2: return 'The camera video stream had a network error. Reconnecting.';
    case 3: return 'The browser could not decode the camera video. Reconnecting.';
    case 4: return 'The camera video format is not supported by this browser.';
    default: return 'The camera video failed in the browser. Reconnecting.';
  }
}

/** Bound retries for unsupported sources, but keep recovering cameras already proven playable. */
export function shouldRetryCameraMediaError(
  code: number,
  retryCount = 0,
  previouslyDecodedFrame = false,
): boolean {
  return code !== 4 || previouslyDecodedFrame || retryCount < 3;
}

/** Retry timeouts, rate limits and server failures; client errors need a changed request. */
export function shouldRetryCameraRequestStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
