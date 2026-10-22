import asyncio
from datetime import datetime, timezone, timedelta
import threading
import time
from contextlib import closing
from types import SimpleNamespace
import networkx as nx
import numpy as np

from src.perception.models import Detection
from src.perception.road_tracking import ClassConsensus, RoadTracker
from src.api.routes.video import camera_capture_status
from src.services.detection_store import DetectionStore
from src.services.camera_traffic import road_context, road_observations, route_matches_camera
from src.services.video_service import VideoService, summarize_detection_window


def test_lightweight_capture_status_route_skips_history_and_returns_live_decoder_state(monkeypatch):
    from src.api.routes import video as video_routes

    status = {"active": True, "session_state": "Live", "frames_decoded": 321,
              "inference_updates": 120, "sample_age_seconds": .1}
    monkeypatch.setattr(video_routes.mobility_service, "cameras", {"camera": {"id": "camera"}})
    monkeypatch.setattr(video_routes.video_service, "capture_status", lambda camera_id: status)

    assert asyncio.run(camera_capture_status("camera")) == status


def test_clear_car_is_classified_after_two_independent_hits():
    classifier = ClassConsensus()
    car = Detection((10, 10, 50, 30), 2, "car", .34, {"car": .34, "truck": .08, "bus": .03})
    assert classifier.update(car) == "vehicle"
    assert classifier.update(car) == "car"


def test_class_promotion_does_not_add_passages_and_people_are_saved_separately(tmp_path):
    store = DetectionStore(tmp_path)
    zone = store.set_zone("camera", {"enabled": True, "name": "Inbound", "polygon": [[0, 0], [1, 0], [1, 1]],
        "direction": [0, 1], "minimum_motion": .008, "counting_line_y": .64})
    stamp = datetime.now(timezone.utc).isoformat()
    for sequence, kind in enumerate(("vehicle", "car")):
        objects = [{"id": 1, "class": kind, "confidence": .7, "bbox": [1, 2, 30, 20],
                    "counted": True, "crossed_at": stamp},
                   {"id": 2, "class": "pedestrian", "confidence": .8, "bbox": [60, 2, 10, 30],
                    "counted": True, "crossed_at": stamp}]
        store.save("camera", "session", "model", {"sequence": sequence, "generation": 1,
            "observed_at": stamp, "media_time_seconds": sequence, "counts": {}, "detections": objects,
            "analysis_zone": zone})
    summary = store.summary("camera", stamp)
    assert summary["total_passed"] == 1 and summary["classes"] == {"car": 1}
    assert summary["video_evidence"]["enabled"] is True
    assert summary["video_evidence"]["ready_clips"] == 0
    assert summary["minutes"][0]["total"] == 1
    assert "not confirmed distinct vehicles" in summary["count_basis"]
    assert "identity splits can overcount" in summary["count_basis"]
    assert summary["track_quality"] == {
        "counted_track_count": 1, "brief_track_count": 1,
        "brief_track_percent": 100.0, "average_observations": 2.0,
    }
    assert store.history("camera")["unique_tracks"] == {"car": 1, "pedestrian": 1}


def test_track_quality_reports_brief_visibility_without_labeling_it_false(tmp_path):
    store = DetectionStore(tmp_path)
    zone = store.set_zone("camera", {"enabled": True, "name": "Inbound",
        "polygon": [[0, 0], [1, 0], [1, 1]], "direction": [0, 1],
        "minimum_motion": .008, "counting_line_y": .64})
    now = datetime.now(timezone.utc)
    for index, duration in enumerate((1.0, 4.0)):
        first = now - timedelta(seconds=duration + 1)
        last = now - timedelta(seconds=1)
        for sequence, stamp in enumerate((first, last)):
            store.save("camera", f"session-{index}", "model", {
                "sequence": sequence, "generation": 1, "observed_at": stamp.isoformat(),
                "media_time_seconds": sequence, "counts": {"car": 1},
                "detections": [{"id": 1, "class": "car", "confidence": .8,
                    "bbox": [10, 20, 30, 20], "counted": True,
                    "crossed_at": last.isoformat()}], "analysis_zone": zone,
            })

    quality = store.summary("camera", (now - timedelta(minutes=1)).isoformat())["track_quality"]

    assert quality == {"counted_track_count": 2, "brief_track_count": 1,
        "brief_track_percent": 50.0, "average_observations": 2.0}


