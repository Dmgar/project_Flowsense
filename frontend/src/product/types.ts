export type Severity = 'low' | 'medium' | 'high';
export type ReviewStatus = 'new' | 'assigned' | 'under_review' | 'confirmed' | 'resolved' | 'dismissed';
export interface Camera {
  id: string; name: string; district: string; lat: number; lng: number;
  verification?: string; verified_at?: string; provider_in_service?: boolean; nearby_place?: string; route?: string;
  image_url: string; stream_url: string; source_url: string; provider: string;
  status: 'online' | 'provider_notice' | 'stale' | 'unverified'; refresh_seconds: number; last_observed_at: string | null;
  observation_age_seconds?: number | null;
  hls_status?: number | string;
  last_source_status?: 'provider_notice' | 'image' | null;
}
export interface Detection { className: string; confidence: number; bbox: { x: number; y: number; width: number; height: number } }
export interface Observation {
  source_status?: 'provider_notice' | 'image';
  camera_id: string; observed_at: string; provider_frame_time: string | null; frame_id: string;
  width: number; height: number; detections: Detection[]; counts: Record<string, number> | null;
  inference_status: 'ready' | 'unavailable'; inference_error: string | null; note: string;
}
export interface MobilityCase {
  id: string; signal_id: string; title: string; owner: string; severity: Severity;
  status: ReviewStatus; data_origin: 'presentation' | 'observation'; note: string;
  created_at: string; updated_at: string; audit: { at: string; action: string; note: string; owner: string }[];
  evidence_camera_id?: string | null; evidence_frame_id?: string | null; confidence?: number | null;
}
export interface Signal {
  id: string; title: string; location: string; district: string; type: string; severity: Severity;
  confidence: number | null; impact: number; evidence: string; duration: number; lat: number; lng: number;
  action: string; owner: string; cameraIndex: number; causes: string[];
  data_origin?: 'presentation' | 'observation'; evidence_camera_id?: string; evidence_frame_id?: string;
}
export interface Corridor { id: string; name: string; district: string; length: number; intersections: number; congestion: number; speed: number; truck: number; queue: number; pedestrians: number; lat: number; lng: number }
