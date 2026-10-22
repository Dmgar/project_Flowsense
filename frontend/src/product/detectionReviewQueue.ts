export interface ReviewableDetection {
  clip?: string | null;
  counted: boolean;
  crossing_offset_seconds?: number;
  first_seen?: string | null;
  last_seen?: string | null;
  crossed_at?: string | null;
  class?: string;
  class_status?: string;
  candidate_class?: string | null;
  direction?: string;
  feedback?: unknown;
}

const REVIEWABLE_CLASS_SUGGESTIONS = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'pedestrian', 'rider']);

export function archivedReviewHistoryMessage(apiSupportsArchive: boolean | null, reviewedCount: number): string {
  if (apiSupportsArchive !== false || reviewedCount <= 0) return '';
  return `${reviewedCount} operator video review${reviewedCount === 1 ? ' is' : 's are'} saved and applied to totals. This running camera API cannot list archived review clips yet; the review list will appear after the camera service loads the current update.`;
}

/** Return a class suggestion only after its saved video has actually started playing. */
export function confirmableSuggestedClass(
  event: ReviewableDetection,
  playedClipIds: ReadonlySet<string>,
): string | null {
  if (!event.clip || !playedClipIds.has(event.clip) || event.feedback
      || event.class !== 'vehicle' || event.class_status !== 'uncertain'
      || !event.candidate_class || !REVIEWABLE_CLASS_SUGGESTIONS.has(event.candidate_class)) return null;
  return event.candidate_class;
}

/** Require playback of linked evidence before creating or changing a label. */
export function canSaveVideoReview(event: ReviewableDetection, playedClipIds: ReadonlySet<string>): boolean {
  return Boolean(event.clip && playedClipIds.has(event.clip));
}

/** Keep road counts gated by calibration while allowing full-scene class review. */
export function reviewableDetections<T extends ReviewableDetection>(
  events: T[],
  readyClipIds: ReadonlySet<string>,
  directionalZoneEnabled?: boolean,
): T[] {
  return events.filter(event => {
    if (!event.clip || !readyClipIds.has(event.clip)) return false;
    if (event.counted && Number.isFinite(event.crossing_offset_seconds)) return true;
    if (event.counted) return false;
    if (event.class !== 'vehicle' && event.class_status === 'stable') {
      return directionalZoneEnabled === false || event.direction === 'approaching';
    }
    if (event.class !== 'vehicle' || event.class_status !== 'uncertain') return false;
    if (directionalZoneEnabled === false) return true;
    return event.direction === 'approaching';
  });
}

export function groupReviewableDetections<T extends ReviewableDetection>(
  events: T[],
  pendingLimit = 12,
  reviewedLimit = 3,
  countedLimit = 3,
): { pending: T[]; reviewed: T[]; counted: T[] } {
  const newestFirst = (a: T, b: T) => Date.parse(b.crossed_at || b.last_seen || b.first_seen || '')
    - Date.parse(a.crossed_at || a.last_seen || a.first_seen || '');
  const pending = events.filter(event => !event.counted && !event.feedback).sort(newestFirst);
  const reviewed = events.filter(event => !event.counted && Boolean(event.feedback)).sort(newestFirst);
  const counted = events.filter(event => event.counted).sort(newestFirst);
  return {
    pending: pending.slice(0, Math.max(0, pendingLimit)),
    reviewed: reviewed.slice(0, Math.max(0, reviewedLimit)),
    counted: counted.slice(0, Math.max(0, countedLimit)),
  };
}
