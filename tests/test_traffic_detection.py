"""Detection regressions independent of downloaded model weights or networks."""
import threading
import time
import cv2
import numpy as np
import pytest
from types import SimpleNamespace

from src.perception.detector import VehicleDetector
from src.perception.models import Detection
from src.perception.traffic_detector import TrafficDetector, merge_detections
from src.perception.tracker import VehicleTracker
from src.services.video_service import CLASSES, VideoSession, aligned_boxes, confirmed_boxes, project_boxes


def test_onnxruntime_prefers_cuda_and_reports_the_active_provider(monkeypatch):
    import sys
    calls = []
    class Session:
        def __init__(self, model, providers):
            calls.append((model, providers))
            self.providers = providers
        def get_providers(self):
            return self.providers
    runtime = SimpleNamespace(
        get_available_providers=lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"],
        preload_dlls=lambda: calls.append("preload"),
        InferenceSession=Session,
    )
    monkeypatch.setitem(sys.modules, "onnxruntime", runtime)
    detector = VehicleDetector.__new__(VehicleDetector)
    detector.model_path = "road.onnx"
    detector._load_onnxruntime()
    assert calls == ["preload", ("road.onnx", ["CUDAExecutionProvider", "CPUExecutionProvider"])]
    assert detector.execution_provider == "CUDAExecutionProvider"


def test_onnxruntime_retries_on_cpu_when_cuda_initialization_fails(monkeypatch):
    import sys
    calls = []
    class Session:
        def __init__(self, model, providers):
            calls.append(providers)
            if providers[0] == "CUDAExecutionProvider":
                raise RuntimeError("CUDA libraries unavailable")
        def get_providers(self):
            return ["CPUExecutionProvider"]
    runtime = SimpleNamespace(
        get_available_providers=lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"],
        preload_dlls=lambda: None,
        InferenceSession=Session,
    )
    monkeypatch.setitem(sys.modules, "onnxruntime", runtime)
    detector = VehicleDetector.__new__(VehicleDetector)
    detector.model_path = "road.onnx"
    detector._load_onnxruntime()
    assert calls == [["CUDAExecutionProvider", "CPUExecutionProvider"], ["CPUExecutionProvider"]]
    assert detector.execution_provider == "CPUExecutionProvider"


def test_postprocessing_keeps_all_six_classes_even_when_rider_boxes_overlap():
    detector = VehicleDetector.__new__(VehicleDetector)
    detector.class_names = CLASSES
    detector.confidence_threshold = .2
    detector.nms_threshold = .5
    raw = np.zeros((1, 84, 6), np.float32)
    for index, class_id in enumerate(CLASSES):
        raw[0, :4, index] = [100, 100, 80, 80]
        raw[0, 4 + class_id, index] = .9
    result = detector._postprocess(raw, 0, 0, 1)
    assert {item.class_name for item in result} == set(CLASSES.values())


@pytest.mark.parametrize("shape,position", [((720, 1280), (500, 200)), ((1280, 720), (100, 800))])
def test_detail_crops_map_back_to_video_and_merge_duplicate_objects(shape, position):
    class Detector:
        confidence_threshold = .15
        def detect(self, image):
            yy, xx = np.where(image[:, :, 1] > 150)
            return [Detection((int(xx.min()), int(yy.min()), int(xx.max() - xx.min() + 1), int(yy.max() - yy.min() + 1)), 2, "car", .8)] if len(xx) else []
    frame = np.zeros((*shape, 3), np.uint8)
    x, y = position
    frame[y:y + 20, x:x + 30, 1] = 200
    result = TrafficDetector(Detector()).detect(frame)
    assert len(result) == 1
    assert result[0].bbox == (x, y, 30, 20)


def test_tile_merge_preserves_rider_but_does_not_count_one_vehicle_twice():
    result = merge_detections([
        Detection((10, 10, 50, 50), 1, "bicycle", .8),
        Detection((10, 10, 50, 50), 0, "pedestrian", .9),
        Detection((80, 10, 45, 50), 1, "rider", .82),
        Detection((80, 10, 50, 50), 1, "bicycle", .8),
        Detection((200, 200, 80, 50), 2, "car", .7),
        Detection((200, 200, 80, 50), 7, "truck", .9),
    ])
    assert sorted(item.class_name for item in result) == ["bicycle", "bicycle", "pedestrian", "rider", "truck"]


