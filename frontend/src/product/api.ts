import type { Camera, MobilityCase, Observation, ReviewStatus, Signal } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/mobility${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail || 'No se pudo completar la operación.'); }
  return response.json();
}
export const getCameras = () => request<Camera[]>('/cameras');
export const getObservation = (id: string) => request<Observation>(`/cameras/${encodeURIComponent(id)}/observation`);
export const getHistory = (id: string) => request<Observation[]>(`/cameras/${encodeURIComponent(id)}/history`);
export const getCases = () => request<MobilityCase[]>('/cases');
export const connectCamera = (payload: { name: string; source: string; lat: number; lng: number }) => request<Camera>('/cameras', { method: 'POST', body: JSON.stringify(payload) });
export const openCase = (signal: Signal, owner: string) => request<MobilityCase>('/cases', { method: 'POST', body: JSON.stringify({ signal_id: signal.id, title: `${signal.title} · ${signal.location}`, severity: signal.severity, owner, note: signal.action, data_origin: signal.data_origin || 'presentation', evidence_camera_id: signal.evidence_camera_id, evidence_frame_id: signal.evidence_frame_id, confidence: signal.confidence }) });
export const reviewCase = (id: string, status: ReviewStatus, owner: string, note: string) => request<MobilityCase>(`/cases/${id}`, { method: 'PATCH', body: JSON.stringify({ status, owner, note }) });
