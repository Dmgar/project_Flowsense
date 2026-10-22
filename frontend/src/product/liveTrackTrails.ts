export interface LiveTrackSample {
  id: number;
  class: string;
  bbox: [number, number, number, number];
  trail?: [number, number][];
}

export interface LiveTrackSnapshot extends LiveTrackSample {
  trail: [number, number][];
}

interface TrackReading {
  session_id: string;
  metrics?: {
    generation: number;
    sequence: number;
    detections?: LiveTrackSample[];
    observed_detections?: LiveTrackSample[];
  } | null;
}

/** Reconstruct short motion trails from existing live IDs and boxes. */
export class LiveTrackTrailBuffer {
  private scope = '';
  private lastSequence: number | null = null;
  private readonly tracks = new Map<number, LiveTrackSnapshot & { lastSeenAt: number }>();

  reset(): void {
    this.scope = '';
    this.lastSequence = null;
    this.tracks.clear();
  }

  update(reading: TrackReading, now = Date.now()): LiveTrackSnapshot[] {
    const metrics = reading.metrics;
    if (!metrics) return this.snapshot(now);
    const scope = `${reading.session_id}:${metrics.generation}`;
    if (scope !== this.scope) {
      this.reset();
      this.scope = scope;
    }
    if (metrics.sequence !== this.lastSequence) {
      const detections = metrics.observed_detections ?? metrics.detections ?? [];
      for (const detection of detections) {
        if (!detection.bbox.every(Number.isFinite)) continue;
        const [x, y, width, height] = detection.bbox;
        const point: [number, number] = [x + width / 2, y + height];
        const previous = this.tracks.get(detection.id);
        const trail = previous?.trail.slice() ?? [];
        if (detection.trail && detection.trail.length >= 3) {
          trail.splice(0, trail.length, ...detection.trail.slice(-12));
        } else if (!trail.length || Math.hypot(point[0] - trail.at(-1)![0], point[1] - trail.at(-1)![1]) >= 1) {
          trail.push(point);
        }
        this.tracks.set(detection.id, { ...detection, trail: trail.slice(-12), lastSeenAt: now });
      }
      this.lastSequence = metrics.sequence;
    }
    return this.snapshot(now);
  }

  private snapshot(now: number): LiveTrackSnapshot[] {
    for (const [id, track] of this.tracks) {
      if (now - track.lastSeenAt > 2500) this.tracks.delete(id);
    }
    return [...this.tracks.values()]
      .filter(track => track.trail.length >= 3)
      .map(({ lastSeenAt: _lastSeenAt, ...track }) => track);
  }
}
