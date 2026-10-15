import type { Camera, MobilityCase, Observation, ReviewStatus, Signal } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (init?.signal?.aborted) cancel();
  else init?.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
  try {
    const response = await fetch(`/api/v1/mobility${path}`, { ...init, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...init?.headers } });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail || 'No se pudo completar la operación.'); }
    return await response.json();
  } catch (error) {
    if (timedOut) throw new Error(path.includes('/observation') ? 'El servicio tardó demasiado en responder. Reintenta la consulta; se conserva la última observación disponible.' : 'El servicio tardó demasiado en responder. Consulta el estado de la operación antes de volver a intentarlo.');
    throw error;
  } finally {
    clearTimeout(timer); init?.signal?.removeEventListener('abort', cancel);
  }
}
export const getCameras = () => request<Camera[]>('/cameras');
export const getObservation = (id: string, signal?: AbortSignal) => request<Observation>(`/cameras/${encodeURIComponent(id)}/observation`, { signal });
export const getHistory = (id: string, signal?: AbortSignal) => request<Observation[]>(`/cameras/${encodeURIComponent(id)}/history`, { signal });
export const getCases = () => request<MobilityCase[]>('/cases');
export const connectCamera = (payload: { name: string; source: string; lat: number; lng: number }) => request<Camera>('/cameras', { method: 'POST', body: JSON.stringify(payload) });
export const openCase = (signal: Signal, owner: string) => request<MobilityCase>('/cases', { method: 'POST', body: JSON.stringify({ signal_id: signal.id, title: `${signal.title} · ${signal.location}`, severity: signal.severity, owner, note: signal.action, data_origin: signal.data_origin || 'presentation', evidence_camera_id: signal.evidence_camera_id, evidence_frame_id: signal.evidence_frame_id, confidence: signal.confidence }) });
export const reviewCase = (id: string, status: ReviewStatus, owner: string, note: string) => request<MobilityCase>(`/cases/${id}`, { method: 'PATCH', body: JSON.stringify({ status, owner, note }) });
