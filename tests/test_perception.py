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


# ======================================================================
# Perception Audit Corrections Tests
# ======================================================================

class TestPerceptionAuditCorrections:
    def test_frame_step_scales_velocity_and_speed(self):
        """Displacement over frame_step=4 should be 1/4 the speed of frame_step=1."""
        from src.perception.tracker import VehicleTracker

        frame = np.zeros((480, 640, 3), dtype=np.uint8)

        # Test frame_step = 1
        tracker1 = VehicleTracker(pixels_per_meter=10.0, fps=30.0)
        tracker1.update([Detection(bbox=(100, 100, 40, 40), class_id=2, class_name="car", confidence=0.9)], frame)
        # Move by 20 pixels in x
        t1 = tracker1.update([Detection(bbox=(120, 100, 40, 40), class_id=2, class_name="car", confidence=0.9)], frame, frame_step=1)
        speed_step1 = t1[0].estimated_speed_kmh
        # 20 px / 1 frame = 20 px/f -> (20 / 10) * 30 * 3.6 = 216.0 km/h
        assert speed_step1 == pytest.approx(216.0, abs=1.0)

        # Test frame_step = 4 (skip_frames = 3)
        tracker4 = VehicleTracker(pixels_per_meter=10.0, fps=30.0)
        tracker4.update([Detection(bbox=(100, 100, 40, 40), class_id=2, class_name="car", confidence=0.9)], frame)
        t4 = tracker4.update([Detection(bbox=(120, 100, 40, 40), class_id=2, class_name="car", confidence=0.9)], frame, frame_step=4)
        speed_step4 = t4[0].estimated_speed_kmh
        # 20 px / 4 frames = 5 px/f -> (5 / 10) * 30 * 3.6 = 54.0 km/h
        assert speed_step4 == pytest.approx(54.0, abs=1.0)
        assert speed_step4 == pytest.approx(speed_step1 / 4.0, abs=1.0)

    def test_ema_speed_smoothing_when_age_greater_than_two(self):
        """Tracks with age > 2 must apply 0.7*prev + 0.3*new EMA smoothing."""
        from src.perception.tracker import VehicleTracker

        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        tracker = VehicleTracker(pixels_per_meter=10.0, fps=30.0)

        # Frame 1: age=1, speed=0.0
        tracker.update([Detection(bbox=(100, 100, 40, 40), class_id=2, class_name="car", confidence=0.9)], frame)

        # Frame 2: age=2, raw_speed = (10/10)*30*3.6 = 108.0 km/h. No EMA yet (age <= 2)
        t2 = tracker.update([Detection(bbox=(110, 100, 40, 40), class_id=2, class_name="car", confidence=0.9)], frame)
        assert t2[0].age == 2
        assert t2[0].estimated_speed_kmh == pytest.approx(108.0, abs=0.5)

        # Frame 3: age=3, move 10 px again -> raw_speed = 108.0.
        t3 = tracker.update([Detection(bbox=(120, 100, 40, 40), class_id=2, class_name="car", confidence=0.9)], frame)
        assert t3[0].age == 3
        assert t3[0].estimated_speed_kmh == pytest.approx(108.0, abs=0.5)

        # Frame 4: age=4, stop (0 px movement) -> raw_speed = 0.0.
        # EMA: 0.7 * 108.0 + 0.3 * 0.0 = 75.6 km/h
        t4 = tracker.update([Detection(bbox=(120, 100, 40, 40), class_id=2, class_name="car", confidence=0.9)], frame)
        assert t4[0].age == 4
        assert t4[0].estimated_speed_kmh == pytest.approx(75.6, abs=0.5)

    def test_newborn_tracks_excluded_from_speed_average(self):
        """Newly detected tracks (age == 1) with 0.0 km/h must not degrade average speed."""
        from src.perception.tracker import VehicleTracker
        from src.perception.congestion_estimator import CongestionEstimator

        tracker = VehicleTracker(pixels_per_meter=10.0, fps=30.0)
        frame = np.zeros((480, 640, 3), dtype=np.uint8)

        # Frame 1: car 1 detected (age=1, speed=0.0)
        tracked = tracker.update([Detection(bbox=(100, 100, 40, 40), class_id=2, class_name="car", confidence=0.9)], frame)
        assert tracked[0].age == 1
        assert tracked[0].estimated_speed_kmh == 0.0

        # get_average_flow_velocity should return 0.0 (or free flow fallback) instead of dragging average down
        assert tracker.get_average_flow_velocity() == 0.0
        assert tracker.get_average_flow_velocity(free_flow_fallback=45.0) == 45.0

        # CongestionEstimator should use free_flow_speed fallback when only age==1 tracks exist
        estimator = CongestionEstimator(free_flow_speed=50.0)
        metrics = estimator.estimate(tracked)
        assert metrics.vehicle_count == 1
        assert metrics.average_speed_kmh == 50.0
        assert metrics.congestion_factor == 0.0  # (1/50) * (1 - 50/50) = 0.0

    def test_phantom_tracks_excluded_from_vehicle_count(self):
        """Tracks with frames_since_seen > 1 must not be counted in vehicle_count."""
        from src.perception.congestion_estimator import CongestionEstimator

        estimator = CongestionEstimator()
        vehicles = [
            TrackedVehicle(track_id=1, bbox=(10, 10, 20, 20), class_name="car", frames_since_seen=0, estimated_speed_kmh=40.0),
            TrackedVehicle(track_id=2, bbox=(50, 50, 20, 20), class_name="car", frames_since_seen=1, estimated_speed_kmh=40.0),
            TrackedVehicle(track_id=3, bbox=(90, 90, 20, 20), class_name="car", frames_since_seen=2, estimated_speed_kmh=40.0),  # Phantom
            TrackedVehicle(track_id=4, bbox=(130, 130, 20, 20), class_name="car", frames_since_seen=5, estimated_speed_kmh=40.0), # Phantom
        ]

        metrics = estimator.estimate(vehicles)
        assert metrics.vehicle_count == 2  # Only track 1 and 2 (frames_since_seen <= 1)

    def test_centroid_distance_fallback_association(self):
        """When IoU is 0.0 due to high displacement, centroid fallback should maintain track identity."""
        from src.perception.tracker import VehicleTracker

        tracker = VehicleTracker(iou_threshold=0.3)
        frame = np.zeros((480, 640, 3), dtype=np.uint8)

        # Frame 1: car at (100, 100, 30, 30) -> centroid (115, 115)
        tracker.update([Detection(bbox=(100, 100, 30, 30), class_id=2, class_name="car", confidence=0.9)], frame)
        assert tracker.get_active_count() == 1

        # Frame 2: car moved to (140, 100, 30, 30) -> IoU with (100,100,30,30) is 0.0!
        # But centroid distance is 40 px, well within max_centroid_dist.
        tracked = tracker.update([Detection(bbox=(140, 100, 30, 30), class_id=2, class_name="car", confidence=0.9)], frame, frame_step=2)
        assert len(tracked) == 1
        assert tracked[0].track_id == 1  # Re-associated via centroid distance fallback!
        assert tracked[0].age == 2

    def test_optical_flow_filters_static_background(self):
        """Optical flow must only take median over moving pixels (mag > 0.8)."""
        from unittest.mock import patch
        from src.perception.tracker import VehicleTracker

        tracker = VehicleTracker(use_optical_flow=True, fps=30.0, pixels_per_meter=10.0)
        f1 = np.zeros((100, 100, 3), dtype=np.uint8)
        f2 = np.zeros((100, 100, 3), dtype=np.uint8)

        # Mock calcOpticalFlowFarneback to return 90% static pixels (< 0.8) and 10% moving pixels (4.0)
        mock_flow = np.zeros((100, 100, 2), dtype=np.float32)
        # 10% of pixels have flow of 4.0 in x
        mock_flow[0:10, 0:10, 0] = 4.0

        with patch("cv2.calcOpticalFlowFarneback", return_value=mock_flow):
            tracker._prev_gray = np.zeros((100, 100), dtype=np.uint8)
            tracker._compute_optical_flow(f2, frame_step=2)
            # Moving pixels should be 4.0 / frame_step=2 -> 2.0 px/frame
            assert tracker._global_flow_speed == pytest.approx(2.0)

    @pytest.mark.anyio
    async def test_pipeline_async_event_loop_yielding_and_telemetry_tasks(self):
        """Pipeline must keep event loop responsive and manage telemetry tasks."""
        import asyncio
        from unittest.mock import MagicMock, patch
        from src.perception.pipeline import PerceptionPipeline

        mock_detector = MagicMock()
        mock_detector.detect.return_value = []
        mock_detector.model_path = "models/test.onnx"
        mock_tracker = MagicMock()
        mock_tracker.update.return_value = []
        mock_tracker.get_average_flow_velocity.return_value = 0.0
        mock_estimator = MagicMock()
        mock_estimator.estimate.return_value = MagicMock(vehicle_count=0, congestion_factor=0.0, average_speed_kmh=45.0)

        pipeline = PerceptionPipeline(
            detector=mock_detector,
            tracker=mock_tracker,
            estimator=mock_estimator,
            camera_id="CAM-ASYNC-01",
            api_url="http://localhost:8000",
        )

        # Mock cv2.VideoCapture to produce 3 frames then end
        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = True
        mock_cap.get.return_value = 30.0
        frame_dummy = np.zeros((100, 100, 3), dtype=np.uint8)
        mock_cap.read.side_effect = [(True, frame_dummy), (True, frame_dummy), (True, frame_dummy), (False, None)]

        with patch("cv2.VideoCapture", return_value=mock_cap):
            with patch.object(pipeline, "_send_telemetry", return_value=None):
                summary = await pipeline.process_video("0", skip_frames=0, telemetry_interval=1)
                assert summary["frames_processed"] == 3
                # Verify tracker.update was called with frame_step = skip_frames + 1 = 1
                mock_tracker.update.assert_called_with([], frame_dummy, frame_step=1)


