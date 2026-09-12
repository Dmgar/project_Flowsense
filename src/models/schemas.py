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
