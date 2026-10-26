import type { Camera } from './types';
import type { GeoJsonEdgeFeature } from '../types';

export function normalizeStreet(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(calle|autopista)\b/g, ' ').replace(/\bavenida\b/g, 'ave')
    .replace(/\b(interstate|freeway|fwy|highway|hwy|route|rte)\b/g, ' ')
    .replace(/\bi[\s-]*(\d+)/g, '$1')
    .replace(/\b(street|st)\b/g, 'st').replace(/\b(avenue|ave|av)\b/g, 'ave')
    .replace(/\b(boulevard|blvd)\b/g, 'blvd').replace(/\b(road|rd)\b/g, 'rd')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function containsWords(text: string, query: string) {
  const words = normalizeStreet(text).split(' ');
  return normalizeStreet(query).split(' ').filter(Boolean).every(token => /^\d+$/.test(token) ? words.includes(token) : words.some(word => word.startsWith(token)));
}

export function cameraMatches(camera: Camera, query: string) {
  return containsWords(`${camera.name} ${camera.district} ${camera.nearby_place || ''} ${camera.route || ''} ${camera.id}`, query);
}

export function distanceToLineKm(lat: number, lng: number, coordinates: number[][]): number {
  const scaleX = 111.32 * Math.cos(lat * Math.PI / 180);
  let nearest = Infinity;
  for (let i = 1; i < coordinates.length; i++) {
    const ax = (coordinates[i - 1][0] - lng) * scaleX, ay = (coordinates[i - 1][1] - lat) * 111.32;
    const bx = (coordinates[i][0] - lng) * scaleX, by = (coordinates[i][1] - lat) * 111.32;
    const dx = bx - ax, dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return nearest;
}

export function nearbyCameraOptions(cameras: Camera[], origin: Camera, maxKm = 10) {
  return cameras.filter(camera => camera.id !== origin.id && camera.stream_url)
    .map(camera => ({ camera, distanceKm: distanceToLineKm(origin.lat, origin.lng, [[camera.lng, camera.lat], [camera.lng, camera.lat]]) }))
    .filter(item => item.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 3);
}

export interface EvidenceHit { camera: Camera; match: 'catalog' | 'nearby'; distanceKm: number | null }
export function evidenceResultsStatus({
  searching, catalogLoaded, catalogFailed, cameraCount, nearbyCount,
}: {
  searching: boolean; catalogLoaded: boolean; catalogFailed: boolean; cameraCount: number; nearbyCount: number;
}) {
  if (searching) return 'Searching…';
  if (catalogFailed) return cameraCount
    ? `${cameraCount} cameras shown · catalog refresh unavailable`
    : 'Camera catalog unavailable';
  if (!catalogLoaded) return cameraCount
    ? `${cameraCount} cameras shown · refreshing sources`
    : 'Loading camera sources…';
  return `${cameraCount} cameras · ${nearbyCount} by proximity`;
}

export function findStreetMatches(edges: GeoJsonEdgeFeature[], query: string) {
  const meaningful = normalizeStreet(query).length >= 2;
  const seen = new Set<string>();
  return meaningful ? edges.filter(edge => {
    if (!edge.properties.name || edge.geometry.type !== 'LineString' || !containsWords(edge.properties.name, query)) return false;
    const key = [edge.properties.u, edge.properties.v].sort().join('-');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }) : [];
}

export function searchEvidence(cameras: Camera[], edges: GeoJsonEdgeFeature[], query: string, radiusKm = 1.5, streetMatches?: GeoJsonEdgeFeature[]) {
  const meaningful = normalizeStreet(query).length >= 2;
  const streets = streetMatches ?? findStreetMatches(edges, query);
  const hits: EvidenceHit[] = [];
  for (const camera of cameras) {
    const direct = !meaningful || cameraMatches(camera, query);
    const distanceKm = streets.length ? Math.min(...streets.map(edge => edge.geometry.type === 'LineString' ? distanceToLineKm(camera.lat, camera.lng, edge.geometry.coordinates) : Infinity)) : Infinity;
    if (direct || distanceKm <= radiusKm) hits.push({ camera, match: direct ? 'catalog' : 'nearby', distanceKm: Number.isFinite(distanceKm) ? distanceKm : null });
  }
  hits.sort((a, b) => Number(a.match === 'nearby') - Number(b.match === 'nearby') || (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.camera.name.localeCompare(b.camera.name));
  return { hits, streets };
}
