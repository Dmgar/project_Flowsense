import type { Camera, MobilityCase, Observation, ReviewStatus, Signal } from './types';
import { apiUrl } from '../api/urls.ts';
import { apiErrorMessage } from '../api/errors.ts';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (init?.signal?.aborted) cancel();
  else init?.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
  try {
    const response = await fetch(apiUrl(`/api/v1/mobility${path}`), {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-FlowSense-Key': 'flowsense-operator-v1', ...init?.headers },
    });
    if (!response.ok) { const body: unknown = await response.json().catch(() => null); throw new Error(apiErrorMessage(body, 'The operation could not be completed.')); }
    return await response.json();
  } catch (error) {
    if (timedOut) throw new Error(path.includes('/observation') ? 'The service took too long to respond. Retry the request; the latest observation remains available.' : 'The service took too long to respond. Check the operation status before retrying.');
    throw error;
  } finally {
    clearTimeout(timer); init?.signal?.removeEventListener('abort', cancel);
  }
}
function resolveCamera(camera: Camera): Camera {
  return { ...camera, image_url: apiUrl(camera.image_url), stream_url: apiUrl(camera.stream_url) };
}
export const getCameras = async (signal?: AbortSignal) => (await request<Camera[]>('/cameras', { signal })).map(resolveCamera);
export const getObservation = (id: string, signal?: AbortSignal) => request<Observation>(`/cameras/${encodeURIComponent(id)}/observation`, { signal });
export const getHistory = (id: string, signal?: AbortSignal) => request<Observation[]>(`/cameras/${encodeURIComponent(id)}/history`, { signal });
export const getCases = (signal?: AbortSignal) => request<MobilityCase[]>('/cases', { signal });
export const connectCamera = async (payload: { name: string; source: string; lat: number; lng: number }) => resolveCamera(await request<Camera>('/cameras', { method: 'POST', body: JSON.stringify(payload) }));
export const openCase = (signal: Signal, owner: string) => request<MobilityCase>('/cases', { method: 'POST', body: JSON.stringify({ signal_id: signal.id, title: `${signal.title} · ${signal.location}`, severity: signal.severity, owner, note: signal.action, data_origin: signal.data_origin || 'presentation', evidence_camera_id: signal.evidence_camera_id, evidence_frame_id: signal.evidence_frame_id, confidence: signal.confidence }) });
export const reviewCase = (id: string, status: ReviewStatus, owner: string, note: string) => request<MobilityCase>(`/cases/${id}`, { method: 'PATCH', body: JSON.stringify({ status, owner, note }) });
