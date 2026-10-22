export interface RoadCameraCoverage {
  measured_camera_count: number;
  camera_count: number;
  calibrated_camera_count?: number;
  active_camera_count: number;
}

export interface RoadCameraLink {
  camera_id: string;
  distance_m?: number | null;
  zone_enabled?: boolean;
}

export function describeRoadCameraCoverage(road: RoadCameraCoverage): string {
  const calibration = typeof road.calibrated_camera_count === 'number'
    ? `${road.calibrated_camera_count} calibrated`
    : 'calibration status unavailable';
  return `${road.measured_camera_count} of ${road.camera_count} linked camera estimates · ${calibration} · ${road.active_camera_count} feeds live`;
}

export function describeRoadCameraLinks(links: RoadCameraLink[], cameraNames: Map<string, string>, limit = 2): string {
  const shown = links.slice(0, Math.max(0, limit)).map(link => {
    const name = cameraNames.get(link.camera_id) || link.camera_id;
    const distance = Number.isFinite(link.distance_m) ? ` · approx. ${Math.round(link.distance_m!)} m` : '';
    const zone = typeof link.zone_enabled === 'boolean' ? ` · ${link.zone_enabled ? 'zone set' : 'zone needed'}` : '';
    return `${name}${distance}${zone}`;
  });
  if (links.length > shown.length) shown.push(`+${links.length - shown.length} more`);
  return shown.length ? `Linked cameras: ${shown.join(' · ')}` : 'Camera link details unavailable';
}
