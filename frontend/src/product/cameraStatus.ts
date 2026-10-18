import type { Camera } from './types';

export function cameraStatus(camera: Camera) {
  if (camera.status === 'provider_notice') return { label: "Recent provider notice", tone: 'amber' as const, usable: false };
  if (camera.status === 'online') return { label: "Image queried recently", tone: 'green' as const, usable: true };
  if (camera.status === 'stale') return { label: camera.last_source_status === 'provider_notice' ? "Notice on last query · open to refresh" : "Previous query · open to refresh", tone: 'gray' as const, usable: camera.last_source_status === 'image' };
  if (camera.verification === 'decodable_image') return { label: "Verified during catalog review", tone: 'gray' as const, usable: true };
  return { label: camera.verification === 'placeholder' ? "Notice during catalog review" : "Availability not yet verified", tone: 'amber' as const, usable: false };
}

export function checkedAt(value?: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return "No query recorded";
  return new Date(value).toLocaleString("en-US", { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
