import type { Camera } from './types';
import { hasPreviouslyVerifiedVideo } from './cameraCalibration.ts';

export function cameraStatus(camera: Camera) {
  if (!camera.stream_url) return { label: 'Video not supported', tone: 'gray' as const, usable: false };
  if (hasPreviouslyVerifiedVideo(camera)) return { label: 'HLS URL returned HTTP 200 previously · open to confirm playback', tone: 'gray' as const, usable: true };
  return { label: 'Video source registered · open to connect', tone: 'gray' as const, usable: true };
}

export function checkedAt(value?: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return "No query recorded";
  return new Date(value).toLocaleString("en-US", { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
