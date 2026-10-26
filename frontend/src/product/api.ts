import type { Camera, MobilityCase, Observation, ReviewStatus, Signal } from './types';
import { apiUrl } from '../api/urls.ts';
import { apiErrorMessage, flowSenseUnreachableMessage, flowSenseUnavailableMessage } from '../api/errors.ts';

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
    }).catch(error => {
      if (error instanceof TypeError && !controller.signal.aborted) {
        throw new Error(flowSenseUnreachableMessage);
      }
      throw error;
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message = apiErrorMessage(body, 'The operation could not be completed.');
      if (response.status >= 500 && message === 'The operation could not be completed.') {
        throw new Error(flowSenseUnavailableMessage);
      }
      throw new Error(message);
    }
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
export const getCameras = async (signal?: AbortSignal) => (await request<Camera[]>('/cameras?video_only=true', { signal })).filter(camera => camera.stream_url).map(resolveCamera);
export const getObservation = (id: string, signal?: AbortSignal) => request<Observation>(`/cameras/${encodeURIComponent(id)}/observation`, { signal });
export const getHistory = (id: string, signal?: AbortSignal) => request<Observation[]>(`/cameras/${encodeURIComponent(id)}/history`, { signal });
export const getCases = (signal?: AbortSignal) => request<MobilityCase[]>('/cases', { signal });
export const connectCamera = async (payload: { name: string; source: string; lat: number; lng: number }) => resolveCamera(await request<Camera>('/cameras', { method: 'POST', body: JSON.stringify(payload) }));
export const openCase = (signal: Signal, owner: string) => request<MobilityCase>('/cases', { method: 'POST', body: JSON.stringify({ signal_id: signal.id, title: `${signal.title} · ${signal.location}`, severity: signal.severity, owner, note: signal.action, data_origin: signal.data_origin || 'presentation', evidence_camera_id: signal.evidence_camera_id, evidence_frame_id: signal.evidence_frame_id, evidence_session_id: signal.evidence_session_id, evidence_media_time_seconds: signal.evidence_media_time_seconds, confidence: signal.confidence }) });
export const reviewCase = (id: string, status: ReviewStatus, owner: string, note: string) => request<MobilityCase>(`/cases/${id}`, { method: 'PATCH', body: JSON.stringify({ status, owner, note }) });
export const recordPolicyAcceptance = (payload: { form_type: 'camera_connection' | 'case_review' | 'emergency_corridor'; operator_reference: string; terms_accepted: boolean; privacy_acknowledged: boolean }) => request<{ receipt_id: string; accepted_at: string; terms_version: string; terms_sha256: string; privacy_version: string; privacy_sha256: string; identity_strength: string }>('/legal/acceptances', { method: 'POST', body: JSON.stringify(payload) });
