const BASE_DELAY_MS = 3_000;
const MAX_DELAY_MS = 12_000;

export function monitoringPollDelay(consecutiveFailures: number, succeeded: boolean): number {
  if (succeeded) return BASE_DELAY_MS;
  const failures = Number.isFinite(consecutiveFailures)
    ? Math.max(1, Math.floor(consecutiveFailures))
    : 1;
  return Math.min(BASE_DELAY_MS * 2 ** failures, MAX_DELAY_MS);
}
