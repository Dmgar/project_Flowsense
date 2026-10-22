export interface VideoGap {
  session_changed: boolean;
  in_progress?: boolean;
}

export interface CaptureHealth {
  active?: boolean;
  session_state?: string;
  sample_age_seconds?: number | null;
}

export interface ContinuitySummary {
  coverage_percent: number | null;
  session_count: number;
  in_session_pause_count?: number;
  longest_in_session_pause_seconds?: number;
  session_boundary_gap_count?: number;
}

export function liveCaptureIsFresh(capture?: CaptureHealth): boolean {
  return capture?.active === true && capture.session_state === 'Live'
    && typeof capture.sample_age_seconds === 'number' && capture.sample_age_seconds <= 3;
}

export function describeVideoGap(gap: VideoGap, liveCaptureFresh = false): string {
  if (gap.in_progress && liveCaptureFresh) return 'Live video is active; waiting for the next saved analysis sample.';
  if (gap.in_progress) return 'Analysis has not resumed yet; cause unverified.';
  if (gap.session_changed) return 'Monitoring ended and a new video session began; this unobserved gap does not confirm a stream outage.';
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

export function describeContinuityCoverage(summary: ContinuitySummary): string {
  const coverage = `Analysis coverage · ${summary.coverage_percent ?? '—'}% observed across ${summary.session_count} video session${summary.session_count === 1 ? '' : 's'} in the last 15 minutes. This measures when monitoring saved samples, not source uptime.`;
  if (typeof summary.in_session_pause_count !== 'number'
      || typeof summary.session_boundary_gap_count !== 'number') {
    return `${coverage} Pause breakdown is unavailable from the current camera API.`;
  }
  const inSession = summary.in_session_pause_count === 0
    ? 'No analysis gaps longer than 2 seconds within a session.'
    : `${summary.in_session_pause_count} within-session analysis gaps over 2 seconds · longest ${summary.longest_in_session_pause_seconds ?? 0}s.`;
  const betweenSessions = summary.session_boundary_gap_count > 0
    ? ` ${summary.session_boundary_gap_count} gap${summary.session_boundary_gap_count === 1 ? '' : 's'} between separately observed sessions.`
    : '';
  return `${coverage} ${inSession}${betweenSessions}`;
}
