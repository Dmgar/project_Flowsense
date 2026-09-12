"""
Unit tests for the FlowSense Perception Engine.

Tests the internal perception modules without requiring an actual ONNX model
or video file — all inputs are synthetic.
"""
import numpy as np
import pytest

from src.perception.models import Detection, TrackedVehicle, CongestionMetrics, VEHICLE_CLASS_IDS


# ======================================================================
# Detection dataclass
# ======================================================================

class TestDetectionModel:
    def test_create_detection(self):
        d = Detection(bbox=(100, 200, 50, 60), class_id=2, class_name="car", confidence=0.92)
        assert d.class_name == "car"
        assert d.confidence == 0.92
        assert d.bbox == (100, 200, 50, 60)

    def test_vehicle_class_ids(self):
        assert 2 in VEHICLE_CLASS_IDS  # car
        assert 5 in VEHICLE_CLASS_IDS  # bus
        assert 7 in VEHICLE_CLASS_IDS  # truck
        assert 0 not in VEHICLE_CLASS_IDS  # person — should not be included


# ======================================================================
# Tracker (IoU matching + speed estimation)
# ======================================================================

class TestTracker:
    def test_iou_identical_boxes(self):
        from src.perception.tracker import _iou
        box = (10, 20, 100, 100)
        assert _iou(box, box) == pytest.approx(1.0)

    def test_iou_no_overlap(self):
        from src.perception.tracker import _iou
        assert _iou((0, 0, 10, 10), (100, 100, 10, 10)) == pytest.approx(0.0)

    def test_iou_partial_overlap(self):
        from src.perception.tracker import _iou
        # Boxes overlap in a 5×10 region
        iou = _iou((0, 0, 10, 10), (5, 0, 10, 10))
        assert 0.0 < iou < 1.0

    def test_centroid(self):
        from src.perception.tracker import _centroid
        cx, cy = _centroid((100, 200, 50, 60))
        assert cx == pytest.approx(125.0)
        assert cy == pytest.approx(230.0)

    def test_tracker_creates_new_tracks(self):
        from src.perception.tracker import VehicleTracker

        tracker = VehicleTracker(max_age=5, iou_threshold=0.3, fps=30.0)
        frame = np.zeros((480, 640, 3), dtype=np.uint8)

        detections = [
            Detection(bbox=(100, 100, 50, 50), class_id=2, class_name="car", confidence=0.9),
            Detection(bbox=(300, 300, 60, 40), class_id=7, class_name="truck", confidence=0.85),
        ]

        tracked = tracker.update(detections, frame)
        assert len(tracked) == 2
        assert tracker.get_active_count() == 2

    def test_tracker_matches_across_frames(self):
        from src.perception.tracker import VehicleTracker

        tracker = VehicleTracker(max_age=5, iou_threshold=0.2, fps=30.0)
        frame = np.zeros((480, 640, 3), dtype=np.uint8)

        # Frame 1
        det1 = [Detection(bbox=(100, 100, 50, 50), class_id=2, class_name="car", confidence=0.9)]
        tracked1 = tracker.update(det1, frame)

        # Frame 2 — same car, slightly moved
        det2 = [Detection(bbox=(105, 103, 50, 50), class_id=2, class_name="car", confidence=0.88)]
        tracked2 = tracker.update(det2, frame)

        # Should still have 1 track with the same ID
        assert len(tracked2) == 1
        assert tracked2[0].track_id == tracked1[0].track_id
        assert tracked2[0].age == 2

    def test_tracker_drops_old_tracks(self):
        from src.perception.tracker import VehicleTracker

        tracker = VehicleTracker(max_age=2, iou_threshold=0.3, fps=30.0)
        frame = np.zeros((480, 640, 3), dtype=np.uint8)

        # Frame 1 — one car
        det = [Detection(bbox=(100, 100, 50, 50), class_id=2, class_name="car", confidence=0.9)]
        tracker.update(det, frame)

        # Frames 2, 3, 4 — no detections (car disappeared)
        for _ in range(3):
            tracker.update([], frame)

        assert tracker.get_active_count() == 0

    def test_tracker_reset(self):
        from src.perception.tracker import VehicleTracker

        tracker = VehicleTracker()
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        det = [Detection(bbox=(100, 100, 50, 50), class_id=2, class_name="car", confidence=0.9)]
        tracker.update(det, frame)

        tracker.reset()
        assert tracker.get_active_count() == 0


