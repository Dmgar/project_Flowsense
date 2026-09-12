from enum import Enum
from typing import Any, Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field

class TelemetryEventType(str, Enum):
    TRAFFIC_UPDATE = "traffic_update"
    ROUTE_UPDATE = "route_update"
    ROUTE_RECALCULATED = "route_recalculated"
    VEHICLE_TELEMETRY = "vehicle_telemetry"
    MISSION_ALERT = "mission_alert"

class VehiclePositionEvent(BaseModel):
    vehicle_id: str
    latitude: float
    longitude: float
    heading: float = Field(default=0.0, description="Direction in degrees (0-360)")
    speed_kmh: float = Field(default=0.0, description="Current speed in km/h")
    current_node: Optional[int] = None
    target_node: Optional[int] = None
    route_id: Optional[str] = None
    corridor_cleared_ahead_m: float = Field(default=250.0, description="Active emergency clearance buffer in meters")

class MissionAlertEvent(BaseModel):
    message: str
    severity: str = Field(default="info", description="Severity: info, warning, critical")
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class WebSocketMessage(BaseModel):
    event: TelemetryEventType
    data: Any
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
