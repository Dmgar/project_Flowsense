"""Exercise real decoded video and WebRTC transport; fixtures are synthetic."""
import asyncio
from collections import deque
import threading
import time

import cv2
import numpy as np
import pytest
from pydantic import ValidationError
from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription

from src.perception.models import Detection
from src.api.routes.video import Filters
from src.services.video_service import (HIGH_RES_MIN_FREE_MEMORY_BYTES, PROVISIONAL_COLOR,
    VideoService, VideoSession, aligned_boxes, confirmed_boxes, detection_overlay_label,
    detection_overlay_text, has_high_res_memory_headroom, supplemental_detail_status, place_detection_label,
    probe_video, project_boxes)


def test_supplemental_high_resolution_inference_requires_memory_headroom():
    assert not has_high_res_memory_headroom(None)
    assert not has_high_res_memory_headroom(HIGH_RES_MIN_FREE_MEMORY_BYTES - 1)
    assert has_high_res_memory_headroom(HIGH_RES_MIN_FREE_MEMORY_BYTES)


@pytest.mark.parametrize(("profile", "zone", "provider", "sessions", "memory", "model", "expected"), [
    ("standard", True, "CUDAExecutionProvider", 1, 3_000_000_000, True, None),
    ("low_light", False, "CUDAExecutionProvider", 1, 3_000_000_000, True, "road_zone_required"),
    ("low_light", True, "CUDAExecutionProvider", 1, 3_000_000_000, False, "model_unavailable"),
    ("low_light", True, "CPU", 1, 3_000_000_000, True, "cuda_required"),
    ("low_light", True, "CUDAExecutionProvider", 2, 3_000_000_000, True, "multiple_sessions"),
    ("low_light", True, "CUDAExecutionProvider", 1, 1_000_000_000, True, "memory_limited"),
    ("low_light", True, "CUDAExecutionProvider", 1, 3_000_000_000, True, "eligible"),
])
def test_supplemental_detail_diagnostics_name_the_limiting_condition(
        profile, zone, provider, sessions, memory, model, expected):
    assert supplemental_detail_status(profile, zone, provider, sessions, memory, model) == expected


@pytest.fixture
def moving_video(tmp_path):
    path = tmp_path / "moving.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 25, (640, 360))
    assert writer.isOpened()
    for index in range(100):
        frame = np.zeros((360, 640, 3), np.uint8)
        x = 30 + index * 3
        cv2.rectangle(frame, (x, 140), (x + 60, 185), (60, 230, 80), -1)
        cv2.putText(frame, f"Synthetic test video {index}", (20, 300), 0, .6, (230, 230, 230), 1)
        writer.write(frame)
    writer.release()
    return {"id": "synthetic-test", "stream_url": str(path), "playback_mode": "recorded"}


def detect_rectangle(frame):
    mask = (frame[:, :, 1] > 160) & (frame[:, :, 0] < 130)
    ys, xs = np.where(mask)
    if not len(xs):
        return []
    return [Detection((int(xs.min()), int(ys.min()), int(xs.max() - xs.min()), int(ys.max() - ys.min())), 2, "car", .9)]


def test_vehicle_overlay_marks_unconfirmed_type_and_confirms_stable_labels():
    assert detection_overlay_label({"id": 7, "class": "vehicle", "candidate_class": "car", "bbox": (4, 8, 70, 20)}) == "Car? #7"
    assert detection_overlay_label({"id": 8, "class": "vehicle", "bbox": (4, 8, 70, 20)}) == "Vehicle #8"
    assert detection_overlay_label({"id": 9, "class": "truck", "bbox": (4, 8, 70, 20)}) == "Truck #9"
    assert detection_overlay_label({"id": 10, "class": "vehicle", "candidate_class": "car",
                                    "direction_status": "checking", "bbox": (4, 8, 70, 20)}) == "Checking Car? #10"


def test_video_overlay_labels_detection_score_without_implying_class_probability():
    box = {"id": 8, "class": "vehicle", "candidate_class": "truck", "bbox": (4, 8, 70, 20)}
    assert detection_overlay_text(box, .38) == "Truck? #8 · detection 38%"
    assert detection_overlay_text(box, .38, candidate=True) == "Candidate Truck? #8 · detection 38%"
    assert detection_overlay_text(box, .38, compact=True) == "Truck? #8 · 38%"
    assert detection_overlay_text(box, .13, candidate=True, compact=True) == "Truck? #8 · 13%"


