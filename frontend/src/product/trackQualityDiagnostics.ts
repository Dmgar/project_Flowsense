export interface TrackQualityEvent {
  counted: boolean;
  class?: string;
  effective_class?: string;
  first_seen?: string | null;
  last_seen?: string | null;
  crossed_at?: string | null;
  observations?: number;
}

export interface TrackQualitySample {
  counted_track_count: number;
  measurable_track_count: number;
  brief_track_count: number;
  brief_track_percent: number | null;
  average_observations: number | null;
  history_event_count: number;
}

export function trackQualityFromRecentHistory(
  events: TrackQualityEvent[],
  nowMs = Date.now(),
  windowSeconds = 60,
): TrackQualitySample {
  const cutoff = nowMs - Math.max(0, windowSeconds) * 1000;
  const recent = events.filter(event => {
    const className = (event.effective_class || event.class || '').toLowerCase();
    if (!event.counted || ['pedestrian', 'person', 'rider', 'false_positive'].includes(className)) return false;
    const crossedAt = Date.parse(event.crossed_at || '');
    return Number.isFinite(crossedAt) && crossedAt >= cutoff && crossedAt <= nowMs;
  });
  let brief = 0;
  let measurable = 0;
  const observations: number[] = [];
  for (const event of recent) {
    const first = Date.parse(event.first_seen || '');
    const last = Date.parse(event.last_seen || '');
    if (Number.isFinite(first) && Number.isFinite(last) && last >= first) {
      measurable++;
      const duration = (last - first) / 1000;
      if (duration < 2) brief++;
    }
    if (typeof event.observations === 'number' && Number.isFinite(event.observations)) observations.push(event.observations);
  }
  return {
    counted_track_count: recent.length,
    measurable_track_count: measurable,
    brief_track_count: brief,
    brief_track_percent: measurable ? Math.round(brief * 1000 / measurable) / 10 : null,
    average_observations: observations.length ? Math.round(observations.reduce((sum, value) => sum + value, 0) / observations.length * 10) / 10 : null,
    history_event_count: events.length,
  };
}
