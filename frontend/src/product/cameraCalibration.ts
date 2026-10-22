import type { Camera } from './types';

export interface CameraZoneStatus {
  camera_id: string;
  ready_for_road_analysis: boolean;
  route_metadata_available: boolean;
  route?: string | null;
  direction?: string | null;
  /** True only while the decoder is active and its latest video sample is fresh. */
  playback_verified?: boolean;
  playback_session_state?: string | null;
}

export interface CorridorCalibrationCoverage {
  route: string;
  direction: string;
  total: number;
  ready: number;
}

/** Count only catalog video sources on the same directed route. */
export function corridorCalibrationCoverage(
  camera: Pick<Camera, 'route' | 'direction'>,
  statuses: CameraZoneStatus[],
): CorridorCalibrationCoverage | null {
  const route = camera.route?.trim();
  const direction = camera.direction?.trim();
  if (!route || !direction || !statuses.length) return null;
  const key = `${route.toUpperCase()}|${direction.toLowerCase()}`;
  const corridor = statuses.filter(status => status.route?.trim() && status.direction?.trim()
    && `${status.route.trim().toUpperCase()}|${status.direction.trim().toLowerCase()}` === key);
  return { route, direction, total: corridor.length,
    ready: corridor.filter(status => status.ready_for_road_analysis).length };
}

export interface RoadCorridorProgress {
  key: string;
  route: string;
  direction: string;
  total: number;
  ready: number;
  pending: number;
  next_camera?: Camera;
}

export interface ObservedMotionTrack {
  trail: [number, number][];
  class?: string;
}

export interface ObservedDirectionSuggestion {
  direction: [number, number];
  start: [number, number];
  end: [number, number];
  agreeingTracks: number;
  sampledTracks: number;
}

export interface ObservedRoadRegionSuggestion {
  polygon: [number, number][];
  agreeingTracks: number;
  sampledTracks: number;
}

export interface RecentRoadRegionSuggestion {
  suggestion: ObservedRoadRegionSuggestion;
  observedAt: number;
}

/** Keep a valid live outline briefly so a rolling-window dropout does not hide it immediately. */
export function retainRecentRoadRegionSuggestion(
  current: ObservedRoadRegionSuggestion | null,
  previous: RecentRoadRegionSuggestion | null,
  now: number,
  maxAgeMs = 8_000,
): RecentRoadRegionSuggestion | null {
  if (current) return { suggestion: current, observedAt: now };
  if (previous && now >= previous.observedAt && now - previous.observedAt <= maxAgeMs) return previous;
  return null;
}

export function directionDifferenceDegrees(
  current: [number, number],
  proposed: [number, number],
): number | null {
  const currentLength = Math.hypot(current[0], current[1]);
  const proposedLength = Math.hypot(proposed[0], proposed[1]);
  if (currentLength < .001 || proposedLength < .001) return null;
  const cosine = (current[0] * proposed[0] + current[1] * proposed[1]) / (currentLength * proposedLength);
  return Math.round(Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI);
}

function pointInsidePolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x, y] = polygon[index];
    const [previousX, previousY] = polygon[previous];
    const crosses = (y > point[1]) !== (previousY > point[1])
      && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Suggest a direction only when at least three in-zone vehicle trails agree. */
export function suggestObservedDirection(
  polygon: [number, number][],
  tracks: ObservedMotionTrack[],
  frameWidth: number,
  frameHeight: number,
): ObservedDirectionSuggestion | null {
  if (polygon.length < 3 || frameWidth <= 0 || frameHeight <= 0) return null;
  const motion = tracks.flatMap(track => {
    if (track.class === 'pedestrian' || track.class === 'rider' || track.trail.length < 3) return [];
    const inZone = track.trail.map(([x, y]) => [x / frameWidth, y / frameHeight] as [number, number])
      .filter(point => pointInsidePolygon(point, polygon));
    if (inZone.length < 3 || inZone.length / track.trail.length < .5) return [];
    const start = inZone[0];
    const end = inZone[inZone.length - 1];
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    if (length < .012) return [];
    return [{ start, end, vector: [dx / length, dy / length] as [number, number] }];
  });
  if (motion.length < 3) return null;

  const alignment = Math.cos(Math.PI / 6);
  const consensus = motion.map(candidate => motion.filter(item =>
    candidate.vector[0] * item.vector[0] + candidate.vector[1] * item.vector[1] >= alignment));
  const supporters = consensus.sort((left, right) => right.length - left.length)[0];
  if (supporters.length < 3 || supporters.length / motion.length < .65) return null;

  const x = supporters.reduce((sum, item) => sum + item.vector[0], 0);
  const y = supporters.reduce((sum, item) => sum + item.vector[1], 0);
  const magnitude = Math.hypot(x, y);
  const direction: [number, number] = [x / magnitude, y / magnitude];
  const anchor: [number, number] = [
    supporters.reduce((sum, item) => sum + (item.start[0] + item.end[0]) / 2, 0) / supporters.length,
    supporters.reduce((sum, item) => sum + (item.start[1] + item.end[1]) / 2, 0) / supporters.length,
  ];
  let start: [number, number] = anchor;
  let end: [number, number] = anchor;
  let arrowFits = false;
  for (let distance = .07; distance >= .005; distance /= 2) {
    const candidateStart: [number, number] = [anchor[0] - direction[0] * distance, anchor[1] - direction[1] * distance];
    const candidateEnd: [number, number] = [anchor[0] + direction[0] * distance, anchor[1] + direction[1] * distance];
    if (pointInsidePolygon(candidateStart, polygon) && pointInsidePolygon(candidateEnd, polygon)) {
      start = candidateStart;
      end = candidateEnd;
      arrowFits = true;
      break;
    }
  }
  if (!arrowFits) return null;
  return { direction, start, end, agreeingTracks: supporters.length, sampledTracks: motion.length };
}

