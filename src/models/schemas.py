from typing import Any, Optional, List
from pydantic import BaseModel, Field

class Coordinates(BaseModel):
    latitude: float = Field(..., description="Latitude in decimal degrees", ge=-90.0, le=90.0)
    longitude: float = Field(..., description="Longitude in decimal degrees", ge=-180.0, le=180.0)

class TrafficSignalUpdate(BaseModel):
    u: int = Field(..., description="Starting node ID of the road edge")
    v: int = Field(..., description="Ending node ID of the road edge")
    key: int = Field(default=0, description="Edge multi-graph key")
    vehicle_count: int = Field(default=0, ge=0, description="Counted vehicles in segment")
    average_speed_kmh: float = Field(default=30.0, ge=0.0, description="Observed flow speed")
    congestion_factor: float = Field(
        ..., 
        ge=0.0, 
        le=1.0, 
        description="Normalized congestion level: 0.0 (free flow) to 1.0 (gridlock)"
    )
    camera_id: Optional[str] = Field(default=None, description="Camera feed identifier")
    timestamp: Optional[str] = Field(default=None, description="ISO timestamp")

class BatchTrafficUpdate(BaseModel):
    updates: List[TrafficSignalUpdate]
    timestamp: Optional[str] = None

class DispatchRequest(BaseModel):
    origin: Coordinates
    destination: Coordinates
    vehicle_type: str = Field(default="ambulance", description="Vehicle type: ambulance or fire_truck")
    priority: str = Field(default="high", description="Emergency priority level")

class RouteStep(BaseModel):
    node_id: int
    latitude: float
    longitude: float
    street_name: Optional[str] = None
    length_m: float = 0.0
    congestion_factor: float = 0.0
    estimated_duration_s: float = 0.0

class RouteResponse(BaseModel):
    route_id: str
    vehicle_type: str
    total_distance_m: float
    total_estimated_time_s: float
    path_node_ids: List[int]
    waypoints: List[RouteStep]
    geojson: dict[str, Any]
    status: str = "optimal"
    recalculated: bool = False
    baseline_eta_seconds: float = 0.0
    baseline_distance_m: float = 0.0
    savings_pct: float = 0.0
    static_geojson: Optional[dict[str, Any]] = None

class GraphStatus(BaseModel):
    city: str
    node_count: int
    edge_count: int
    congested_edges_count: int
    avg_congestion_factor: float
    cache_loaded: bool

class IncidentReport(BaseModel):
    latitude: float = Field(..., description="Latitude of the incident location", ge=-90.0, le=90.0)
    longitude: float = Field(..., description="Longitude of the incident location", ge=-180.0, le=180.0)
    description: str = Field(default="Traffic bottleneck reported", description="Brief description of the event")
    severity: str = Field(default="critical", description="Severity level: info, warning, or critical")
    radius_m: float = Field(default=180.0, description="Affected radius in meters", ge=50.0, le=1000.0)
    block_traffic: bool = Field(default=True, description="Whether the street is completely impassable")

class IncidentResponse(BaseModel):
    incident_id: str
    affected_nodes: List[int]
    affected_edges_count: int
    message: str
    alert_broadcasted: bool

class BenchmarkMetric(BaseModel):
    metric: str
    static: float
    flowsense: float

class BenchmarkSummaryResponse(BaseModel):
    num_trips_evaluated: int
    average_time_savings_pct: float
    total_seconds_saved: float
    success_rate_pct: float
    metrics: List[BenchmarkMetric]

class TrafficLightState(BaseModel):
    node_id: int
    intersection_name: str
    state: str = Field(default="normal", description="normal, preempted, clearing")
    cleared_direction_deg: Optional[float] = None
    preempted_by_vehicle: Optional[str] = None
    expires_at: Optional[str] = None

class CameraDevice(BaseModel):
    camera_id: str
    name: str
    intersection_node: int
    latitude: float
    longitude: float
    bearing_degrees: float = 0.0
    status: str = "online"
    latest_vehicle_count: int = 0
    latest_speed_kmh: float = 45.0
    latest_congestion_factor: float = 0.0
    last_update: Optional[str] = None

class CameraTelemetryReport(BaseModel):
    camera_id: str
    vehicle_count: int = Field(..., ge=0)
    average_speed_kmh: float = Field(default=35.0, ge=0.0)
    congestion_factor: float = Field(..., ge=0.0, le=1.0)
    frame_timestamp: Optional[str] = None


# ---- Advanced Routing Schemas ----

class AlternativeRoutesResponse(BaseModel):
    """Response containing a primary route and K-1 alternative corridors."""
    primary: RouteResponse
    alternatives: List[RouteResponse]
    algorithm: str = Field(default="astar", description="Algorithm used: astar, dijkstra, nsga2")


class FleetDispatchRequest(BaseModel):
    """Request for multi-vehicle fleet optimisation."""
    vehicles: List[DispatchRequest]
    optimize_for: str = Field(
        default="min_total_eta",
        description="Optimization objective: min_total_eta | min_max_congestion | balanced",
    )

class RerouteRequest(BaseModel):
    """Request to recalculate dynamic emergency route mid-transit."""
    route_id: str = Field(..., description="ID of the currently active route being updated")
    current_position: Coordinates = Field(..., description="Current GPS coordinates of the vehicle")
    destination: Coordinates = Field(..., description="Destination GPS coordinates")
    vehicle_type: str = Field(default="ambulance", description="Vehicle type: ambulance or fire_truck")
    priority: str = Field(default="critical", description="Emergency priority level")

class ClearanceCorridorRequest(BaseModel):
    """Request to apply green wave pre-clearance impedance reductions along a path."""
    path_nodes: List[int] = Field(..., description="Ordered list of node IDs forming the corridor")
    reduction_factor: float = Field(default=0.3, ge=0.05, le=0.8, description="Percentage impedance reduction")


# ---- Perception Engine Schemas ----

class PerceptionStatus(BaseModel):
    """Status snapshot of the perception pipeline for a camera."""
    camera_id: str
    pipeline_active: bool
    model_loaded: str
    fps_processing: float
    last_detection_count: int
    last_congestion_factor: float

