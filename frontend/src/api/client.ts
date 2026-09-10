import type {
  GraphStatus,
  GeoJsonEdgeFeature,
  RouteResponse,
  DispatchRequest,
} from '../types';

const BASE = '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export function fetchGraphStatus(): Promise<GraphStatus> {
  return apiFetch<GraphStatus>('/api/v1/graph/status');
}

export async function fetchGraphGeoJson(): Promise<GeoJsonEdgeFeature[]> {
  const fc = await apiFetch<GeoJSON.FeatureCollection>('/api/v1/graph/geojson');
  return (fc.features ?? []) as GeoJsonEdgeFeature[];
}

export function resetGraph(): Promise<unknown> {
  return apiFetch('/api/v1/graph/reset', { method: 'POST' });
}

export function computeRoute(
  req: DispatchRequest,
  simulate = false
): Promise<RouteResponse> {
  const q = simulate ? '?simulate=true' : '';
  return apiFetch<RouteResponse>(`/api/v1/dispatch/route${q}`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function startTrafficSimulation(interval = 3.0): Promise<unknown> {
  return apiFetch(`/api/v1/dispatch/simulate/traffic/start?interval_seconds=${interval}`, {
    method: 'POST',
  });
}

export function stopTrafficSimulation(): Promise<unknown> {
  return apiFetch('/api/v1/dispatch/simulate/traffic/stop', { method: 'POST' });
}
