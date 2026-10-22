const GIGABYTE = 1_000_000_000;
const LOW_HEADROOM_BYTES = 1_000_000_000;
const RECOVERY_HEADROOM_BYTES = 500_000_000;

export function diskReserveDiagnostic(freeBytes?: number, reserveBytes?: number): {
  level: 'available' | 'near-limit' | 'critical';
  text: string;
} | null {
  if (!Number.isFinite(freeBytes) || !Number.isFinite(reserveBytes)) return null;
  const free = Math.max(0, freeBytes!);
  const reserve = Math.max(0, reserveBytes!);
  const format = (bytes: number) => (bytes / GIGABYTE).toFixed(2);

  if (free < reserve) {
    const minimumHeadroomMb = Math.ceil((reserve - free) / 1_000_000 * 10) / 10;
    const recoveryHeadroomMb = Math.ceil((reserve + RECOVERY_HEADROOM_BYTES - free) / 1_000_000 * 10) / 10;
    return {
      level: 'critical',
      text: `Free at least ${minimumHeadroomMb.toFixed(1)} MB to meet the disk safety reserve. Aim for ${recoveryHeadroomMb.toFixed(1)} MB so MP4 recording can resume with 0.50 GB of headroom; existing clips are preserved.`,
    };
  }

  const headroom = free - reserve;
  if (headroom < LOW_HEADROOM_BYTES) {
    return {
      level: 'near-limit',
      text: `Only ${format(headroom)} GB above the ${format(reserve)} GB safety reserve. New recording pauses if free disk space falls below the reserve; existing clips are preserved.`,
    };
  }

  return {
    level: 'available',
    text: `Free disk space: ${format(free)} GB · configured safety reserve: ${format(reserve)} GB.`,
  };
}