def test_low_light_confirmation_survives_vehicle_to_car_class_upgrade():
    vehicle = {"id": 7, "class": "vehicle", "low_light": True, "track_confidence": .2}
    car = {"id": 7, "class": "car", "low_light": True, "track_confidence": .2}
    history = [(1, .9, [vehicle], None, 1, 3, {}), (2, 1., [car], None, 1, 3, {})]
    assert confirmed_boxes([car], history, 1., 3) == [car]


def test_nearby_detection_labels_are_kept_inside_frame_without_overlap():
    placements = []
    boxes = [(240, 140, 42, 26), (246, 143, 40, 25), (252, 146, 44, 28)]
    for bbox in boxes:
        _, _, rectangle = place_detection_label(bbox, (86, 16), (360, 640, 3), placements)
        placements.append(rectangle)
        assert rectangle[0] >= 0 and rectangle[1] >= 0
        assert rectangle[2] <= 640 and rectangle[3] <= 360
    for index, left in enumerate(placements):
        for right in placements[index + 1:]:
            assert left[0] >= right[2] or right[0] >= left[2] or left[1] >= right[3] or right[1] >= left[3]


def test_detection_label_avoids_neighboring_vehicle_boxes_when_a_clear_slot_exists():
    neighbor = (240, 100, 330, 120)
    _, _, label = place_detection_label((240, 140, 42, 26), (86, 16), (360, 640, 3), [], [neighbor])
    assert label[0] >= 0 and label[1] >= 0
    assert label[2] <= 640 and label[3] <= 360
    assert label[0] >= neighbor[2] or label[2] <= neighbor[0] or label[1] >= neighbor[3] or label[3] <= neighbor[1]


def test_clustered_vehicle_labels_keep_clear_slots_for_all_neighbor_boxes():
    boxes = [(240, 140, 42, 26), (350, 140, 42, 26), (460, 140, 42, 26)]
    rectangles = []
    for box in boxes:
        x, y, width, height = box
        obstacles = [(other_x, other_y, other_x + other_width, other_y + other_height)
                     for other_x, other_y, other_width, other_height in boxes if (other_x, other_y, other_width, other_height) != box]
        _, _, label = place_detection_label(box, (86, 16), (360, 640, 3), rectangles, obstacles)
        for other in [*rectangles, *obstacles]:
            assert label[0] >= other[2] or label[2] <= other[0] or label[1] >= other[3] or label[3] <= other[1]
        rectangles.append(label)


def test_direction_checking_tracks_are_saved_but_excluded_from_road_coverage():
    session = VideoSession.__new__(VideoSession)
    frame = np.zeros((400, 600, 3), np.uint8)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    track = {"id": 1, "class": "vehicle", "candidate_class": "car", "class_status": "uncertain",
             "bbox": (100, 100, 40, 30), "confidence": .16, "track_confidence": .16,
             "counted": False, "low_light": True, "observation_hits": 2, "predicted": False,
             "direction": "checking", "direction_status": "checking", "motion_lengths_per_second": .02,
             "trail": [(110, 130), (120, 130), (130, 130)]}
    session.lock = threading.RLock()
    session.analysis_history = deque([(1, .9, [track], gray, 1., 1, {}), (2, 1., [track], gray, 1., 1, {})])
    session.settings = {"confidence": .1, "classes": ["vehicle"]}
    session.zone = {"enabled": True, "polygon": [[0,0],[1,0],[1,1],[0,1]], "revision": 2}
    session.detection_profile = "low_light"
    session.model_name = "test-model"
    session.execution_provider = "test"
    session.generation_first_sequence = 1
    session.source_fps = 15
    session.video_delay = .6

    _, metrics = session._compose((2, 1., frame, 1))

    assert metrics["detections"][0]["direction_status"] == "checking"
    assert metrics["observed_detections"][0]["direction"] == "checking"
    assert metrics["observed_detections"][0]["trail"] == [(110, 130), (120, 130), (130, 130)]
    assert metrics["traffic"]["object_count"] == 0
    assert metrics["traffic"]["analysis_available"] is True


def test_missing_track_motion_is_not_reported_as_zero_slow_traffic():
    from src.services.video_service import traffic_motion_metrics

    assert traffic_motion_metrics([]) == {
        "slow_fraction": None, "median_motion": None, "movement_sample_count": 0,
    }
    assert traffic_motion_metrics([.1, .6]) == {
        "slow_fraction": .5, "median_motion": .35, "movement_sample_count": 2,
    }


