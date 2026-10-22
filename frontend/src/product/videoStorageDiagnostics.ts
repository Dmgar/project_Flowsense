export interface VideoClipReviewCandidate { id: string; state: string; duration: number }

export interface VideoWriterStatus { pauseReason: string; warning: string }

export function formatPausedVideoAnalysisStatus(sampleCount: number, windowSeconds: number): string {
  const samples = Math.max(0, Math.floor(Number.isFinite(sampleCount) ? sampleCount : 0));
  const seconds = Math.max(0, Math.floor(Number.isFinite(windowSeconds) ? windowSeconds : 0));
  const window = seconds >= 60 && seconds % 60 === 0
    ? `${seconds / 60} ${seconds === 60 ? 'minute' : 'minutes'}`
    : `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  return `Live detection history is still being saved: ${samples.toLocaleString('en-US')} analysis samples in the last ${window}. MP4 clip recording is paused by the storage safeguard.`;
}

export function videoWriterStatus(error: string, storageBlockReason = ''): VideoWriterStatus {
  const queueWarning = 'Evidence writer fell behind; a few clip frames may be missing. Camera analysis continues.';
  const observationWarning = 'Observation history writer fell behind; recent road analysis may be delayed. Live video and inference continue.';
  if (storageBlockReason) return { pauseReason: storageBlockReason, warning: '' };
  if (!error) return { pauseReason: '', warning: '' };
  if (error === queueWarning || error === observationWarning) return { pauseReason: '', warning: error };
  return { pauseReason: error, warning: '' };
}

export function partitionVideoClips<T extends VideoClipReviewCandidate>(clips: T[], limit = 6): {
  reviewable: T[];
  shortCount: number;
} {
  const short = clips.filter(clip => clip.state === 'short' || (clip.state === 'ready' && clip.duration < .25));
  return {
    reviewable: clips.filter(clip => clip.state === 'ready' && clip.duration >= .25).slice(0, Math.max(0, limit)),
    shortCount: short.length,
  };
}

export function formatClipCapacityNote(
  remainingGigabytes: number | null,
  storagePercent: number,
  recordingPaused: boolean,
  hasSpecificPauseReason: boolean,
): string {
  if (remainingGigabytes === null) return 'Checking remaining video evidence capacity…';
  if (storagePercent >= 100) {
    return 'Video clips are paused at the clip storage cap. Live detection and observations continue.';
  }

  const remaining = `${remainingGigabytes.toFixed(2)} GB of clip quota remains.`;
  if (!recordingPaused) {
    return `${remaining} New clips pause if the quota is exhausted or the free-disk safety reserve is reached.`;
  }
  if (hasSpecificPauseReason) {
    return `${remaining} Recording is paused by the storage safeguard reported above; live detection and observation history continue.`;
  }
  return `${remaining} The server reports recording is paused but does not identify the storage trigger; live detection and observation history continue.`;
}
