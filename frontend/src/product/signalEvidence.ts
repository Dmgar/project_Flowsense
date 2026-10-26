import type { Camera, MobilityCase, Signal } from './types';

export function observedCaseSignal(item: MobilityCase, cameras: Camera[]): Signal {
  const cameraIndex = cameras.findIndex(camera => camera.id === item.evidence_camera_id);
  const camera = cameras[cameraIndex];
  return {
    id: item.signal_id,
    title: item.evidence_session_id ? 'Manual video review' : item.evidence_frame_id ? 'Manual image review' : 'Manual observation review',
    location: camera?.name || item.title,
    district: camera?.district || 'Location unavailable',
    type: 'Manual review',
    severity: item.severity,
    confidence: item.confidence ?? null,
    impact: 0,
    evidence: item.evidence_camera_id ? 'Camera-linked observation' : 'Saved observation · source not linked',
    duration: 0,
    // Numeric fallbacks retain the legacy Signal shape; they are regional context,
    // not observation coordinates. Map views must resolve evidence_camera_id first.
    lat: camera?.lat ?? 34.048,
    lng: camera?.lng ?? -118.259,
    action: item.note,
    owner: item.owner,
    cameraIndex: Math.max(cameraIndex, 0),
    causes: [item.evidence_session_id ? 'A saved video-session reference accompanies this manual review.' : item.evidence_frame_id ? 'A saved frame reference accompanies this manual review.' : 'The record does not identify a saved video session or image frame. Review the original source and audit history before drawing a conclusion.', 'Detections do not confirm a cause or an incident.'],
    data_origin: 'observation',
    evidence_camera_id: item.evidence_camera_id || undefined,
    evidence_frame_id: item.evidence_frame_id || undefined,
    evidence_session_id: item.evidence_session_id || undefined,
    evidence_media_time_seconds: item.evidence_media_time_seconds ?? undefined,
  };
}

export type SignalCameraEvidence =
  | { state: 'illustrative' }
  | { state: 'unlinked' }
  | { state: 'loading' }
  | { state: 'catalog_unavailable' }
  | { state: 'not_in_catalog' }
  | { state: 'linked'; camera: Camera }
  | { state: 'linked_catalog_unavailable'; camera: Camera };

const nextCheckCopy: Record<SignalCameraEvidence['state'], string> = {
  illustrative: 'This is an illustrative example, not a current observation. Switch to observations or explore a public camera before reviewing real evidence.',
  unlinked: 'This saved observation has no linked camera. Find a source before attributing it to a location or deciding what to review.',
  loading: 'Camera details are still loading. Wait for the saved source link before drawing a conclusion.',
  catalog_unavailable: 'The camera catalog could not load. Retry it before relying on a source for this observation.',
  not_in_catalog: 'The saved camera is not in the current catalog. Find an available source before continuing the review.',
  linked: 'Open the linked camera to check current playback and its viewing zone. The saved observation does not confirm an incident.',
  linked_catalog_unavailable: 'The saved camera is linked, but its catalog record may be out of date. Retry the catalog before using it for a new check.',
};

export function signalNextCheck(state: SignalCameraEvidence['state']): string {
  return nextCheckCopy[state];
}

export function resolveSignalCameraEvidence(
  signal: Pick<Signal, 'data_origin' | 'evidence_camera_id'>,
  cameras: Camera[],
  catalogLoaded: boolean,
  catalogFailed: boolean,
): SignalCameraEvidence {
  if (signal.data_origin !== 'observation') return { state: 'illustrative' };
  if (!signal.evidence_camera_id) return { state: 'unlinked' };

  const camera = cameras.find(item => item.id === signal.evidence_camera_id);
  if (camera) return catalogFailed ? { state: 'linked_catalog_unavailable', camera } : { state: 'linked', camera };
  if (catalogFailed) return { state: 'catalog_unavailable' };
  if (!catalogLoaded) return { state: 'loading' };
  return { state: 'not_in_catalog' };
}