/** Propose a review-only road area around a clear cluster of moving vehicles. */
export function suggestObservedRoadRegion(
  tracks: (ObservedMotionTrack & { bbox?: [number, number, number, number] })[],
  frameWidth: number,
  frameHeight: number,
): ObservedRoadRegionSuggestion | null {
  if (frameWidth <= 0 || frameHeight <= 0) return null;
  const motion = tracks.flatMap(track => {
    if (track.class === 'pedestrian' || track.class === 'rider' || track.trail.length < 3) return [];
    const points = track.trail.filter(point => point.every(Number.isFinite))
      .map(([x, y]) => [x / frameWidth, y / frameHeight] as [number, number]);
    if (points.length < 3) return [];
    const start = points[0], end = points.at(-1)!;
    const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy);
    return length >= .012 ? [{ track, points, vector: [dx / length, dy / length] as [number, number] }] : [];
  });
  if (motion.length < 3) return null;

  const alignment = Math.cos(Math.PI / 6);
  const clusters = motion.map(candidate => motion.filter(item =>
    candidate.vector[0] * item.vector[0] + candidate.vector[1] * item.vector[1] >= alignment));
  const supporters = clusters.sort((left, right) => right.length - left.length)[0];
  if (supporters.length < 3 || supporters.length / motion.length < .65) return null;

  const points = supporters.flatMap(item => item.points);
  const meanX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  const covarianceXX = points.reduce((sum, point) => sum + (point[0] - meanX) ** 2, 0);
  const covarianceYY = points.reduce((sum, point) => sum + (point[1] - meanY) ** 2, 0);
  const covarianceXY = points.reduce((sum, point) => sum + (point[0] - meanX) * (point[1] - meanY), 0);
  const angle = .5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY);
  let axis: [number, number] = [Math.cos(angle), Math.sin(angle)];
  const averageX = supporters.reduce((sum, item) => sum + item.vector[0], 0);
  const averageY = supporters.reduce((sum, item) => sum + item.vector[1], 0);
  const averageLength = Math.hypot(averageX, averageY);
  if (Math.abs(axis[0] * averageX + axis[1] * averageY) / averageLength < Math.cos(Math.PI / 4)) {
    axis = [averageX / averageLength, averageY / averageLength];
  }
  if (axis[0] * averageX + axis[1] * averageY < 0) axis = [-axis[0], -axis[1]];
  const normal: [number, number] = [-axis[1], axis[0]];
  const longitudinal: number[] = [], lateral: number[] = [];
  for (const item of supporters) {
    const [rawWidth, rawHeight] = item.track.bbox?.slice(2) ?? [0, 0];
    const boxWidth = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 0;
    const boxHeight = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 0;
    const halfLong = Math.abs(axis[0]) * boxWidth / (2 * frameWidth)
      + Math.abs(axis[1]) * boxHeight / (2 * frameHeight);
    const halfLateral = Math.abs(normal[0]) * boxWidth / (2 * frameWidth)
      + Math.abs(normal[1]) * boxHeight / (2 * frameHeight);
    for (const point of item.points) {
      const along = point[0] * axis[0] + point[1] * axis[1];
      const across = point[0] * normal[0] + point[1] * normal[1];
      longitudinal.push(along - halfLong, along + halfLong);
      lateral.push(across - halfLateral, across + halfLateral);
    }
  }
  const minLong = Math.min(...longitudinal) - .015;
  const maxLong = Math.max(...longitudinal) + .015;
  const minLateral = Math.min(...lateral) - .02;
  const maxLateral = Math.max(...lateral) + .02;
  const polygon = [[minLong, minLateral], [maxLong, minLateral],
    [maxLong, maxLateral], [minLong, maxLateral]].map(([along, across]) => [
    Math.max(0, Math.min(1, axis[0] * along + normal[0] * across)),
    Math.max(0, Math.min(1, axis[1] * along + normal[1] * across)),
  ] as [number, number]);
  const area = Math.abs(polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
  if (area < .001) return null;
  return { polygon, agreeingTracks: supporters.length, sampledTracks: motion.length };
}

