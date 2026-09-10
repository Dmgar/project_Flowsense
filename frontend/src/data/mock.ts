import type {
  GeoJsonEdgeFeature,
  ReplayFrame,
  RouteResponse,
  RouteStep,
  VehiclePosition,
  BenchmarkData,
  MissionAlert,
} from '../types';

const MANHATTAN_CENTER: [number, number] = [-73.9857, 40.7484];

export function generateMockEdges(): GeoJsonEdgeFeature[] {
  const edges: GeoJsonEdgeFeature[] = [];
  const startLat = 40.7440;
  const startLon = -73.9900;
  const rows = 11;
  const cols = 7;
  const dLat = 0.0019;
  const dLon = 0.0028;

  let id = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const lat = startLat + r * dLat;
      const lon1 = startLon + c * dLon;
      const lon2 = startLon + (c + 1) * dLon;
      const cg = Math.random() * 0.4;
      const color = cg < 0.35 ? '#00e676' : cg < 0.7 ? '#ffab00' : '#ff1744';
      edges.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [lon1, lat],
            [lon2, lat],
          ],
        },
        properties: {
          u: id,
          v: id + 1,
          key: 0,
          name: `W ${34 + r}th St`,
          length: 155 + Math.random() * 30,
          highway: 'residential',
          lanes: 2,
          maxspeed: 45,
          congestion_factor: cg,
          vehicle_count: Math.floor(cg * 30),
          average_speed_kmh: 50 * (1 - cg),
          emergency_weight: 155 * (1 + 3 * cg),
          color,
        },
      });
      id += 2;
    }
  }

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows - 1; r++) {
      const lon = startLon + c * dLon;
      const lat1 = startLat + r * dLat;
      const lat2 = startLat + (r + 1) * dLat;
      const cg = Math.random() * 0.3;
      const color = cg < 0.35 ? '#00e676' : cg < 0.7 ? '#ffab00' : '#ff1744';
      edges.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [lon, lat1],
            [lon, lat2],
          ],
        },
        properties: {
          u: id,
          v: id + 1,
          key: 0,
          name: `${9 + c}th Ave`,
          length: 280 + Math.random() * 20,
          highway: 'primary',
          lanes: 3,
          maxspeed: 50,
          congestion_factor: cg,
          vehicle_count: Math.floor(cg * 40),
          average_speed_kmh: 55 * (1 - cg),
          emergency_weight: 280 * (1 + 3 * cg) * 0.85,
          color,
        },
      });
      id += 2;
    }
  }

  return edges;
}

export function mockRoute(frames: number, frameIdx: number): RouteResponse {
  const progress = frameIdx / frames;
  const originLat = 40.744;
  const originLon = -73.988;
  const destLat = 40.756;
  const destLon = -73.982;

  const waypointCount = 10;
  const waypoints: RouteStep[] = [];
  const coords: [number, number][] = [];

  const reachedCount = Math.floor(progress * waypointCount);
  for (let i = 0; i <= reachedCount; i++) {
    const lat = originLat + (destLat - originLat) * (i / waypointCount);
    const lon = originLon + (destLon - originLon) * (i / waypointCount) + Math.sin((i / waypointCount) * Math.PI) * 0.002;
    waypoints.push({
      node_id: 1000 + i,
      latitude: lat,
      longitude: lon,
      street_name: `Corredor ${i}`,
      length_m: 220,
      congestion_factor: 0.2,
      estimated_duration_s: 16,
    });
    coords.push([lon, lat]);
  }

  const totalDist = 2700;
  const totalTime = Math.max(1, 320 - progress * (320 - 180));

  return {
    route_id: 'route_mock_001',
    vehicle_type: 'ambulance',
    total_distance_m: totalDist,
    total_estimated_time_s: totalTime,
    path_node_ids: waypoints.map((w) => w.node_id),
    waypoints,
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: {},
        },
      ],
    },
    status: 'cleared',
    recalculated: frameIdx > 4,
    baseline_eta_seconds: 420,
    baseline_distance_m: 3200,
    savings_pct: 0,
    static_geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [originLon, originLat],
              [destLon - 0.012, destLat + 0.014],
              [destLon - 0.004, destLat],
            ],
          },
          properties: {},
        },
      ],
    },
  };
}

export function generateMockReplay(frames = 30): ReplayFrame[] {
  const baseEdges = generateMockEdges();
  const result: ReplayFrame[] = [];
  const baseTime = Date.now() - frames * 3000;

  for (let f = 0; f < frames; f++) {
    const edges = baseEdges.map((e) => {
      const drift = Math.sin(f * 0.3 + e.properties.u) * 0.15;
      const cg = Math.max(0, Math.min(1, e.properties.congestion_factor + drift));
      return {
        u: e.properties.u,
        v: e.properties.v,
        key: e.properties.key,
        congestion_factor: cg,
        vehicle_count: Math.floor(cg * 35),
      };
    });

    const progress = f / frames;
    const vehicle: VehiclePosition = {
      vehicle_id: 'EMS-MOCK-001',
      latitude: 40.744 + progress * 0.012,
      longitude: -73.985 + Math.sin(progress * Math.PI) * 0.003,
      heading: 0 + Math.sin(progress * Math.PI * 2) * 15,
      speed_kmh: 35 + Math.random() * 15,
      current_node: f,
      target_node: f + 1,
      route_id: 'route_mock_001',
      corridor_cleared_ahead_m: 280,
    };

    const alert: MissionAlert | null =
      f % 5 === 0
        ? {
            message: `Corredor despejado en ${['Broadway', '7th Ave', 'W 42nd St', '9th Ave'][f % 4]}`,
            severity: 'info',
            timestamp: new Date(baseTime + f * 3000).toISOString(),
          }
        : null;

    result.push({
      timestamp: baseTime + f * 3000,
      edges,
      vehicles: [vehicle],
      alerts: alert ? [alert] : [],
      route: mockRoute(frames, f),
    });
  }

  return result;
}

export const MOCK_BENCHMARK: BenchmarkData[] = [
  { metric: 'Tiempo Promedio (s)', static: 245, flowsense: 178 },
  { metric: 'Distancia (m)', static: 3200, flowsense: 2850 },
  { metric: 'Intersecciones Bloqueadas', static: 4, flowsense: 1 },
  { metric: 'Tasa de Éxito (%)', static: 72, flowsense: 96 },
  { metric: 'Segundos Salvados', static: 0, flowsense: 67 },
];

export { MANHATTAN_CENTER };
