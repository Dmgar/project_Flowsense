"""
Internal data models for the FlowSense Perception Engine.
These dataclasses flow through the pipeline: Detector → Tracker → CongestionEstimator.
"""
from dataclasses import dataclass, field
from typing import Tuple


@dataclass
class Detection:
    """A single object detection from the VehicleDetector."""
    bbox: Tuple[int, int, int, int]  # (x, y, width, height) in pixels
    class_id: int
    class_name: str
    confidence: float


@dataclass
class TrackedVehicle:
    """A vehicle tracked across consecutive frames with persistent identity."""
    track_id: int
    bbox: Tuple[int, int, int, int]  # (x, y, width, height) in pixels
    class_name: str
    centroid: Tuple[float, float] = (0.0, 0.0)  # (cx, cy) center of bounding box
    velocity_px_per_frame: float = 0.0
    estimated_speed_kmh: float = 0.0
    age: int = 0  # number of consecutive frames this vehicle has been tracked
    frames_since_seen: int = 0  # frames since the last matched detection


@dataclass
class CongestionMetrics:
    """Aggregated congestion metrics extracted from a single camera frame."""
    vehicle_count: int = 0
    average_speed_kmh: float = 0.0
    congestion_factor: float = 0.0  # Normalized 0.0 (free-flow) to 1.0 (gridlock)
    density_vehicles_per_km2: float = 0.0


# COCO class IDs for vehicle categories used by YOLO models
VEHICLE_CLASS_IDS: dict[int, str] = {
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
}

# All class names we consider as vehicles
VEHICLE_CLASS_NAMES: set[str] = set(VEHICLE_CLASS_IDS.values())