def test_summary_reports_saved_video_pauses_and_session_changes(tmp_path):
    store = DetectionStore(tmp_path)
    zone = store.set_zone("camera", {"enabled": True, "name": "Inbound",
        "polygon": [[0, 0], [1, 0], [1, 1]], "direction": [0, 1],
        "minimum_motion": .008, "counting_line_y": .64})
    now = datetime.now(timezone.utc)
    stamps = [now - timedelta(seconds=12), now - timedelta(seconds=11),
              now - timedelta(seconds=2), now - timedelta(seconds=1)]
    with closing(store.connect()) as db:
        for sequence, (session, stamp) in enumerate(zip(("first", "first", "second", "second"), stamps)):
            db.execute("""INSERT INTO samples(session,sequence,camera,observed_at,media_time,counts,model,
                zone_revision,traffic,generation) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (session, sequence, "camera", stamp.isoformat(), sequence, "{}", "test",
                 zone["revision"], '{"analysis_available":true,"object_count":0}', 1))
        db.commit()

    continuity = store.summary("camera", now.isoformat())["video_continuity"]

    assert continuity["sample_count"] == 4
    assert continuity["session_count"] == 2
    assert continuity["long_pause_count"] == 1
    assert continuity["longest_pause_seconds"] == 9.0
    assert continuity["coverage_percent"] == 0.8
    assert continuity["recent_pauses"] == [{
        "from": stamps[1].isoformat(), "to": stamps[2].isoformat(),
        "duration_seconds": 9.0, "session_changed": True, "in_progress": False,
    }]


def test_summary_reports_a_stale_latest_sample_as_an_in_progress_gap(tmp_path):
    store = DetectionStore(tmp_path)
    zone = store.set_zone("camera", {"enabled": True, "name": "Inbound",
        "polygon": [[0, 0], [1, 0], [1, 1]], "direction": [0, 1],
        "minimum_motion": .008, "counting_line_y": .64})
    now = datetime.now(timezone.utc)
    stamp = now - timedelta(seconds=8)
    with closing(store.connect()) as db:
        db.execute("""INSERT INTO samples(session,sequence,camera,observed_at,media_time,counts,model,
            zone_revision,traffic,generation) VALUES (?,?,?,?,?,?,?,?,?,?)""",
            ("session", 1, "camera", stamp.isoformat(), 1, "{}", "test",
             zone["revision"], '{"analysis_available":true,"object_count":0}', 1))
        db.commit()

    continuity = store.summary("camera", now.isoformat())["video_continuity"]

    assert continuity["latest_sample_age_seconds"] == 8.0
    assert continuity["long_pause_count"] == 0
    gap = continuity["recent_pauses"][0]
    assert gap["from"] == stamp.isoformat()
    assert datetime.fromisoformat(gap["to"]) >= now
    assert gap["duration_seconds"] == 8.0
    assert gap["session_changed"] is False
    assert gap["in_progress"] is True


def test_capture_status_exposes_counts_and_state_without_client_ids():
    from src.services.video_service import VideoService

    service = VideoService()
    session = SimpleNamespace(camera={"id": "camera"}, stop_event=threading.Event(), status=lambda: {
        "state": "Live", "sample_age_seconds": .4, "frames_decoded": 245,
        "inference_updates": 18, "reconnect_attempts": 3, "retry_in_seconds": 4.2,
        "error": "", "inference_error": "", "storage_error": "Observation history writer fell behind; recent road analysis may be delayed. Live video and inference continue.", "model": "bdd-yolo11n.onnx",
        "detection_profile": "low_light", "execution_provider": "OpenCV DNN · CPU",
        "output_fps": 15.0, "inference_fps": 4.1, "evidence_fps": 10.0,
        "metrics": {"detections": [{"id": 1}, {"id": 2}], "analysis_pipeline": {
            "confirmed_displayed_tracks": 1, "provisional_displayed_tracks": 1}},
    })
    service.sessions["camera"] = session
    service.monitor_leases[("camera", "private-client-token")] = time.monotonic()
    service.peers["viewer-id"] = (None, session, time.monotonic())

    status = service.capture_status("camera")

    assert status == {
        "active": True, "camera_detection_policy_version": 3,
        "restart_drain_version": 1, "evidence_pause_order_version": 1,
        "video_capacity_scan_version": 1, "evidence_frame_policy_version": 4,
        "session_state": "Live", "monitoring_lease_count": 1,
        "live_viewer_count": 1, "sample_age_seconds": .4, "frames_decoded": 245,
        "inference_updates": 18, "model": "bdd-yolo11n.onnx", "detection_profile": "low_light",
        "supplemental_detail_status": "road_zone_required",
        "execution_provider": "OpenCV DNN · CPU", "output_fps": 15.0, "inference_fps": 4.1, "evidence_fps": 10.0,
        "visible_tracks": 2, "confirmed_visible_tracks": 1, "provisional_visible_tracks": 1,
        "reconnect_attempts": 3, "retry_in_seconds": 4.2,
        "error": "", "inference_error": "", "storage_error": "Observation history writer fell behind; recent road analysis may be delayed. Live video and inference continue.",
    }
    assert "private-client-token" not in str(status)


def test_capture_status_explains_night_detail_memory_safeguard(tmp_path, monkeypatch):
    import src.services.video_service as video_module

    model = tmp_path / "night-detail.onnx"
    model.write_bytes(b"model")
    monkeypatch.setattr(video_module.settings, "VIDEO_LOW_LIGHT_HIGH_RES_MODEL_PATH", model)
    monkeypatch.setattr(video_module, "available_system_memory_bytes", lambda: 1_000_000_000)
    service = VideoService()
    service.observation_store = SimpleNamespace(zone=lambda _: {"enabled": True})
    session = SimpleNamespace(camera={"id": "camera"}, stop_event=threading.Event(), status=lambda: {
        "state": "Live", "sample_age_seconds": 0, "frames_decoded": 1, "inference_updates": 1,
        "detection_profile": "low_light", "execution_provider": "CUDAExecutionProvider",
        "output_fps": 15, "inference_fps": 6, "reconnect_attempts": 0, "retry_in_seconds": None,
        "error": "", "inference_error": "", "storage_error": "", "metrics": None,
    })
    service.sessions["camera"] = session

    assert service.capture_status("camera")["supplemental_detail_status"] == "memory_limited"


def test_capture_status_reports_when_no_camera_session_exists():
    from src.services.video_service import VideoService

    assert VideoService().capture_status("camera") == {
        "active": False, "camera_detection_policy_version": 3,
        "restart_drain_version": 1, "evidence_pause_order_version": 1,
        "video_capacity_scan_version": 1, "evidence_frame_policy_version": 4,
        "session_state": "Not connected", "monitoring_lease_count": 0,
        "live_viewer_count": 0, "sample_age_seconds": None, "frames_decoded": 0,
        "inference_updates": 0, "model": None, "detection_profile": None,
        "supplemental_detail_status": None,
        "execution_provider": None, "output_fps": 0, "inference_fps": 0, "evidence_fps": None,
        "visible_tracks": None, "confirmed_visible_tracks": None, "provisional_visible_tracks": None,
        "reconnect_attempts": 0, "retry_in_seconds": None,
        "error": "", "inference_error": "", "storage_error": "",
    }


def test_summary_reports_the_exact_disk_reserve_blocking_video_recording(tmp_path, monkeypatch):
    from types import SimpleNamespace
    import src.services.detection_store as detection_store

    store = DetectionStore(tmp_path, min_free_bytes=2_000_000_000)
    monkeypatch.setattr(detection_store.shutil, "disk_usage",
        lambda _: SimpleNamespace(free=1_250_000_000, total=10_000_000_000, used=8_750_000_000))

    evidence = store.summary("camera", datetime.now(timezone.utc).isoformat())["video_evidence"]

    assert evidence["free_disk_bytes"] == 1_250_000_000
    assert evidence["minimum_free_bytes"] == 2_000_000_000
    assert "free disk space is below the configured 2 GB safety reserve" in evidence["storage_block_reason"]


def test_ambiguous_rider_is_saved_separately_without_inflating_vehicle_totals(tmp_path):
    store = DetectionStore(tmp_path)
    zone = store.set_zone("camera", {"enabled": True, "name": "Inbound", "polygon": [[0, 0], [1, 0], [1, 1]],
        "direction": [0, 1], "minimum_motion": .008, "counting_line_y": .64})
    stamp = datetime.now(timezone.utc).isoformat()
    detections = [
        {"id": 1, "class": "car", "confidence": .8, "bbox": [10, 20, 30, 20], "counted": True, "crossed_at": stamp},
        {"id": 2, "class": "bicycle", "confidence": .8, "bbox": [60, 20, 30, 30], "counted": True, "crossed_at": stamp},
        {"id": 3, "class": "rider", "confidence": .82, "bbox": [60, 10, 30, 40], "counted": True, "crossed_at": stamp},
    ]
    store.save("camera", "session", "model", {"sequence": 1, "generation": 1, "observed_at": stamp,
        "media_time_seconds": 1, "counts": {"car": 1, "bicycle": 1, "rider": 1}, "detections": detections,
        "analysis_zone": zone})

    summary = store.summary("camera", stamp)
    assert summary["classes"] == {"bicycle": 1, "car": 1, "rider": 1}
    assert summary["total_passed"] == 2
    assert summary["minutes"][0]["total"] == 2
    assert store.history("camera")["unique_tracks"]["rider"] == 1


def test_crossing_gate_counts_one_track_not_every_frame(tmp_path):
    tracker = RoadTracker()
    store = DetectionStore(tmp_path)
    frame = np.zeros((480, 640, 3), np.uint8)
    profile = store.set_zone("camera", {"enabled": True, "name": "Inbound", "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]], "direction": [.2, .98], "minimum_motion": .008, "counting_line_y": .64})
    start = datetime.now(timezone.utc) - timedelta(seconds=10)
    crossed_ids = set()
    for index in range(40):
        boxes = tracker.update([Detection((180 + index * 2, 60 + index * 8, 60, 45), 2, "car", .85)], frame, index / 15, profile)
        for box in boxes:
            if box["counted"]:
                crossed_ids.add(box["id"])
                box["crossed_at"] = (start + timedelta(seconds=2)).isoformat()
        store.save("camera", "session", "model", {"sequence": index, "generation": 1,
            "observed_at": (start + timedelta(seconds=index / 15)).isoformat(), "media_time_seconds": index / 15,
            "counts": {"car": len(boxes)}, "detections": boxes, "analysis_zone": profile})
    result = DetectionStore(tmp_path).summary("camera", start.isoformat())
    assert crossed_ids == {1}
    assert result["total_passed"] == 1 and result["classes"] == {"car": 1}
    assert sum(item["total"] for item in result["minutes"]) == 1
    # These samples are from ten seconds ago. The cumulative crossing history
    # still includes them, but they are no longer live tracks.
    assert result["tracked_in_window"] == 0


def test_live_track_badge_uses_two_second_window_not_monitoring_history(tmp_path):
    store = DetectionStore(tmp_path)
    zone = store.set_zone("camera", {"enabled": True, "name": "Inbound",
        "polygon": [[0, 0], [1, 0], [1, 1]], "direction": [0, 1],
        "minimum_motion": .008, "counting_line_y": .64})
    now = datetime.now(timezone.utc)
    for index, age_seconds in enumerate((8, .5)):
        stamp = (now - timedelta(seconds=age_seconds)).isoformat()
        detection = {"id": index + 1, "class": "car", "confidence": .8,
            "bbox": [10, 20, 30, 20], "direction": "approaching"}
        store.save("camera", f"session-{index}", "model", {
            "sequence": 1, "generation": 1, "observed_at": stamp,
            "media_time_seconds": 1, "counts": {"car": 1},
            "detections": [detection], "analysis_zone": zone,
        })

    result = store.summary("camera", (now - timedelta(minutes=1)).isoformat())

    assert result["tracked_in_window"] == 1


def test_full_scene_tracks_do_not_count_crossings_without_directional_calibration():
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    profile = {"enabled": False, "counting_line_y": .64}
    outputs = []
    for index in range(12):
        outputs.extend(tracker.update([Detection((160, 190 + index * 8, 50, 35), 2, "car", .9,
            {"car": .9, "bus": .02, "truck": .02})], frame, index / 15, profile))
    assert outputs
    assert all(box["direction"] == "unrestricted" and not box["counted"] for box in outputs)


def test_congestion_estimate_expires_and_requires_observed_motion(tmp_path):
    store = DetectionStore(tmp_path)
    zone = store.set_zone("camera", {"enabled": True, "name": "Inbound", "polygon": [[0, 0], [1, 0], [1, 1]], "direction": [0, 1], "minimum_motion": .008, "counting_line_y": .64})
    now = datetime.now(timezone.utc)
    for index in range(10):
        store.save("camera", "session", "model", {"sequence": index, "generation": 1,
            "observed_at": (now - timedelta(seconds=9 - index)).isoformat(), "media_time_seconds": index,
            "counts": {"car": 5}, "detections": [], "traffic": {"analysis_available": True,
                    "object_count": 5, "image_coverage": .2, "slow_fraction": .9, "median_motion": .1},
                "analysis_zone": zone})
    summary = store.summary("camera", (now - timedelta(minutes=1)).isoformat())
    assert summary["traffic_estimate"]["level"] == "slow"
    assert summary["video_evidence"]["enabled"] is True
    assert store.summary("unobserved", now.isoformat())["traffic_estimate"]["level"] == "unknown"
    with closing(store.connect()) as db, db:
        db.execute("UPDATE samples SET observed_at=?", ((now - timedelta(minutes=2)).isoformat(),))
    assert store.summary("camera", (now - timedelta(minutes=3)).isoformat())["traffic_estimate"]["level"] == "unknown"


def test_visible_vehicles_without_track_motion_remain_unclassified(tmp_path):
    store = DetectionStore(tmp_path)
    zone = store.set_zone("camera", {"enabled": True, "name": "Inbound",
        "polygon": [[0, 0], [1, 0], [1, 1]], "direction": [0, 1],
        "minimum_motion": .008, "counting_line_y": .64})
    now = datetime.now(timezone.utc)
    for index in range(10):
        store.save("camera", "session", "model", {
            "sequence": index, "generation": 1,
            "observed_at": (now - timedelta(seconds=9 - index)).isoformat(),
            "media_time_seconds": index, "counts": {"car": 2}, "detections": [],
            "traffic": {"analysis_available": True, "object_count": 2,
                "image_coverage": .2, "slow_fraction": None, "median_motion": None},
            "analysis_zone": zone,
        })

    estimate = store.summary("camera", (now - timedelta(minutes=1)).isoformat())["traffic_estimate"]

    assert estimate["level"] == "unknown"
    assert estimate["label"] == "Vehicle movement · motion unavailable"
    assert estimate["evidence_quality"] == "motion_unavailable"
    assert estimate["movement_sample_count"] == 0


def test_sparse_night_detections_do_not_color_the_whole_road_as_moving(tmp_path):
    store = DetectionStore(tmp_path)
    zone = store.set_zone("camera", {"enabled": True, "name": "Inbound", "polygon": [[0, 0], [1, 0], [1, 1]], "direction": [0, 1], "minimum_motion": .008, "counting_line_y": .64})
    now = datetime.now(timezone.utc)
    for index in range(10):
        store.save("camera", "session", "model", {"sequence": index, "generation": 1,
            "observed_at": (now - timedelta(seconds=9 - index)).isoformat(), "media_time_seconds": index,
            "counts": {"car": 2}, "detections": [], "traffic": {"analysis_available": True,
                    "object_count": 2, "image_coverage": .02, "slow_fraction": .1, "median_motion": 1.0},
                "analysis_zone": zone})
    estimate = store.summary("camera", (now - timedelta(minutes=1)).isoformat())["traffic_estimate"]
    assert estimate["level"] == "unknown"
    assert estimate["evidence_quality"] == "sparse"
    assert estimate["label"] == "Vehicle movement · sparse view"
    summary = store.summary("camera", (now - timedelta(minutes=1)).isoformat())
    assert summary["road_coverage_policy_version"] == 2


def test_low_light_road_condition_is_withheld_until_coverage_reaches_night_threshold(tmp_path):
    store = DetectionStore(tmp_path)
    zone = store.set_zone("camera", {"enabled": True, "name": "Inbound",
        "polygon": [[0, 0], [1, 0], [1, 1]], "direction": [0, 1],
        "minimum_motion": .008, "counting_line_y": .64})
    now = datetime.now(timezone.utc)
    for index in range(10):
        stamp = (now - timedelta(seconds=9 - index)).isoformat()
        store.save("camera", "session", "night-model", {
            "sequence": index, "generation": 1, "observed_at": stamp,
            "media_time_seconds": index, "counts": {"car": 4}, "detections": [],
            "traffic": {"analysis_available": True, "object_count": 4,
                "image_coverage": .151, "slow_fraction": .25, "median_motion": .1,
                "visibility": "low_light"},
            "analysis_zone": zone,
        })

    estimate = store.summary("camera", (now - timedelta(minutes=1)).isoformat())["traffic_estimate"]

    assert estimate["visibility"] == "low_light"
    assert estimate["image_coverage_percent"] == 15.1
    assert estimate["level"] == "unknown"
    assert estimate["evidence_quality"] == "sparse"
    assert estimate["label"] == "Vehicle movement · sparse view"


def test_low_light_road_condition_can_be_estimated_when_coverage_meets_night_threshold(tmp_path):
    store = DetectionStore(tmp_path)
    zone = store.set_zone("camera", {"enabled": True, "name": "Inbound",
        "polygon": [[0, 0], [1, 0], [1, 1]], "direction": [0, 1],
        "minimum_motion": .008, "counting_line_y": .64})
    now = datetime.now(timezone.utc)
    for index in range(10):
        store.save("camera", "session", "night-model", {
            "sequence": index, "generation": 1,
            "observed_at": (now - timedelta(seconds=9 - index)).isoformat(),
            "media_time_seconds": index, "counts": {"car": 4}, "detections": [],
            "traffic": {"analysis_available": True, "object_count": 4,
                "image_coverage": .20, "slow_fraction": .7, "median_motion": .1,
                "visibility": "low_light"},
            "analysis_zone": zone,
        })

    estimate = store.summary("camera", (now - timedelta(minutes=1)).isoformat())["traffic_estimate"]

    assert estimate["level"] == "slow"
    assert estimate["label"] == "Possible queue"


def test_sparse_camera_view_reports_verified_inbound_flow_without_claiming_congestion(tmp_path):
    store = DetectionStore(tmp_path)
    zone = store.set_zone("camera", {"enabled": True, "name": "Inbound",
        "polygon": [[0, 0], [1, 0], [1, 1]], "direction": [0, 1],
        "minimum_motion": .008, "counting_line_y": .64})
    now = datetime.now(timezone.utc)
    for index in range(8):
        stamp = (now - timedelta(seconds=7 - index)).isoformat()
        detections = []
        if index < 3:
            detections = [{"id": index + 1, "class": "car", "confidence": .6,
                "bbox": [10, 20, 30, 20], "counted": True, "crossed_at": stamp,
                "direction": "approaching"}]
        store.save("camera", "session", "model", {"sequence": index,
            "generation": 1, "observed_at": stamp, "media_time_seconds": index,
            "counts": {"car": len(detections)}, "detections": detections,
            "traffic": {"analysis_available": True, "object_count": 0,
                "image_coverage": .01, "slow_fraction": 0, "median_motion": None},
            "analysis_zone": zone})

    estimate = store.summary("camera", (now - timedelta(minutes=1)).isoformat())["traffic_estimate"]

    assert estimate["level"] == "unknown"
    assert estimate["evidence_quality"] == "sparse"
    assert estimate["track_crossings_last_minute"] == 3
    assert estimate["label"] == "Inbound vehicle flow · congestion unknown"


def test_unconfigured_camera_hides_full_scene_counts_and_traffic_estimates(tmp_path):
    store = DetectionStore(tmp_path)
    now = datetime.now(timezone.utc)
    store.save("camera", "session", "model", {"sequence": 1, "generation": 1,
        "observed_at": now.isoformat(), "media_time_seconds": 1, "counts": {"car": 1},
        "detections": [{"id": 7, "class": "car", "confidence": .9, "bbox": [1, 2, 30, 20],
            "counted": True, "crossed_at": now.isoformat()}],
        "traffic": {"analysis_available": True, "object_count": 3, "image_coverage": .3,
            "slow_fraction": .9, "median_motion": .1}})

    summary = store.summary("camera", (now - timedelta(minutes=1)).isoformat())
    history = store.history("camera")

    assert summary["directional_zone_enabled"] is False
    assert summary["total_passed"] == 0 and summary["classes"] == {} and summary["minutes"] == []
    assert summary["traffic_estimate"]["label"] == "Direction zone required"
    assert summary["traffic_estimate"]["sample_count"] == 0
    assert history["directional_zone_enabled"] is False
    assert history["events"][0]["counted"] == 1  # Raw durable history is retained.


def test_live_detection_diagnostic_aggregates_recent_frames_without_crossing_generations():
    history = [
        (1, 9.0, ["track-a"], None, 1.0, 4, {"raw_candidates": 2, "road_candidates": 1, "outside_zone_candidates": 1,
            "outside_zone_classes": {"car": 1}, "outside_zone_boxes": [{"bbox": [10, 20, 30, 40], "class": "car", "confidence": .7}],
            "inbound_tracks": 1}),
        (2, 9.5, [], None, 1.0, 4, {"raw_candidates": 1, "road_candidates": 0, "outside_zone_candidates": 1,
            "outside_zone_classes": {"truck": 1}, "outside_zone_boxes": [{"bbox": [50, 60, 70, 80], "class": "truck", "confidence": .6}],
            "inbound_tracks": 0}),
        (3, 9.8, [], None, 1.0, 3, {"raw_candidates": 8, "road_candidates": 8, "inbound_tracks": 8}),
    ]
    result = summarize_detection_window(history, 10.0, generation=4)
    assert result == {"window_seconds": 2.0, "window_frames": 2, "raw_candidate_frames": 2,
        "road_candidate_frames": 1, "road_candidate_observations": 1,
        "outside_zone_observations": 2, "outside_zone_classes": {"car": 1, "truck": 1},
        "outside_zone_boxes": [{"bbox": [50, 60, 70, 80], "class": "truck", "confidence": .6}],
        "directional_outside_tracks": [],
        "inbound_tracks_peak": 1}


def test_summary_reports_when_video_clips_are_disabled(tmp_path):
    store = DetectionStore(tmp_path, record_video=False)
    (store.clips / "existing.mp4").write_bytes(b"saved-file")
    status = store.summary("camera", datetime.now(timezone.utc).isoformat())["video_evidence"]
    assert {key: status[key] for key in ("enabled", "ready_clips", "recording_clips",
        "interrupted_clips", "bytes_used", "max_bytes")} == {"enabled": False, "ready_clips": 0, "recording_clips": 0,
        "interrupted_clips": 0,
        "bytes_used": 10, "max_bytes": 6_000_000_000}
    assert status["free_disk_bytes"] > 0
    assert status["minimum_free_bytes"] == 1_000_000_000
    assert status["storage_block_reason"] == ""


def test_mapping_uses_catalog_route_and_direction_not_just_nearest_road(tmp_path):
    graph = nx.MultiDiGraph()
    for node, lat, lon in [(1, 34.001, -118), (2, 33.999, -118), (3, 34.001, -117.9999), (4, 33.999, -117.9999)]:
        graph.add_node(node, y=lat, x=lon)
    graph.add_edge(1, 2, highway="motorway", ref="I 110", name="Harbor Freeway")
    graph.add_edge(2, 1, highway="motorway", ref="I 110", name="Wrong direction")
    graph.add_edge(3, 4, highway="motorway", ref="I 101", name="Wrong route")
    camera = {"id": "camera", "lat": 34, "lng": -118, "route": "I-110", "direction": "South"}
    store = DetectionStore(tmp_path)
    road = road_context(camera, graph, store)
    assert road["matched"] and (road["u"], road["v"]) == (1, 2)
    assert road["road_matching_version"] == 5
    assert road_context(camera, graph, DetectionStore(tmp_path)) == road
    roads = road_observations(store)
    assert len(roads) == 1 and roads[0]["estimate"]["level"] == "unknown"
    assert roads[0]["estimate"]["label"] == "No active feed"

    camera["route"] = "I-5"
    changed_route = road_context(camera, graph, store)
    assert changed_route["matched"] is False
    assert changed_route["association"] == "No matching directional OSM segment within 200 m"

    camera.update(route="I-110", direction="North")
    changed_direction = road_context(camera, graph, store)
    assert changed_direction["matched"] is True
    assert (changed_direction["u"], changed_direction["v"]) == (2, 1)


def test_road_direction_match_uses_local_tangent_on_curved_segment(tmp_path):
    from shapely.geometry import LineString

    graph = nx.MultiDiGraph()
    graph.add_node(1, y=33.999, x=-118.001)
    graph.add_node(2, y=34.001, x=-117.999)
    # The edge's endpoint chord points northeast, but the road beside the
    # camera bends south. The camera's catalog direction describes that local
    # roadway, not the chord across the full curved segment.
    geometry = LineString([(-118.001, 33.999), (-118, 34.0005),
                           (-118, 34), (-118, 33.9995), (-117.999, 34.001)])
    graph.add_edge(1, 2, highway="motorway", ref="I 110", name="Harbor Freeway", geometry=geometry)
    camera = {"id": "curved-camera", "lat": 34, "lng": -118,
              "route": "I-110", "direction": "South"}

    road = road_context(camera, graph, DetectionStore(tmp_path))

    assert road["matched"] is True
    assert (road["u"], road["v"]) == (1, 2)


def test_curved_road_geometry_can_match_when_both_osm_endpoints_are_far(tmp_path):
    from shapely.geometry import LineString

    graph = nx.MultiDiGraph()
    graph.add_node(1, y=34.008, x=-118.008)
    graph.add_node(2, y=34.008, x=-117.992)
    # This I-5 curve comes within 10 m of the camera and travels south there,
    # although its endpoints are each more than 700 m away.
    geometry = LineString([(-118.008, 34.008), (-118.0001, 34.0004),
                           (-118.0001, 33.9996), (-117.992, 34.008)])
    graph.add_edge(1, 2, highway="motorway", ref="I 5", name="Santa Ana Freeway",
                   geometry=geometry)
    camera = {"id": "curved-i5-camera", "lat": 34, "lng": -118,
              "route": "I-5", "direction": "South"}

    road = road_context(camera, graph, DetectionStore(tmp_path))

    assert road["matched"] is True
    assert road["distance_m"] <= 200
    assert (road["u"], road["v"]) == (1, 2)


def test_missing_camera_route_metadata_invalidates_cached_road_attribution(tmp_path):
    graph = nx.MultiDiGraph()
    graph.add_node(1, y=34.001, x=-118)
    graph.add_node(2, y=33.999, x=-118)
    graph.add_edge(1, 2, highway="motorway", ref="I 110", name="Harbor Freeway")
    camera = {"id": "catalog-camera", "lat": 34, "lng": -118, "route": "I-110",
              "direction": "South", "stream_url": "https://camera.example/live.m3u8"}
    store = DetectionStore(tmp_path)
    assert road_context(camera, graph, store)["matched"] is True

    camera["route"] = None
    camera["direction"] = None
    roads = road_observations(store, {camera["id"]: camera}, graph, (camera["id"],))

    assert roads == []
    persisted = road_context(camera, graph, store)
    assert persisted["matched"] is False
    assert "required before camera traffic" in persisted["association"]


def test_active_camera_gets_a_road_link_without_inventing_traffic(tmp_path):
    graph = nx.MultiDiGraph()
    graph.add_node(1, y=34.001, x=-118)
    graph.add_node(2, y=33.999, x=-118)
    graph.add_edge(1, 2, highway="motorway", ref="I 110", name="Harbor Freeway")
    camera = {"id": "active-camera", "lat": 34, "lng": -118, "route": "I-110",
              "direction": "South", "stream_url": "https://camera.example/live.m3u8"}
    store = DetectionStore(tmp_path)

    roads = road_observations(store, {camera["id"]: camera}, graph, (camera["id"],))

    assert len(roads) == 1
    assert roads[0]["camera_id"] == "active-camera"
    assert roads[0]["matched"] is True
    assert roads[0]["estimate"]["level"] == "unknown"
    assert roads[0]["estimate"]["label"] == "Direction zone required"
    assert "not attributed to this road" in roads[0]["estimate"]["basis"]


def test_configured_active_camera_can_publish_only_its_directional_summary(tmp_path):
    graph = nx.MultiDiGraph()
    graph.add_node(1, y=34.001, x=-118)
    graph.add_node(2, y=33.999, x=-118)
    graph.add_edge(1, 2, highway="motorway", ref="I 110", name="Harbor Freeway")
    camera = {"id": "configured-camera", "lat": 34, "lng": -118, "route": "I-110",
              "direction": "South", "stream_url": "https://camera.example/live.m3u8"}
    store = DetectionStore(tmp_path)
    store.set_zone(camera["id"], {"enabled": True, "name": "Inbound", "polygon": [[0, 0], [1, 0], [1, 1]],
        "direction": [0, 1], "minimum_motion": .008, "counting_line_y": .64})

    roads = road_observations(store, {camera["id"]: camera}, graph, (camera["id"],))

    assert roads[0]["estimate"]["label"] == "No recent estimate"
    assert store.summary(camera["id"], datetime.now(timezone.utc).isoformat())["directional_zone_enabled"] is True


def test_route_matching_uses_exact_osm_references_and_los_angeles_freeway_names():
    assert route_matches_camera("I-5", "Interstate 5")
    assert not route_matches_camera("I-5", "Interstate 405")
    assert route_matches_camera("I-405", "San Diego Freeway")
    assert route_matches_camera("I-710", "Long Beach Freeway")
    assert route_matches_camera("I-110", "Arroyo Seco Parkway")
    assert route_matches_camera("US-101", "Ventura Freeway")
    assert route_matches_camera("SR-1", "Pacific Coast Highway")


def test_catalog_camera_road_link_is_visible_without_a_live_traffic_estimate(tmp_path):
    graph = nx.MultiDiGraph()
    graph.add_node(1, y=34.001, x=-118)
    graph.add_node(2, y=33.999, x=-118)
    graph.add_edge(1, 2, highway="motorway", ref="I 110", name="Harbor Freeway")
    camera = {"id": "catalog-camera", "lat": 34, "lng": -118, "route": "I-110",
              "direction": "South", "stream_url": "https://camera.example/live.m3u8"}

    roads = road_observations(DetectionStore(tmp_path), {camera["id"]: camera}, graph, ())

    assert len(roads) == 1
    assert roads[0]["matched"] is True
    assert roads[0]["estimate"]["label"] == "No active feed"


def test_inactive_camera_retains_recent_saved_flow_without_claiming_fresh_congestion(tmp_path):
    graph = nx.MultiDiGraph()
    graph.add_node(1, y=34.001, x=-118)
    graph.add_node(2, y=33.999, x=-118)
    graph.add_edge(1, 2, highway="motorway", ref="I 110", name="Harbor Freeway")
    camera = {"id": "recent-camera", "lat": 34, "lng": -118, "route": "I-110",
              "direction": "South", "stream_url": "https://camera.example/live.m3u8"}
    store = DetectionStore(tmp_path)
    zone = store.set_zone("recent-camera", {"enabled": True, "name": "Inbound",
        "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]], "direction": [0, 1],
        "minimum_motion": .008, "counting_line_y": .64})
    now = datetime.now(timezone.utc)
    for sequence in range(10):
        stamp = (now - timedelta(seconds=20 - sequence * .5)).isoformat()
        store.save("recent-camera", "recent-session", "test-model", {
            "sequence": sequence, "generation": 1, "observed_at": stamp,
            "media_time_seconds": sequence / 2, "counts": {"car": 1},
            "analysis_zone": zone,
            "traffic": {"analysis_available": True, "object_count": 4,
                        "image_coverage": .12, "slow_fraction": .8,
                        "visibility": "standard"},
            "detections": [{"id": 1, "class": "car", "confidence": .8,
                "bbox": [10, 20, 40, 20], "counted": True, "crossed_at": stamp}],
        })

    roads = road_observations(store, {camera["id"]: camera}, graph, ())

    assert len(roads) == 1
    road = roads[0]
    assert road["camera_count"] == 1
    assert road["active_camera_count"] == 0
    assert road["active_camera_ids"] == []
    assert road["source_estimates"][0]["feed_active"] is False
    assert road["estimate"]["sample_count"] == 10
    assert road["estimate"]["track_crossings_last_minute"] == 1
    assert road["estimate"]["level"] == "unknown"
    assert road["estimate"]["label"] == "No recent estimate"
    assert "video feed is inactive" in road["estimate"]["basis"]


def test_cameras_on_one_directed_segment_are_aggregated_with_disagreement_visible(tmp_path, monkeypatch):
    graph = nx.MultiDiGraph()
    graph.add_node(1, y=34.001, x=-118)
    graph.add_node(2, y=33.999, x=-118)
    graph.add_edge(1, 2, highway="motorway", ref="I 110", name="Harbor Freeway")
    cameras = {
        name: {"id": name, "lat": 34, "lng": -118, "route": "I-110", "direction": "South",
               "stream_url": f"https://camera.example/{name}.m3u8"}
        for name in ("camera-a", "camera-b", "camera-c")
    }
    store = DetectionStore(tmp_path)
    for camera_id in cameras:
        store.set_zone(camera_id, {"enabled": True, "name": "Inbound", "polygon": [[0, 0], [1, 0], [1, 1]],
            "direction": [0, 1], "minimum_motion": .008, "counting_line_y": .64})
    estimates = {"camera-a": "moving", "camera-b": "slow", "camera-c": "moving"}
    def summary(camera_id, _since):
        level = estimates[camera_id]
        label = {"moving": "Traffic moving", "slow": "Possible queue"}[level]
        return {"traffic_estimate": {"level": level, "label": label, "sample_count": 20,
            "updated_at": datetime.now(timezone.utc).isoformat(), "image_coverage_percent": 12,
            "slow_fraction": .2 if level == "moving" else .8, "visibility": "standard"}}
    monkeypatch.setattr(store, "summary", summary)

    roads = road_observations(store, cameras, graph, tuple(cameras))

    assert len(roads) == 1
    road = roads[0]
    assert road["camera_ids"] == ["camera-a", "camera-b", "camera-c"]
    assert road["camera_count"] == 3 and road["active_camera_count"] == 3
    assert road["measured_camera_count"] == 3
    assert road["estimate"]["level"] == "moving"
    assert road["estimate"]["sample_count"] == 60


def test_equal_conflicting_camera_estimates_are_not_collapsed_to_a_false_consensus():
    from src.services.camera_traffic import _aggregate_road_observations
    base = {"u": 1, "v": 2, "key": 0, "matched": True, "camera_id": "camera-a",
            "coordinates": [], "route": "I-110", "direction": "South", "name": "Harbor Freeway",
            "estimate": {"level": "moving", "label": "Traffic moving", "sample_count": 8,
                         "updated_at": datetime.now(timezone.utc).isoformat()}}
    other = {**base, "camera_id": "camera-b", "estimate": {**base["estimate"], "level": "slow", "label": "Possible queue"}}

    roads = _aggregate_road_observations([base, other])

    assert len(roads) == 1
    assert roads[0]["estimate"]["level"] == "unknown"
    assert roads[0]["estimate"]["label"] == "Conflicting camera estimates"


def test_sparse_road_aggregation_preserves_coverage_without_claiming_traffic_level():
    from src.services.camera_traffic import _aggregate_road_observations
    row = {"u": 1, "v": 2, "key": 0, "matched": True, "camera_id": "camera-a",
           "coordinates": [], "route": "I-110", "direction": "South", "name": "Harbor Freeway",
           "estimate": {"level": "unknown", "label": "Sparse road coverage", "sample_count": 119,
                        "image_coverage_percent": 1.2, "evidence_quality": "sparse",
                        "updated_at": datetime.now(timezone.utc).isoformat()}}

    roads = _aggregate_road_observations([row])

    assert len(roads) == 1
    estimate = roads[0]["estimate"]
    assert estimate["level"] == "unknown"
    assert estimate["label"] == "Sparse road coverage"
    assert estimate["sample_count"] == 119
    assert estimate["image_coverage_percent"] == 1.2


def test_road_aggregation_preserves_missing_motion_instead_of_implying_moving_traffic():
    from src.services.camera_traffic import _aggregate_road_observations
    row = {"u": 1, "v": 2, "key": 0, "matched": True, "camera_id": "camera-a",
           "coordinates": [], "route": "I-110", "direction": "South", "name": "Harbor Freeway",
           "estimate": {"level": "unknown", "label": "Vehicle movement · motion unavailable",
                        "sample_count": 12, "movement_sample_count": 0,
                        "evidence_quality": "motion_unavailable", "feed_active": True}}

    estimate = _aggregate_road_observations([row])[0]["estimate"]

    assert estimate["level"] == "unknown"
    assert estimate["label"] == "Vehicle movement · motion unavailable"
    assert estimate["evidence_quality"] == "motion_unavailable"
    assert estimate["movement_sample_count"] == 0


def test_background_lease_keeps_capture_alive_without_viewers(monkeypatch):
    import src.services.video_service as module
    class Session:
        def __init__(self, camera, *_args, **_kwargs):
            self.camera, self.id = camera, "session"
            self.stop_event = threading.Event()
            self.state = "Live"
            self.closed = False
        async def close(self):
            self.stop_event.set(); self.closed = True
    monkeypatch.setattr(module, "VideoSession", Session)
    async def scenario():
        service = VideoService()
        await service.monitor({"id": "camera", "stream_url": "test"}, "client-test")
        session = service.sessions["camera"]
        await service._expire("camera", session)
        assert not session.closed and "camera" in service.sessions
        await service.stop_monitor("camera", "client-test")
        await asyncio.sleep(3.2)
        assert session.closed and not service.sessions
        await service.shutdown()
    asyncio.run(scenario())


def test_background_monitor_lease_allows_short_browser_timer_throttling(monkeypatch):
    import src.services.video_service as module
    now = [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: now[0])
    service = VideoService()
    service.monitor_leases[("camera", "client")] = now[0]

    now[0] += 61
    assert service._has_monitor("camera")
    now[0] += module.MONITOR_LEASE_SECONDS - 61
    assert not service._has_monitor("camera")


def test_summary_api_validates_window_and_keeps_raw_history_available(client):
    base = "/api/v1/mobility/video/cameras/caltrans-d7-cctv-1031"
    assert client.get(base + "/summary?since=not-a-date").status_code == 422
    assert client.get(base + "/summary?since=2026-01-01T00:00:00").status_code == 422
    assert client.get(base + "/history").status_code == 200
