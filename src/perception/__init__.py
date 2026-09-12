"""
FlowSense Perception Engine — OpenCV 5 based vehicle detection, tracking,
and real-time congestion estimation for urban traffic cameras.

Public API:
    - VehicleDetector   — ONNX model inference (YOLOv8n via OpenCV DNN)
    - VehicleTracker    — Multi-object IoU tracker with speed estimation
    - CongestionEstimator — Density × speed-degradation congestion formula
    - PerceptionPipeline — End-to-end frame-by-frame orchestrator

Data models:
    - Detection, TrackedVehicle, CongestionMetrics
"""
from src.perception.models import (
    Detection,
    TrackedVehicle,
    CongestionMetrics,
    VEHICLE_CLASS_IDS,
    VEHICLE_CLASS_NAMES,
)
from src.perception.detector import VehicleDetector
from src.perception.tracker import VehicleTracker
from src.perception.congestion_estimator import CongestionEstimator
from src.perception.pipeline import PerceptionPipeline

__all__ = [
    "Detection",
    "TrackedVehicle",
    "CongestionMetrics",
    "VEHICLE_CLASS_IDS",
    "VEHICLE_CLASS_NAMES",
    "VehicleDetector",
    "VehicleTracker",
    "CongestionEstimator",
    "PerceptionPipeline",
]