class TestDetectorVectorization:
    def test_postprocess_vectorized_filtering_and_clamping(self):
        from src.perception.detector import VehicleDetector

        detector = object.__new__(VehicleDetector)
        detector.confidence_threshold = 0.5
        detector.nms_threshold = 0.45

        # Create synthetic YOLOv8 raw output of shape (1, 84, 8400)
        raw = np.zeros((1, 84, 8400), dtype=np.float32)

        # Anchor 0: car (COCO class 2, row index 4 + 2 = 6) with high confidence 0.9
        raw[0, 0, 0] = 320.0  # cx
        raw[0, 1, 0] = 320.0  # cy
        raw[0, 2, 0] = 50.0   # w
        raw[0, 3, 0] = 60.0   # h
        raw[0, 4 + 2, 0] = 0.90  # car confidence

        # Anchor 1: person (COCO class 0, row index 4 + 0 = 4) with confidence 0.95 (should be ignored)
        raw[0, 0, 1] = 100.0
        raw[0, 1, 1] = 100.0
        raw[0, 2, 1] = 20.0
        raw[0, 3, 1] = 40.0
        raw[0, 4 + 0, 1] = 0.95

        # Anchor 2: truck (COCO class 7, row index 4 + 7 = 11) with low confidence 0.2 (below threshold)
        raw[0, 0, 2] = 200.0
        raw[0, 1, 2] = 200.0
        raw[0, 2, 2] = 80.0
        raw[0, 3, 2] = 50.0
        raw[0, 4 + 7, 2] = 0.20

        # Anchor 3: bus (COCO class 5, row index 4 + 5 = 9) near boundary (testing clamp)
        raw[0, 0, 3] = 10.0
        raw[0, 1, 3] = 10.0
        raw[0, 2, 3] = 100.0
        raw[0, 3, 3] = 100.0
        raw[0, 4 + 5, 3] = 0.85

        detections = detector._postprocess(
            raw, pad_x=0, pad_y=0, scale=1.0, orig_w=640, orig_h=480
        )

        assert len(detections) == 2
        classes = {d.class_name for d in detections}
        assert classes == {"car", "bus"}

        # Clamping check for bus (x1 was -40 -> clamped to 0)
        bus_det = next(d for d in detections if d.class_name == "bus")
        assert bus_det.bbox[0] >= 0
        assert bus_det.bbox[1] >= 0

    def test_postprocess_legacy_positional_arguments_compatibility(self):
        from src.perception.detector import VehicleDetector

        detector = object.__new__(VehicleDetector)
        detector.confidence_threshold = 0.5
        detector.nms_threshold = 0.45

        raw = np.zeros((1, 84, 100), dtype=np.float32)
        raw[0, 0, 0] = 320.0
        raw[0, 1, 0] = 320.0
        raw[0, 2, 0] = 50.0
        raw[0, 3, 0] = 60.0
        raw[0, 4 + 2, 0] = 0.90  # car

        # Call with legacy 6 arguments (raw, scale_x, scale_y, pad_x, pad_y, scale)
        detections = detector._postprocess(raw, 1.0, 1.0, 0, 0, 1.0)
        assert len(detections) == 1
        assert detections[0].class_name == "car"
