export function roadCountDisplay(value: number | null | undefined, directionalZoneEnabled: boolean | undefined) {
  if (directionalZoneEnabled === false) return '—';
  return value ?? 0;
}

export function savedTrackScopeLabel(directionalZoneEnabled: boolean | undefined) {
  return directionalZoneEnabled === false
    ? 'Saved full-scene track records · not assigned to a road'
    : 'Saved track records · current road zone';
}

export function savedTrackScopeNote(directionalZoneEnabled: boolean | undefined) {
  return directionalZoneEnabled === false
    ? 'These records are preserved from the live video, but no reviewed inbound road zone is configured. They are excluded from directional road counts and map estimates.'
    : 'One record per tracker ID across saved camera sessions. This includes detections that did not cross the counting line; an ID is not guaranteed to represent one distinct physical vehicle.';
}
