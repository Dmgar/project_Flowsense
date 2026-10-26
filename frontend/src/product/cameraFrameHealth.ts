/** Watch decoded video progress without confusing a deliberate pause for a stall. */
const DECODED_FRAME_STALL_TIMEOUT_MS = 8_000;
const MISSING_MEDIA_TRACK_TIMEOUT_MS = 8_000;
const INITIAL_VIDEO_FRAME_TIMEOUT_MS = 15_000;

export class CameraFrameHealth {
  private lastTick: number;
  private activeWaitMs = 0;
  private missingTrackMs = 0;
  private idleSinceFrameMs = 0;
  private hasFrame = false;
  private trackNegotiated = false;
  private lastWatching = true;

  constructor(now: number) {
    this.lastTick = now;
  }

  setWatching(now: number, watching: boolean) {
    if (watching === this.lastWatching) return;
    this.advance(now, watching);
    if (watching) {
      // Hidden-tab and intentional-pause time must not count as a live stall.
      this.idleSinceFrameMs = 0;
      if (!this.hasFrame) {
        this.activeWaitMs = 0;
        this.missingTrackMs = 0;
      }
    }
  }

  private advance(now: number, watching: boolean, trackPresent = true) {
    const elapsed = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    if (watching) {
      const activeElapsed = elapsed;
      if (trackPresent) this.missingTrackMs = 0;
      else this.missingTrackMs += activeElapsed;
      if (!this.hasFrame) this.activeWaitMs += activeElapsed;
      this.idleSinceFrameMs += activeElapsed;
    }
    if (watching && !this.lastWatching) this.idleSinceFrameMs = 0;
    this.lastWatching = watching;
  }

  recordFrame(now: number) {
    this.advance(now, true, true);
    this.hasFrame = true;
    this.idleSinceFrameMs = 0;
  }

  recordTrack(now: number) {
    this.trackNegotiated = true;
    this.lastTick = now;
    this.activeWaitMs = 0;
    this.missingTrackMs = 0;
    this.idleSinceFrameMs = 0;
  }

  /** Start the missing-track watchdog only after WebRTC negotiation can deliver a track. */
  beginTrackWait(now: number) {
    this.trackNegotiated = true;
    this.lastTick = now;
    this.activeWaitMs = 0;
    this.missingTrackMs = 0;
    this.idleSinceFrameMs = 0;
  }

  poll(now: number, watching: boolean, trackPresent = true): 'wait' | 'no-track' | 'no-frame' | 'stalled' {
    this.advance(now, watching, trackPresent);
    if (this.trackNegotiated && this.missingTrackMs >= MISSING_MEDIA_TRACK_TIMEOUT_MS) return 'no-track';
    if (!watching) return 'wait';
    if (this.hasFrame) return this.idleSinceFrameMs >= DECODED_FRAME_STALL_TIMEOUT_MS ? 'stalled' : 'wait';
    // A negotiated WebRTC track that never yields its first decoded frame is
    // unusable to the operator. Retry promptly while allowing normal source
    // startup and short network stalls.
    return this.activeWaitMs >= INITIAL_VIDEO_FRAME_TIMEOUT_MS ? 'no-frame' : 'wait';
  }
}
