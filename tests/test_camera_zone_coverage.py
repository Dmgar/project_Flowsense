import asyncio

from src.api.routes import video
from pydantic import ValidationError


def test_analysis_zone_coverage_lists_only_video_cameras_and_surfaces_calibration(monkeypatch):
    cameras = {
        "configured": {"id": "configured", "name": "Inbound camera", "route": "I-110",
                       "direction": "South", "stream_url": "https://example.test/live.m3u8"},
        "unconfigured": {"id": "unconfigured", "name": "North camera", "route": "I-5",
                         "direction": "North", "stream_url": "https://example.test/other.m3u8"},
        "missing-metadata": {"id": "missing-metadata", "name": "Connected source",
                             "stream_url": "https://example.test/connected.m3u8"},
        "still-only": {"id": "still-only", "name": "Still source", "image_url": "https://example.test/frame.jpg"},
    }
    zones = {
        "configured": {"enabled": True, "revision": 3},
        "unconfigured": {"enabled": False, "revision": 0},
        "missing-metadata": {"enabled": True, "revision": 2},
    }
    monkeypatch.setattr(video.mobility_service, "cameras", cameras)
    monkeypatch.setattr(video.video_service.observation_store, "zone", zones.__getitem__)
    monkeypatch.setattr(video.video_service, "capture_status", lambda camera_id: {
        "active": camera_id == "unconfigured", "session_state": "Live" if camera_id == "unconfigured" else "Not connected",
        "frames_decoded": 12 if camera_id == "unconfigured" else 0,
        "sample_age_seconds": .2 if camera_id == "unconfigured" else None,
    })

    result = asyncio.run(video.analysis_zone_coverage())

    assert result["video_camera_count"] == 3
    assert result["calibrated_count"] == 1
    assert result["calibration_required_count"] == 2
    assert result["zone_required_count"] == 1
    assert result["route_metadata_required_count"] == 1
    assert [camera["camera_id"] for camera in result["cameras"]] == ["missing-metadata", "unconfigured", "configured"]
    assert result["cameras"][0]["ready_for_road_analysis"] is False
    assert result["cameras"][0]["status"] == "route_metadata_required"
    assert result["cameras"][2]["zone_revision"] == 3
    assert result["cameras"][2]["ready_for_road_analysis"] is True
    assert result["cameras"][1]["playback_verified"] is True
    assert result["cameras"][1]["playback_session_state"] == "Live"
    assert result["cameras"][2]["playback_verified"] is False


def test_analysis_zone_coverage_does_not_verify_stale_or_inactive_video(monkeypatch):
    camera = {"id": "camera", "name": "Camera", "route": "I-110", "direction": "South",
              "stream_url": "https://example.test/live.m3u8"}
    monkeypatch.setattr(video.mobility_service, "cameras", {"camera": camera})
    monkeypatch.setattr(video.video_service.observation_store, "zone", lambda _: {"enabled": False, "revision": 0})
    monkeypatch.setattr(video.video_service, "capture_status", lambda _: {
        "active": True, "session_state": "Live", "frames_decoded": 99, "sample_age_seconds": 9,
    })

    result = asyncio.run(video.analysis_zone_coverage())

    assert result["cameras"][0]["playback_verified"] is False
    assert result["cameras"][0]["playback_session_state"] is None


def test_analysis_zone_accepts_a_normalized_oriented_counting_line():
    zone = video.AnalysisZone(polygon=[(0, 0), (1, 0), (1, 1), (0, 1)],
        direction=(1, 0), counting_line=((.4, .2), (.6, .8)))

    assert zone.counting_line == ((.4, .2), (.6, .8))


def test_analysis_zone_rejects_degenerate_or_out_of_frame_counting_line():
    base = {"polygon": [(0, 0), (1, 0), (1, 1), (0, 1)], "direction": (0, 1)}

    for gate in (((.5, .5), (.5, .5)), ((-.1, .2), (.6, .8))):
        try:
            video.AnalysisZone(**base, counting_line=gate)
        except ValidationError:
            continue
        raise AssertionError("Invalid counting line should fail validation.")