export function calibrationProgress(cameras: Camera[], statuses: CameraZoneStatus[]) {
  const videoCameras = cameras.filter(camera => camera.stream_url);
  const statusByCamera = new Map(statuses.map(status => [status.camera_id, status]));
  const ready = videoCameras.filter(camera => statusByCamera.get(camera.id)?.ready_for_road_analysis).length;
  return { total: videoCameras.length, ready, pending: videoCameras.length - ready };
}

export function calibrationCorridorProgress(
  cameras: Camera[],
  statuses: CameraZoneStatus[],
): RoadCorridorProgress[] {
  const statusByCamera = new Map(statuses.map(status => [status.camera_id, status]));
  const groups = new Map<string, { route: string; direction: string; cameras: Camera[]; ready: number }>();
  for (const camera of cameras.filter(item => item.stream_url)) {
    const route = camera.route?.trim() || 'Route reference needed';
    const direction = camera.direction?.trim() || 'Direction review';
    const key = `${route.toUpperCase()}|${direction.toLowerCase()}`;
    const group = groups.get(key) || { route, direction, cameras: [], ready: 0 };
    group.cameras.push(camera);
    if (statusByCamera.get(camera.id)?.ready_for_road_analysis) group.ready += 1;
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    const pendingCameras = calibrationQueue(group.cameras, statuses);
    return {
      key, route: group.route, direction: group.direction,
      total: group.cameras.length, ready: group.ready,
      pending: group.cameras.length - group.ready,
      next_camera: pendingCameras[0],
    };
  }).sort((left, right) => right.pending - left.pending
    || right.total - left.total || left.route.localeCompare(right.route)
    || left.direction.localeCompare(right.direction));
}

export function hasPreviouslyVerifiedVideo(camera: Camera): boolean {
  return Number(camera.hls_status) === 200;
}

export function calibrationPlaybackCoverage(cameras: Camera[]) {
  const previouslyVerified = cameras.filter(hasPreviouslyVerifiedVideo).length;
  return {
    pending: cameras.length,
    previouslyVerified,
    playbackCheckRequired: cameras.length - previouslyVerified,
  };
}

export function isCurrentlyPlaying(status: CameraZoneStatus | undefined): boolean {
  return status?.playback_verified === true;
}

export function nextCalibrationCamera(
  cameras: Camera[],
  statuses: CameraZoneStatus[],
  currentCameraId?: string,
): Camera | undefined {
  return calibrationQueue(cameras, statuses, currentCameraId)[0];
}

export function calibrationQueue(
  cameras: Camera[],
  statuses: CameraZoneStatus[],
  currentCameraId?: string,
): Camera[] {
  const statusByCamera = new Map(statuses.map(status => [status.camera_id, status]));
  const currentCamera = cameras.find(camera => camera.id === currentCameraId);
  const currentCorridor = currentCamera?.route && currentCamera.direction
    ? `${currentCamera.route.trim().toUpperCase()}|${currentCamera.direction.trim().toLowerCase()}`
    : undefined;
  const distanceFromCurrent = (camera: Camera) => currentCamera
    ? Math.hypot((camera.lat - currentCamera.lat) * 111_320, (camera.lng - currentCamera.lng)
      * 111_320 * Math.cos(currentCamera.lat * Math.PI / 180))
    : Number.POSITIVE_INFINITY;
  return cameras
    .filter(camera => camera.id !== currentCameraId && camera.stream_url
      && !statusByCamera.get(camera.id)?.ready_for_road_analysis)
    .sort((left, right) => {
      const leftStatus = statusByCamera.get(left.id);
      const rightStatus = statusByCamera.get(right.id);
      const corridorKey = (camera: Camera) => camera.route && camera.direction
        ? `${camera.route.trim().toUpperCase()}|${camera.direction.trim().toLowerCase()}` : undefined;
      const leftInCorridor = currentCorridor && corridorKey(left) === currentCorridor;
      const rightInCorridor = currentCorridor && corridorKey(right) === currentCorridor;
      return Number(Boolean(rightInCorridor)) - Number(Boolean(leftInCorridor))
        || Number(isCurrentlyPlaying(rightStatus)) - Number(isCurrentlyPlaying(leftStatus))
        || Number(hasPreviouslyVerifiedVideo(right)) - Number(hasPreviouslyVerifiedVideo(left))
        || Number(rightStatus?.route_metadata_available) - Number(leftStatus?.route_metadata_available)
        || distanceFromCurrent(left) - distanceFromCurrent(right)
        || left.name.localeCompare(right.name);
    });
}

export function canSaveRoadZone(
  enabled: boolean,
  polygonPointCount: number,
  revision: number | undefined,
  selectedDirectionPointCount: number,
): boolean {
  return enabled && polygonPointCount >= 3
    && ((revision ?? 0) > 0 || selectedDirectionPointCount === 2);
}