def test_camera_filter_accepts_low_light_tracking_threshold():
    assert Filters(confidence=.10, classes=["vehicle"]).confidence == .10
    assert Filters(confidence=.10, classes=["vehicle"]).show_candidates is True
    assert Filters(confidence=.10, classes=["vehicle"], show_candidates=False).show_candidates is False
    with pytest.raises(ValidationError):
        Filters(confidence=.09, classes=["vehicle"])


def test_repeated_weak_low_light_track_is_visible_and_saved_as_provisional():
    session = VideoSession.__new__(VideoSession)
    frame = np.zeros((400, 600, 3), np.uint8)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    zone = {"enabled": True, "name": "Incoming", "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "direction": [0, 1], "minimum_motion": .008, "revision": 1}
    track = {"id": 1, "class": "vehicle", "candidate_class": "car", "class_status": "uncertain",
             "bbox": (100, 100, 40, 30), "confidence": .12, "track_confidence": .12,
             "counted": False, "low_light": True, "observation_hits": 3, "predicted": False,
             "direction": "approaching", "motion_lengths_per_second": .2, "trail": []}
    session.lock = threading.RLock()
    session.analysis_history = deque([
        (1, .90, [track], gray, 1.0, 1, {}),
        (2, 1.00, [track], gray, 1.0, 1, {}),
    ])
    session.settings = {"confidence": .30, "classes": ["vehicle"], "show_candidates": True}
    session.zone = zone
    session.detection_profile = "low_light"
    session.model_name = "test-model"
    session.execution_provider = "test"
    session.generation_first_sequence = 1
    session.source_fps = 15
    session.video_delay = .6

    rendered, metrics = session._compose((2, 1.0, frame, 1))

    assert metrics["counts"]["vehicle"] == 1
    assert metrics["detections"][0]["candidate_class"] == "car"
    assert metrics["observed_detections"][0]["track_confidence"] == .12
    assert metrics["analysis_pipeline"]["displayed_tracks"] == 1
    assert metrics["analysis_pipeline"]["confirmed_displayed_tracks"] == 0
    assert metrics["analysis_pipeline"]["provisional_displayed_tracks"] == 1
    assert tuple(rendered[100, 100]) == PROVISIONAL_COLOR

    session.settings["show_candidates"] = False
    hidden, hidden_metrics = session._compose((2, 1.0, frame, 1))
    assert hidden_metrics["counts"]["vehicle"] == 0
    assert hidden_metrics["detections"] == []
    assert hidden_metrics["analysis_pipeline"]["displayed_tracks"] == 0
    assert hidden_metrics["analysis_pipeline"]["provisional_displayed_tracks"] == 0
    assert tuple(hidden[100, 100]) != PROVISIONAL_COLOR


async def until(predicate, timeout=6):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        await asyncio.sleep(.02)
    raise AssertionError("Condition did not become true before deadline")


def test_source_probe_accepts_video_and_rejects_single_image(moving_video, tmp_path):
    probe_video(moving_video["stream_url"])
    path = tmp_path / "still.jpg"
    cv2.imwrite(str(path), np.zeros((40, 40, 3), np.uint8))
    with pytest.raises(ValueError, match="continuous video"):
        probe_video(str(path))


def test_capture_keeps_moving_while_inference_is_slow_and_filters_clear_counts(moving_video):
    async def scenario():
        def slow(frame):
            time.sleep(.13)
            return detect_rectangle(frame)
        session = VideoSession(moving_video, slow)
        try:
            await until(lambda: session.status()["counts"] is not None)
            first = session.sequence
            await asyncio.sleep(.8)
            status = session.status()
            assert session.sequence - first >= 14
            assert status["output_fps"] >= 20
            assert status["inference_fps"] < status["output_fps"]
            assert status["counts"]["car"] == 1
            assert status["metrics"]["track_ids"] == [1]
            assert status["recorded"] is True
            with session.lock:
                session.settings = {"classes": [], "confidence": .35}
            await asyncio.sleep(.1)
            assert sum(session.status()["counts"].values()) == 0
            # Expired analysis cannot leave frozen boxes or zero counts as current.
            with session.lock:
                sample = session.analysis
                session.analysis = (sample[0], time.monotonic() - 3, *sample[2:])
                session.analysis_history.clear()
                session.analysis_history.append(session.analysis)
            # Run composition outside the lock: it takes its own snapshot.
            _, metrics = session._compose(session.latest)
            assert metrics["counts"] is None
        finally:
            await session.close()
        assert all(not thread.is_alive() for thread in session.threads)
    asyncio.run(scenario())


def test_inference_failure_leaves_actual_video_running_without_counts(moving_video):
    async def scenario():
        def failed(_):
            raise RuntimeError("Synthetic inference failure")
        session = VideoSession(moving_video, failed)
        try:
            await until(lambda: session.output_total >= 5)
            status = session.status()
            assert status["state"] == "Recorded playback"
            assert status["counts"] is None
            assert status["inference_error"] == "Detection unavailable"
        finally:
            await session.close()
    asyncio.run(scenario())


def test_unconfirmed_single_detections_expire_instead_of_leaving_ghost_boxes(moving_video):
    async def scenario():
        calls = []
        def intermittent(frame):
            calls.append(time.monotonic())
            return detect_rectangle(frame) if len(calls) == 1 else []
        session = VideoSession(moving_video, intermittent)
        try:
            await until(lambda: len(calls) >= 2 and session.status()["counts"] is not None)
            assert sum(session.status()["counts"].values()) == 0
            await asyncio.sleep(1)
            assert session.status()["counts"]["car"] == 0
        finally:
            await session.close()
    asyncio.run(scenario())


def test_optical_flow_moves_boxes_with_the_video():
    first = np.zeros((180, 320), np.uint8)
    cv2.rectangle(first, (40, 70), (90, 115), 220, -1)
    cv2.line(first, (40, 70), (90, 115), 70, 2)
    second = cv2.warpAffine(first, np.float32([[1, 0, 8], [0, 1, 3]]), (320, 180))
    result = project_boxes([{"id": 1, "bbox": (40, 70, 50, 45)}], first, second, 1)
    assert len(result) == 1
    assert abs(result[0]["bbox"][0] - 48) <= 2
    assert abs(result[0]["bbox"][1] - 73) <= 2


def test_short_interference_gap_predicts_only_a_confirmed_track():
    gray = np.zeros((100, 120), np.uint8)
    frame = np.zeros((100, 120, 3), np.uint8)
    base = {"id": 7, "class": "car", "bbox": (20, 25, 20, 20), "velocity": (20, 0),
            "observation_hits": 4, "track_confidence": .8, "predicted": False}
    observation = (1, 1.0, [base], gray, 1.0, 1, {})

    projected = aligned_boxes([observation], (2, 1.18, frame, 1), gray, 1.0)
    unconfirmed = {**base, "observation_hits": 2}
    not_projected = aligned_boxes([(1, 1.0, [unconfirmed], gray, 1.0, 1, {})],
                                  (2, 1.18, frame, 1), gray, 1.0)

    assert len(projected) == 1
    assert projected[0]["bbox"][0] == 23
    assert projected[0]["predicted"] is True
    assert not not_projected


def test_video_boxes_match_the_displayed_frame_rather_than_latest_capture(moving_video):
    async def scenario():
        session = VideoSession(moving_video, detect_rectangle)
        checked, previous = 0, -1
        try:
            await until(lambda: session.output is not None and session.status()["counts"] is not None)
            deadline = time.monotonic() + 1
            while time.monotonic() < deadline:
                status = session.status()
                metrics = status["metrics"]
                if metrics and metrics["sequence"] != previous and metrics["detections"]:
                    previous = metrics["sequence"]
                    expected_x = 30 + round(metrics["media_time_seconds"] * 25) * 3
                    assert abs(metrics["detections"][0]["bbox"][0] - expected_x) <= 5
                    checked += 1
                await asyncio.sleep(.02)
            assert checked >= 15
        finally:
            await session.close()
    asyncio.run(scenario())


def test_two_viewers_share_capture_and_receive_real_encoded_video(moving_video):
    async def scenario():
        service = VideoService()
        service.infer = detect_rectangle
        clients = []
        received = []
        try:
            for index in range(2):
                client = RTCPeerConnection(RTCConfiguration(iceServers=[]))
                client.addTransceiver("video", direction="recvonly")
                clients.append(client)

                @client.on("track")
                async def consume(track):
                    for _ in range(8):
                        frame = await track.recv()
                        received.append((frame.pts, frame.to_ndarray(format="bgr24")))

                await client.setLocalDescription(await client.createOffer())
                answer = await service.offer(moving_video, client.localDescription.sdp, "offer")
                await client.setRemoteDescription(RTCSessionDescription(answer["sdp"], answer["type"]))
            await until(lambda: len(received) >= 16)
            assert len(service.sessions) == 1
            assert len(service.peers) == 2
            assert len({id(entry[1]) for entry in service.peers.values()}) == 1
            assert received[-1][0] > received[0][0]
            assert not np.array_equal(received[0][1], received[-1][1])
            for viewer in list(service.peers):
                await service.leave(viewer)
            await until(lambda: not service.sessions, timeout=5)
        finally:
            await asyncio.gather(*(client.close() for client in clients))
            await service.shutdown()
    asyncio.run(scenario())


def test_video_only_catalog_and_api_validation(client):
    response = client.get("/api/v1/mobility/cameras?video_only=true")
    assert response.status_code == 200
    assert response.json() and all(camera["stream_url"] for camera in response.json())
    assert client.post("/api/v1/mobility/video/cameras/unknown/offer", json={"sdp": "not-an-offer", "type": "offer"}).status_code == 404
    assert client.get("/api/v1/mobility/video/viewers/expired").status_code == 404
    assert client.delete("/api/v1/mobility/video/viewers/expired").status_code == 200
    camera = next(item for item in client.get("/api/v1/mobility/cameras").json() if not item["stream_url"])
    assert client.post(f"/api/v1/mobility/video/cameras/{camera['id']}/offer", json={"sdp": "not-an-offer", "type": "offer"}).status_code == 400


def test_restart_drain_api_can_be_cancelled_without_stopping_video_service(client):
    prepared = client.post("/api/v1/mobility/video/prepare-restart")
    assert prepared.status_code == 200
    assert prepared.json()["ready"] is True
    cancelled = client.post("/api/v1/mobility/video/cancel-restart")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "restart cancelled"


def test_capacity_rejects_before_starting_any_capture():
    async def scenario():
        service = VideoService()
        service.peers = {str(index): None for index in range(12)}
        with pytest.raises(OverflowError, match="Viewer capacity"):
            await service.offer({"id": "not-started", "stream_url": "no-network-access"}, "", "offer")
        assert service.sessions == {}
    asyncio.run(scenario())


def test_prepare_restart_requests_every_camera_recorder_to_drain():
    class Session:
        def __init__(self):
            self.requested = False
            self.restart_drain_ready = False
        def request_restart_drain(self):
            self.requested = True

    async def scenario():
        service = VideoService()
        sessions = {"camera-a": Session(), "camera-b": Session()}
        service.sessions.update(sessions)
        result = await service.prepare_restart()

        assert service.restart_drain_active
        assert all(session.requested for session in sessions.values())
        assert result == {"ready": False, "cameras": [
            {"camera_id": "camera-a", "ready": False},
            {"camera_id": "camera-b", "ready": False}], "active_sessions": 2}
        with pytest.raises(OverflowError, match="preparing a brief restart"):
            await service.monitor({"id": "camera-c", "stream_url": "unused"}, "client-12345678")
        assert "camera-c" not in service.sessions
    asyncio.run(scenario())


def test_segment_bursts_are_paced_as_video_and_reconnect_resets_tracks(monkeypatch):
    import src.services.video_service as module
    opened = []

    class BurstCapture:
        def __init__(self):
            self.index = 0
            self.attempt = len(opened)
            opened.append(self)
        def isOpened(self):
            return True
        def get(self, prop):
            return 25 if prop == cv2.CAP_PROP_FPS else 0  # Live HLS, not a file.
        def read(self):
            self.index += 1
            if self.attempt == 0 and self.index > 12:
                return False, None
            image = np.zeros((360, 640, 3), np.uint8)
            cv2.rectangle(image, (30 + self.index, 140), (90 + self.index, 185), (60, 230, 80), -1)
            return True, image  # An entire segment is available without waiting.
        def release(self):
            pass

    monkeypatch.setattr(module, "open_capture", lambda _: BurstCapture())

    async def scenario():
        session = VideoSession({"id": "burst-test", "stream_url": "synthetic-hls"}, detect_rectangle)
        try:
            await until(lambda: session.sequence >= 5)
            assert session.sequence < 20  # A burst must not be consumed as one image.
            await until(lambda: session.state == "Reconnecting")
            assert session.status()["counts"] is None
            assert session.output is None
            await until(lambda: session.generation >= 2 and bool((session.status().get("metrics") or {}).get("track_ids")))
            status = session.status()
            assert status["metrics"]["track_ids"] == [1]
            assert status["state"] == "Live"
        finally:
            await session.close()
    asyncio.run(scenario())


def test_live_capture_retries_beyond_three_failed_opens(monkeypatch):
    import src.services.video_service as module
    opened = []

    class RetryingCapture:
        def __init__(self):
            self.attempt = len(opened) + 1
            opened.append(self)
            self.index = 0
        def isOpened(self):
            return self.attempt >= 5
        def get(self, prop):
            return 25 if prop == cv2.CAP_PROP_FPS else 0
        def read(self):
            self.index += 1
            if self.index > 150:
                return False, None
            image = np.zeros((360, 640, 3), np.uint8)
            cv2.rectangle(image, (50 + self.index, 140), (110 + self.index, 190), (60, 230, 80), -1)
            return True, image
        def release(self):
            pass

    monkeypatch.setattr(module, "open_capture", lambda _: RetryingCapture())
    monkeypatch.setattr(module, "live_reconnect_delay_seconds", lambda _: .02)

    async def scenario():
        session = VideoSession({"id": "retry-test", "stream_url": "synthetic-hls"}, detect_rectangle)
        try:
            await until(lambda: session.generation >= 1 and session.sequence >= 5 and session.state == "Live")
            assert len(opened) >= 5
            assert session.state == "Live"
        finally:
            await session.close()
    asyncio.run(scenario())


def test_live_reconnect_backoff_is_capped():
    from src.services.video_service import live_reconnect_delay_seconds

    assert [live_reconnect_delay_seconds(attempt) for attempt in range(1, 7)] == [1, 2, 4, 8, 16, 30]
    assert live_reconnect_delay_seconds(99) == 30


def test_bad_negotiation_releases_peer_and_shutdown_reclaims_capture(moving_video):
    async def scenario():
        service = VideoService()
        service.infer = detect_rectangle
        try:
            with pytest.raises((ValueError, AssertionError)):
                await service.offer(moving_video, "malformed sdp", "offer")
            assert not service.peers
        finally:
            await service.shutdown()
        assert not service.sessions
    asyncio.run(scenario())


def test_replacement_session_is_reclaimed_even_when_an_old_viewer_leaves_later(moving_video):
    async def scenario():
        service = VideoService()
        service.infer = detect_rectangle
        clients = []
        try:
            async def join():
                client = RTCPeerConnection(RTCConfiguration(iceServers=[]))
                client.addTransceiver("video", direction="recvonly")
                clients.append(client)
                await client.setLocalDescription(await client.createOffer())
                answer = await service.offer(moving_video, client.localDescription.sdp, "offer")
                await client.setRemoteDescription(RTCSessionDescription(answer["sdp"], answer["type"]))
                return answer
            old = await join()
            session = service.sessions[moving_video["id"]]
            # Simulate the end-of-file lifecycle, leaving its viewer connected.
            await session.close()
            session.state = "Recorded playback ended"
            new = await join()
            assert old["session_id"] != new["session_id"]
            await service.leave(old["viewer_id"])
            await service.leave(new["viewer_id"])
            await until(lambda: not service.sessions, timeout=6)
        finally:
            await asyncio.gather(*(client.close() for client in clients))
            await service.shutdown()
    asyncio.run(scenario())


def test_legacy_perception_start_actually_schedules_processing_and_stop_cancels(client, monkeypatch):
    import threading
    import src.api.routes.perception as routes
    started, stopped = threading.Event(), threading.Event()

    class Pipeline:
        def __init__(self, **_):
            pass
        async def process_video(self, source, skip_frames):
            assert source == "demo_midtown"
            started.set()
            await asyncio.sleep(60)
        def stop(self):
            stopped.set()

    monkeypatch.setattr("src.perception.detector.VehicleDetector", lambda **_: object())
    monkeypatch.setattr("src.perception.pipeline.PerceptionPipeline", Pipeline)
    response = client.post("/api/v1/perception/start", params={"camera_id": "test-scheduled", "video_source": "demo_midtown"})
    assert response.status_code == 200 and response.json()["status"] == "starting"
    assert started.wait(1)
    assert client.post("/api/v1/perception/start", params={"camera_id": "test-scheduled"}).json()["status"] == "already_running"
    assert client.post("/api/v1/perception/stop", params={"camera_id": "test-scheduled"}).json()["status"] == "stopped"
    assert stopped.is_set()
    assert "test-scheduled" not in routes._active_pipelines
    assert "test-scheduled" not in routes._pipeline_tasks
