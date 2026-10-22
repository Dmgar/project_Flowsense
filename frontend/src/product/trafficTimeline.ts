export interface TrafficMinuteEvidence {
  minute: string;
  total: number;
  video_samples?: number;
}

export interface TrafficMinuteBin {
  minute: string;
  total: number;
  video_samples: number;
  observed: boolean;
}

export function buildTrafficTimeline(minutes: TrafficMinuteEvidence[], since: string, now: number): TrafficMinuteBin[] {
  const start = Math.max(Math.floor(Date.parse(since) / 60000) * 60000, now - 29 * 60000);
  const byMinute = new Map(minutes.map(item => [Date.parse(item.minute), item]));
  const bins: TrafficMinuteBin[] = [];
  for (let minute = start; minute <= now; minute += 60000) {
    const item = byMinute.get(minute);
    const samples = item?.video_samples || 0;
    bins.push({
      minute: new Date(minute).toISOString(),
      total: item?.total || 0,
      video_samples: samples,
      observed: samples > 0 || (item?.total || 0) > 0,
    });
  }
  return bins;
}

export function describeTrafficMinute(bin: TrafficMinuteBin, locale = 'en-US') {
  const time = new Date(bin.minute).toLocaleTimeString(locale);
  return bin.observed
    ? `${time}: ${bin.total} track crossings from observed video (${bin.video_samples} analysis samples)`
    : `${time}: no saved video analysis; crossing count unknown`;
}