# ======================================================================
# Congestion Estimator
# ======================================================================

class TestCongestionEstimator:
    def test_no_vehicles_yields_zero_congestion(self):
        from src.perception.congestion_estimator import CongestionEstimator

        estimator = CongestionEstimator(max_density=50, free_flow_speed=45.0)
        metrics = estimator.estimate([], roi_area_m2=10_000.0)

        assert metrics.vehicle_count == 0
        assert metrics.congestion_factor == pytest.approx(0.0)
        # Free-flow speed when no vehicles
        assert metrics.average_speed_kmh == pytest.approx(45.0)

    def test_high_density_low_speed_yields_high_congestion(self):
        from src.perception.congestion_estimator import CongestionEstimator

        estimator = CongestionEstimator(max_density=20, free_flow_speed=50.0)

        # 20 vehicles at 5 km/h → density_ratio=1.0, speed_ratio=0.9 → CF≈0.9
        vehicles = [
            TrackedVehicle(
                track_id=i, bbox=(i * 30, 100, 40, 30),
                class_name="car", estimated_speed_kmh=5.0, frames_since_seen=0,
            )
            for i in range(20)
        ]

        metrics = estimator.estimate(vehicles)
        assert metrics.vehicle_count == 20
        assert metrics.congestion_factor >= 0.8

    def test_low_density_high_speed_yields_low_congestion(self):
        from src.perception.congestion_estimator import CongestionEstimator

        estimator = CongestionEstimator(max_density=50, free_flow_speed=45.0)

        # 3 vehicles at 40 km/h → density_ratio=0.06, speed_ratio≈0.11 → CF≈0.007
        vehicles = [
            TrackedVehicle(
                track_id=i, bbox=(i * 80, 200, 50, 40),
                class_name="car", estimated_speed_kmh=40.0, frames_since_seen=0,
            )
            for i in range(3)
        ]

        metrics = estimator.estimate(vehicles)
        assert metrics.congestion_factor < 0.1

    def test_congestion_factor_clamped(self):
        from src.perception.congestion_estimator import CongestionEstimator

        estimator = CongestionEstimator(max_density=5, free_flow_speed=50.0)

        # 100 vehicles (way above max_density) at 0 km/h
        vehicles = [
            TrackedVehicle(
                track_id=i, bbox=(i * 10, 0, 20, 20),
                class_name="car", estimated_speed_kmh=0.0, frames_since_seen=0,
            )
            for i in range(100)
        ]

        metrics = estimator.estimate(vehicles)
        assert metrics.congestion_factor == pytest.approx(1.0)

    def test_invalid_params_raises(self):
        from src.perception.congestion_estimator import CongestionEstimator

        with pytest.raises(ValueError):
            CongestionEstimator(max_density=0)
        with pytest.raises(ValueError):
            CongestionEstimator(free_flow_speed=-1)


# ======================================================================
# Pipeline (structure, not video processing)
# ======================================================================

class TestPipelineStructure:
    def test_pipeline_status_before_run(self):
        """Pipeline should report inactive status before processing any video."""
        from unittest.mock import MagicMock
        from src.perception.pipeline import PerceptionPipeline

        mock_detector = MagicMock()
        mock_detector.model_path = "models/test.onnx"
        mock_tracker = MagicMock()
        mock_estimator = MagicMock()

        pipeline = PerceptionPipeline(
            detector=mock_detector,
            tracker=mock_tracker,
            estimator=mock_estimator,
            camera_id="CAM-TEST-01",
        )

        status = pipeline.get_status()
        assert status["camera_id"] == "CAM-TEST-01"
        assert status["pipeline_active"] is False
        assert status["fps_processing"] == 0.0

    def test_annotate_frame_returns_array(self):
        from src.perception.pipeline import PerceptionPipeline

        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        vehicles = [
            TrackedVehicle(
                track_id=1, bbox=(100, 100, 50, 50),
                class_name="car", estimated_speed_kmh=35.0,
            ),
        ]

        annotated = PerceptionPipeline.annotate_frame(frame, vehicles)
        assert isinstance(annotated, np.ndarray)
        assert annotated.shape == frame.shape
        # Annotated frame should differ from blank (boxes were drawn)
        assert not np.array_equal(annotated, frame)