def test_textureless_fresh_detections_are_predicted_instead_of_deleted():
    gray = np.zeros((180, 320), np.uint8)
    boxes = [{"id": 1, "bbox": (40, 70, 30, 30), "velocity": (10, 5)}]
    result = project_boxes(boxes, gray, gray, 1, age_seconds=.2)
    assert result[0]["bbox"] == (42, 71, 30, 30)
    assert project_boxes(boxes, gray, gray, 1, age_seconds=.6) == []


def test_classes_do_not_exchange_ids_when_their_boxes_overlap():
    tracker = VehicleTracker(use_optical_flow=False)
    frame = np.zeros((180, 320, 3), np.uint8)
    detections = [Detection((40, 70, 50, 50), 0, "pedestrian", .9), Detection((40, 70, 50, 50), 1, "bicycle", .9)]
    before = {item.class_name: item.track_id for item in tracker.update(detections, frame)}
    after = {item.class_name: item.track_id for item in tracker.update(list(reversed(detections)), frame)}
    assert before == after


def test_shared_inference_selects_the_latest_frame_after_waiting_for_model_access():
    session = VideoSession.__new__(VideoSession)
    session.inference_gate = threading.RLock()
    session.lock = threading.Lock()
    session.stop_event = threading.Event()
    session.latest = (1, time.monotonic(), np.zeros((4, 4, 3), np.uint8), 1)
    session.infer = lambda frame: int(frame[0, 0, 0])
    started = threading.Event()
    result = []
    def detect():
        started.set()
        result.append(session._detect_latest(-1))
    with session.inference_gate:
        worker = threading.Thread(target=detect)
        worker.start()
        assert started.wait(1)
        session.latest = (2, time.monotonic(), np.full((4, 4, 3), 2, np.uint8), 1)
    worker.join(2)
    assert not worker.is_alive()
    assert result[0][0][0] == 2 and result[0][1] == 2


def test_displayed_video_interpolates_only_between_confirmed_object_locations():
    gray = np.zeros((180, 320), np.uint8)
    frame = np.zeros((180, 320, 3), np.uint8)
    first = {"id": 1, "class": "car", "confidence": .8, "bbox": (10, 50, 40, 30)}
    last = {**first, "bbox": (30, 70, 60, 40)}
    history = [(1, 10., [first], gray, 1, 1), (2, 10.2, [], gray, 1, 1), (3, 10.4, [last], gray, 1, 1)]
    result = aligned_boxes(history, (2, 10.2, frame, 1), gray, 1)
    assert result[0]["bbox"] == (20, 60, 50, 35)
    assert result[0]["predicted"] is True
    # No future confirmation: do not keep drawing onto empty roadway.
    assert aligned_boxes(history[:1], (2, 10.2, frame, 1), gray, 1) == []
    # Source generations never share bounding boxes.
    assert aligned_boxes(history, (2, 10.2, frame, 2), gray, 1) == []
    distant = (3, 10.4, [{**last, "bbox": (200, 70, 60, 40)}], gray, 1, 1)
    assert aligned_boxes([history[0], distant], (2, 10.2, frame, 1), gray, 1) == []


def test_small_distant_cars_are_not_joined_across_unrelated_locations():
    tracker = VehicleTracker(use_optical_flow=False)
    frame = np.zeros((180, 320, 3), np.uint8)
    first = tracker.update([Detection((20, 50, 15, 10), 2, "car", .8)], frame)[0].track_id
    next_tracks = tracker.update([Detection((80, 50, 15, 10), 2, "car", .8)], frame, frame_step=10)
    assert next(track.track_id for track in next_tracks if track.frames_since_seen == 0) != first


