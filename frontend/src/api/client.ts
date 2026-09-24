import type {
  GraphStatus,
  GeoJsonEdgeFeature,
  RouteResponse,
  DispatchRequest,
  AlternativeRoutesResponse,
} from '../types';

const BASE = '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null) as { detail?: string } | null;
    throw new Error(payload?.detail || `API ${res.status}: ${res.statusText}`);
  }
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

export function computeAlternativeRoutes(
  req: DispatchRequest,
  count = 3
): Promise<AlternativeRoutesResponse> {
  return apiFetch<AlternativeRoutesResponse>(`/api/v1/dispatch/alternatives?k=${count}`, {
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

export function fetchBenchmarkSummary(): Promise<{ metrics: { metric: string; static: number; flowsense: number }[] }> {
  return apiFetch('/api/v1/benchmark/summary');
}

export function runBenchmark(numSamples = 15): Promise<{ metrics: { metric: string; static: number; flowsense: number }[] }> {
  return apiFetch(`/api/v1/benchmark/run?num_samples=${numSamples}`, { method: 'POST' });
}

export function fetchReplayLatest(frames = 30): Promise<unknown[]> {
  return apiFetch(`/api/v1/replay/latest?frames=${frames}`);
}

export function reportIncident(payload: {
  latitude: number;
  longitude: number;
  description?: string;
  severity?: 'info' | 'warning' | 'critical';
  radius_m?: number;
  block_traffic?: boolean;
}): Promise<unknown> {
  return apiFetch('/api/v1/traffic/incident', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function clearIncident(incidentId: string): Promise<unknown> {
  return apiFetch(`/api/v1/traffic/incident/${incidentId}/clear`, { method: 'POST' });
}

export function fetchSignals(): Promise<unknown[]> {
  return apiFetch('/api/v1/signals');
}

export function fetchActiveSignals(): Promise<unknown[]> {
  return apiFetch('/api/v1/signals/active');
}

export function preemptSignal(nodeId: number, vehicleId = 'EMS-MEDIC-101', duration = 20): Promise<unknown> {
  return apiFetch(`/api/v1/signals/${nodeId}/preempt?vehicle_id=${vehicleId}&duration_seconds=${duration}`, { method: 'POST' });
}

export function releaseSignal(nodeId: number): Promise<unknown> {
  return apiFetch(`/api/v1/signals/${nodeId}/release`, { method: 'POST' });
}

export function fetchCameras(): Promise<unknown[]> {
  return apiFetch('/api/v1/cameras');
}

export function fetchCamerasGeoJson(): Promise<GeoJSON.FeatureCollection> {
  return apiFetch('/api/v1/cameras/geojson');
}

export function sendCameraTelemetry(
  cameraId: string,
  payload: { vehicle_count: number; average_speed_kmh?: number; congestion_factor: number }
): Promise<unknown> {
  return apiFetch(`/api/v1/cameras/${cameraId}/telemetry`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
