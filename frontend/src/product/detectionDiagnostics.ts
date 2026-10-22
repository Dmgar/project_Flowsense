const CLASS_LABELS: Record<string, [string, string]> = {
  car: ['car', 'cars'], truck: ['truck', 'trucks'], bus: ['bus', 'buses'],
  motorcycle: ['motorcycle', 'motorcycles'], bicycle: ['bicycle', 'bicycles'],
  pedestrian: ['pedestrian', 'pedestrians'], rider: ['rider', 'riders'],
  vehicle: ['uncertain vehicle', 'uncertain vehicles'],
};

export function visibleDetectionCount(detections: unknown, fallback: number | undefined) {
  if (Array.isArray(detections)) return detections.length;
  return typeof fallback === 'number' && Number.isFinite(fallback) ? Math.max(0, Math.floor(fallback)) : 0;
}

export function visibleClassBreakdown(detections: unknown) {
  if (!Array.isArray(detections)) return null;
  const stable = detections.filter(detection =>
    detection && typeof detection === 'object' && (detection as { class_status?: unknown }).class_status === 'stable',
  ).length;
  return { stable, pending: detections.length - stable };
}

export function candidateHintCoverage(candidateCount: unknown, pendingVehicleCount: unknown, historyComplete: boolean) {
  if (!historyComplete || typeof candidateCount !== 'number' || typeof pendingVehicleCount !== 'number'
      || !Number.isSafeInteger(candidateCount) || !Number.isSafeInteger(pendingVehicleCount)
      || candidateCount < 0 || pendingVehicleCount <= 0 || candidateCount > pendingVehicleCount) return null;
  return {
    candidateCount,
    pendingVehicleCount,
    percent: Math.round(candidateCount * 1000 / pendingVehicleCount) / 10,
  };
}

export function classReviewEvidenceStatus(reviewableDetections: number, playableClips: number, latestClipAgeMinutes: number | null, recordingPaused: boolean) {
  if (reviewableDetections > 0) {
    return `${reviewableDetections} recent detections have playable video and are ready for class review.`;
  }
  if (playableClips > 0) {
    const clipAge = latestClipAgeMinutes != null && Number.isFinite(latestClipAgeMinutes)
      ? ` The newest clip is ${latestClipAgeMinutes} min behind current analysis.` : '';
    const recording = recordingPaused
      ? ' MP4 recording is paused by the disk reserve, so newer clip-based reviews must wait for recording to resume.'
      : ' New review controls will appear when a track is linked to playable video.';
    return `No detections in the loaded track history are linked to playable clips for class review.${clipAge}${recording} Existing clips are retained.`;
  }
  return recordingPaused
    ? 'No playable clip is available for track-level review. MP4 recording is paused by the disk reserve; existing files are retained.'
    : 'No playable video is linked to detections in the loaded track history yet.';
}

export function detectionPipelineStatus(metrics: { analysis_pipeline?: { raw_candidates?: unknown } } | null | undefined, inferenceRate?: unknown, inferenceIsFresh = false) {
  if (typeof metrics?.analysis_pipeline?.raw_candidates === 'number') return 'ready' as const;
  if (metrics && inferenceIsFresh && typeof inferenceRate === 'number' && Number.isFinite(inferenceRate) && inferenceRate > 0) return 'inference_only' as const;
  return metrics ? 'unavailable' as const : 'stale' as const;
}

export function formatTrackScore(score: unknown) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'Track score unavailable';
  return `${Math.round(Math.min(1, Math.max(0, score)) * 100)}% track score`;
}

export function formatOutsideZoneSummary(count: number, classes: Record<string, number> = {}, windowSeconds = 2) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const window = Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds : 2;
  if (!safeCount) return `No model candidates were outside the inbound zone in the last ${window} seconds.`;

  const kinds = Object.entries(classes)
    .filter(([, amount]) => Number.isFinite(amount) && amount > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([name, amount]) => {
      const [singular, plural] = CLASS_LABELS[name] || [`${name} object`, `${name} objects`];
      return `${amount} ${amount === 1 ? singular : plural}`;
    });
  const summary = kinds.length ? ` (model labels: ${kinds.join(', ')})` : '';
  return `${safeCount} outside-zone model ${safeCount === 1 ? 'candidate' : 'candidates'} in the last ${window} seconds${summary}. Labels are unverified; candidates are excluded from tracking and counts.`;
}

export function formatOutsideZoneFrameSummary(count: number, classes: Record<string, number> = {}, frameCount = 0) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const safeFrames = Number.isFinite(frameCount) ? Math.max(0, Math.floor(frameCount)) : 0;
  if (!safeCount) return '';
  const labels = Object.entries(classes)
    .filter(([, amount]) => Number.isFinite(amount) && amount > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([name, amount]) => {
      const [singular, plural] = CLASS_LABELS[name] || [`${name} object`, `${name} objects`];
      return `${amount} ${amount === 1 ? singular : plural}`;
    });
  const summary = labels.length ? ` (model labels: ${labels.join(', ')})` : '';
  const frames = safeFrames ? ` across ${safeFrames} ${safeFrames === 1 ? 'frame' : 'frames'}` : '';
  return `The model proposed ${safeCount} outside-zone ${safeCount === 1 ? 'candidate' : 'candidates'}${frames}${summary}. Class labels are unverified; candidates are excluded from tracking and counts.`;
}
