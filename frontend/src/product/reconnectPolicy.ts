/** Retry a failed live video session indefinitely, with a bounded request rate. */
export const WEBRTC_DISCONNECT_GRACE_MS = 8_000;

/** Keep the frame watchdog active while connecting even before a media track exists. */
export function shouldWatchCameraFrames(
  pageVisible: boolean,
  intentionallyPaused: boolean,
  trackPresent = false,
  autoplayBlocked = false,
): boolean {
  return pageVisible && !intentionallyPaused && !(trackPresent && autoplayBlocked);
}

export function reconnectDelayMs(attempt: number): number {
  const retry = Math.max(1, Math.floor(attempt));
  return Math.min(4_000, 1_000 * 2 ** (retry - 1));
}

/** Ignore short WebRTC disconnects; they often recover without a new video session. */
export function shouldRecoverDisconnectedWebRtcConnection(
  state: string | undefined,
  disconnectedAt: number,
  now: number,
): boolean {
  return state === 'disconnected' && now - disconnectedAt >= WEBRTC_DISCONNECT_GRACE_MS;
}

export function automaticReconnectMessage(reason: string): string {
  const detail = reason.trim();
  return `${detail || 'The camera connection was interrupted.'} Retrying automatically.`;
}
