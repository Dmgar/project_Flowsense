/** Progress-based watchdog, independent of browser/media APIs for deterministic checks. */
export class PlaybackHealth {
  private lastTick: number;
  private visible = true;
  private paused = false;
  private firstFrameElapsed = 0;
  private idleElapsed = 0;
  private activeElapsed = 0;
  private stableSince: number | null = null;
  private progressed = false;
  private mediaTime: number | null = null;
  private lastRecovery = -Infinity;
  private attempts = 0;
  private seekStarted: number | null = null;

  constructor(now: number) { this.lastTick = now; }

  private advance(now: number) {
    const elapsed = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    if (!this.visible || this.paused) return 0;
    this.activeElapsed += elapsed;
    if (!this.progressed) this.firstFrameElapsed += elapsed;
    this.idleElapsed += elapsed;
    return elapsed;
  }

  setVisible(visible: boolean, now: number) {
    this.advance(now); this.visible = visible; this.idleElapsed = 0; this.stableSince = null; this.seekStarted = null;
  }

  setPaused(paused: boolean, now: number) {
    this.advance(now); this.paused = paused; this.idleElapsed = 0; this.stableSince = null; this.seekStarted = null;
  }

  recordProgress(mediaTime: number, now: number) {
    if (!Number.isFinite(mediaTime) || mediaTime <= 0 || this.mediaTime !== null && Math.abs(mediaTime - this.mediaTime) <= .01) return false;
    this.advance(now);
    if (this.stableSince === null || this.idleElapsed >= 12000) this.stableSince = this.activeElapsed;
    this.mediaTime = mediaTime; this.progressed = true; this.idleElapsed = 0; this.seekStarted = null;
    // An isolated interruption after sustained healthy playback gets a fresh budget.
    if (this.activeElapsed - this.stableSince >= 30000) { this.attempts = 0; this.lastRecovery = -Infinity; }
    return true;
  }

  poll(now: number, seeking = false): 'wait' | 'recover' | 'fallback' {
    this.advance(now);
    if (!this.visible || this.paused) { this.idleElapsed = 0; this.stableSince = null; this.seekStarted = null; return 'wait'; }
    if (seeking) {
      this.seekStarted ??= now;
      this.idleElapsed = 0; this.stableSince = null;
      return now - this.seekStarted >= 20000 ? 'recover' : 'wait';
    }
    this.seekStarted = null;
    if (!this.progressed && this.firstFrameElapsed >= 35000) return 'fallback';
    return this.progressed && this.idleElapsed >= 12000 ? 'recover' : 'wait';
  }

  requestRecovery(now: number): { action: 'retry'; attempt: number } | { action: 'wait' | 'fallback' } {
    if (!this.visible || this.paused || now - this.lastRecovery < 2000) return { action: 'wait' };
    if (this.attempts >= 2) return { action: 'fallback' };
    this.advance(now); this.attempts++; this.lastRecovery = now;
    this.idleElapsed = 0; this.stableSince = null; this.seekStarted = null;
    return { action: 'retry', attempt: this.attempts };
  }
}

/** Never seek a VOD or jump into a live region that has not arrived yet. */
export function bufferedLiveTarget(isLive: boolean, target: number | null | undefined, ranges: [number, number][]): number | null {
  return isLive && target != null && Number.isFinite(target) && ranges.some(([start, end]) => target >= start && target < end) ? target : null;
}
