# Suggested Data Contracts

These are frontend-friendly shapes for mocked data or API integration. They are not final backend contracts.

## Shared Types

```ts
type Severity = "low" | "medium" | "high";
type ReviewStatus =
  | "new"
  | "human_review_required"
  | "under_review"
  | "assigned"
  | "confirmed"
  | "resolved"
  | "dismissed";

type GeoPoint = {
  lat: number;
  lng: number;
};

type TimeRange = {
  from: string;
  to: string;
  label: string;
};
```

## Camera

```ts
type Camera = {
  id: string;
  name: string;
  locationName: string;
  district: string;
  position: GeoPoint;
  status: "online" | "degraded" | "offline";
  streamUrl?: string;
  lastFrameUrl?: string;
  uptimePct?: number;
  health: {
    videoFeed: "good" | "degraded" | "offline";
    network: "good" | "degraded" | "offline";
    imageQuality: "good" | "degraded" | "poor";
  };
};
```

## Detection

```ts
type Detection = {
  id: string;
  cameraId: string;
  timestamp: string;
  className:
    | "car"
    | "motorcycle"
    | "bus"
    | "truck"
    | "bicycle"
    | "pedestrian";
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  laneId?: string;
  trackId?: string;
};
```

## Road Segment

```ts
type RoadSegment = {
  id: string;
  name: string;
  corridorId?: string;
  geometry: GeoPoint[];
  congestionFactor: number;
  avgSpeedKmh: number;
  baselineSpeedKmh?: number;
  vehicleCount: number;
  pedestrianCount?: number;
  truckSharePct?: number;
  status: "normal" | "moderate" | "high" | "blocked";
};
```

## Corridor

```ts
type Corridor = {
  id: string;
  name: string;
  district: string;
  lengthKm: number;
  intersections: number;
  segmentIds: string[];
  metrics: {
    congestionFactor: number;
    avgSpeedKmh: number;
    truckPressureIndex: number;
    pedestrianCrossingsDaily: number;
    queueLengthMeters: number;
  };
  baseline: {
    congestionFactor: number;
    avgSpeedKmh: number;
    truckPressureIndex: number;
    pedestrianCrossingsDaily: number;
    queueLengthMeters: number;
  };
};
```

## Hotspot

```ts
type Hotspot = {
  id: string;
  rank: number;
  locationName: string;
  district: string;
  issueType:
    | "bottleneck"
    | "freight_overload"
    | "pedestrian_crowding"
    | "signal_timing_anomaly"
    | "queue_spillback"
    | "bus_corridor_delay";
  severity: Severity;
  confidence: number;
  evidenceLabel: string;
  impactLabel: string;
  suggestedAction: string;
  ownerTeam: string;
  status: ReviewStatus;
  relatedCameraIds: string[];
  relatedSegmentIds: string[];
  pilotKpi?: {
    label: string;
    baseline: string;
    target: string;
  };
};
```

## Risk Signal

```ts
type RiskSignal = {
  id: string;
  signalType:
    | "stopped_vehicle"
    | "lane_blockage"
    | "sudden_congestion_spike"
    | "wrong_way_movement"
    | "near_miss_pattern"
    | "curb_misuse"
    | "motorcycle_weaving"
    | "event_crowding_surge";
  locationName: string;
  district: string;
  position: GeoPoint;
  severity: Severity;
  confidence: number;
  firstDetectedAt: string;
  durationSeconds: number;
  status: ReviewStatus;
  evidenceCameraIds: string[];
  supportingMetrics: {
    label: string;
    value: string;
    severity?: Severity;
  }[];
  possibleCauses: string[];
  recommendedReview: string[];
};
```

## Pedestrian Zone

```ts
type PedestrianZone = {
  id: string;
  name: string;
  district: string;
  geometry: GeoPoint[];
  crossingDemandPerHour: number;
  crowdingIndex: number;
  waitTimeSeconds: number;
  nearConflictsPerHour: number;
  context: {
    schoolZoneActive: boolean;
    eventSurgeActive: boolean;
    weather?: string;
  };
};
```

## Emergency Corridor

```ts
type EmergencyCorridor = {
  id: string;
  incidentCode: string;
  vehicleType: "ambulance" | "fire" | "police" | "other";
  origin: {
    label: string;
    position: GeoPoint;
  };
  destination: {
    label: string;
    position: GeoPoint;
  };
  primaryRoute: RouteOption;
  backupRoutes: RouteOption[];
  decisionSupportNote: string;
};

type RouteOption = {
  id: string;
  label: string;
  segmentIds: string[];
  etaMin: number;
  etaMax: number;
  reliabilityPct: number;
  delayRisk: "low" | "moderate" | "high";
  checkpoints: {
    id: string;
    label: string;
    cameraId?: string;
    cameraConfirmed: boolean;
    expectedTime: string;
  }[];
};
```