def test_crop_boundary_fragments_cannot_replace_complete_vehicle_boxes():
    class Detector:
        confidence_threshold = .25
        def detect(self, image):
            if image.shape[1] == 1280:
                return [Detection((300, 200, 80, 40), 2, "car", .7)]
            # Higher-confidence false fragment on an internal left crop edge.
            return [Detection((0, 160, 60, 40), 7, "truck", .95)]
    result = TrafficDetector(Detector()).detect(np.zeros((720, 1280, 3), np.uint8))
    assert not any(item.bbox[0] in (320, 640) for item in result)
    assert any(item.bbox == (300, 200, 80, 40) for item in result)


def test_road_detail_crop_rotates_down_the_inbound_corridor_without_extra_model_passes():
    class Detector:
        confidence_threshold = .15
        calls = 0
        def detect(self, image):
            self.calls += 1
            if image.shape[:2] != (480, 480):
                return []
            y, x = np.where(image[:, :, 0] > 0)
            if not len(x):
                return []
            return [Detection((int(x.min()), int(y.min()), int(x.max() - x.min() + 1),
                               int(y.max() - y.min() + 1)), 2, "car", .8)]

    frame = np.zeros((720, 1280, 3), np.uint8)
    expected = [(240, 318), (583, 480), (971, 480)]
    for index, (x, y) in enumerate(expected, start=1):
        frame[y:y + 8, x:x + 8, 0] = index * 50
    zone = {"enabled": True, "polygon": [[.055, .27], [.25, .28], [.98, .63],
              [.98, .96], [.18, .96]], "direction": [.72, .69]}
    detector = TrafficDetector(Detector())

    for expected_box, next_cursor in zip(expected, (1, 2, 0)):
        detections = detector.detect(frame, zone)
        assert [item.bbox[:2] for item in detections] == [expected_box]
        assert zone["_detail_crop_cursor"] == next_cursor
    assert detector.detector.calls == 6

    # Each camera owns its rotation state even though the inference model is shared.
    other_zone = {"enabled": True, "polygon": zone["polygon"], "direction": zone["direction"]}
    detector.detect(frame, other_zone)
    assert other_zone["_detail_crop_cursor"] == 1
    assert detector.detector.calls == 8


def test_single_model_hits_and_repeated_copies_are_not_confirmed_tracks():
    frame = np.zeros((20, 20), np.uint8)
    box = {"id": 1, "class": "car", "bbox": (2, 2, 10, 5), "confidence": .25}
    first = (1, 10., [box], frame, 1, 1)
    second = (2, 10.2, [box], frame, 1, 1)
    assert confirmed_boxes([box], [first], 10.1, 1) == []
    assert confirmed_boxes([box], [first, first], 10.1, 1) == []
    assert confirmed_boxes([box], [first, second], 10.1, 1) == [box]
    assert confirmed_boxes([box], [first, second], 11.2, 1) == []
    assert confirmed_boxes([box], [first, (*second[:5], 2)], 10.1, 1) == []


def test_night_tracks_need_two_distinct_model_updates_even_at_high_confidence():
    frame = np.zeros((20, 20), np.uint8)
    box = {"id": 4, "class": "vehicle", "bbox": (2, 2, 10, 5),
           "confidence": .8, "track_confidence": .8, "low_light": True}
    first = (1, 10., [box], frame, 1, 1)
    second = (2, 10.2, [box], frame, 1, 1)
    assert confirmed_boxes([box], [first], 10.1, 1) == []
    assert confirmed_boxes([box], [first, second], 10.1, 1) == [box]


def test_weak_detections_maintain_existing_tracks_but_cannot_start_new_ones():
    tracker = VehicleTracker(use_optical_flow=False, new_track_threshold=.30)
    frame = np.zeros((180, 320, 3), np.uint8)
    assert tracker.update([Detection((20, 50, 40, 30), 2, "car", .18)], frame) == []
    first = tracker.update([Detection((20, 50, 40, 30), 2, "car", .75)], frame)[0]
    updated = tracker.update([Detection((25, 50, 40, 30), 2, "car", .15),
                              Detection((200, 50, 40, 30), 2, "car", .20)], frame)
    assert len(updated) == 1
    assert updated[0].track_id == first.track_id and updated[0].bbox[0] == 25
