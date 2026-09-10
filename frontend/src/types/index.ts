export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface TrafficSignalUpdate {
  u: number;
  v: number;
  key: number;
  vehicle_count: number;
  average_speed_kmh: number;
  congestion_factor: number;
  camera_id?: string;
  timestamp?: string;
}

export interface RouteStep {
  node_id: number;
  latitude: number;
  longitude: number;
  street_name: string | null;
  length_m: number;
  congestion_factor: number;
  estimated_duration_s: number;
}

export interface RouteResponse {
  route_id: string;
  vehicle_type: string;
  total_distance_m: number;
  total_estimated_time_s: number;
  path_node_ids: number[];
  waypoints: RouteStep[];
  geojson: GeoJSON.FeatureCollection;
  status: string;
  recalculated: boolean;
  baseline_eta_seconds: number;
  baseline_distance_m: number;
  savings_pct: number;
  static_geojson?: GeoJSON.FeatureCollection | null;
}

export interface GraphStatus {
  city: string;
  node_count: number;
  edge_count: number;
  congested_edges_count: number;
  avg_congestion_factor: number;
  cache_loaded: boolean;
}

export interface DispatchRequest {
  origin: Coordinates;
  destination: Coordinates;
  vehicle_type: 'ambulance' | 'fire_truck';
  priority: string;
}

export type TelemetryEventType =
  | 'traffic_update'
  | 'route_update'
  | 'route_recalculated'
  | 'vehicle_telemetry'
  | 'mission_alert';

export interface WebSocketMessage {
  event: TelemetryEventType;
  data: unknown;
  timestamp: string;
}

export interface VehiclePosition {
  vehicle_id: string;
  latitude: number;
  longitude: number;
  heading: number;
  speed_kmh: number;
  current_node: number | null;
  target_node: number | null;
  route_id: string | null;
  corridor_cleared_ahead_m: number;
}

export interface MissionAlert {
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
}

export interface EdgeUpdate {
  u: number;
  v: number;
  key: number;
  congestion_factor: number;
  vehicle_count: number;
  average_speed_kmh?: number;
}

export interface GeoJsonEdgeFeature extends GeoJSON.Feature {
  properties: {
    u: number;
    v: number;
    key: number;
    name: string | null;
    length?: number;
    highway: string;
    lanes?: number;
    maxspeed?: number;
    congestion_factor: number;
    vehicle_count: number;
    average_speed_kmh: number;
    emergency_weight: number;
    color: string;
  };
}

export interface ReplayFrame {
  timestamp: number;
  edges: EdgeUpdate[];
  vehicles: VehiclePosition[];
  alerts: MissionAlert[];
  route?: RouteResponse;
}

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';

export type VehicleType = 'ambulance' | 'fire_truck';

export interface BenchmarkData {
  metric: string;
  static: number;
  flowsense: number;
}
