export interface VideoGap {
  session_changed: boolean;
  in_progress?: boolean;
}

export interface CaptureHealth {
  active?: boolean;
  session_state?: string;
  sample_age_seconds?: number | null;
}

export function liveCaptureIsFresh(capture?: CaptureHealth): boolean {
  return capture?.active === true && capture.session_state === 'Live'
    && typeof capture.sample_age_seconds === 'number' && capture.sample_age_seconds <= 3;
}

export function describeVideoGap(gap: VideoGap, liveCaptureFresh = false): string {
  if (gap.in_progress && liveCaptureFresh) return 'Live video is active; waiting for the next saved analysis sample.';
  if (gap.in_progress) return 'Analysis has not resumed yet; cause unverified.';
  if (gap.session_changed) return 'Video session changed across this gap; the trigger is unverified.';
  return 'Analysis samples paused within the same video session; cause unverified.';
}

export function describeLatestSampleAge(ageSeconds: number, liveCaptureFresh = false): string {
  const age = ageSeconds >= 60
    ? `${Math.floor(ageSeconds / 60)}m ${Math.floor(ageSeconds % 60)}s`
    : `${Math.round(ageSeconds)}s`;
  return liveCaptureFresh
    ? `Latest saved analysis sample · ${age} ago. Live video and inference are active; saved road metrics may briefly lag.`
    : `Latest camera analysis sample · ${age} ago. Capture may be paused or analysis may have stopped; cause unverified. Check the live player before treating this road estimate as current.`;
}
