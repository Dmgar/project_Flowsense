import threading
import json
import sqlite3
import time
import urllib.error

from src.services.mobility_service import MobilityService


class ManifestResponse:
    def __init__(self, status=206, body=b"#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:10,\nsegment.ts\n"):
        self.status = status
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit):
        return self.body

    def geturl(self):
        return "https://wzmedia.dot.ca.gov/D7/CCTV-188.stream/playlist.m3u8"


def live_hls_opener(request, timeout):
    url = request.full_url
    if url.lower().split("?", 1)[0].endswith("playlist.m3u8"):
        return ManifestResponse(body=b"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=200000\nchunklist.m3u8\n")
    if url.lower().split("?", 1)[0].endswith(".m3u8"):
        return ManifestResponse(body=b"#EXTM3U\n#EXTINF:10,\nmedia.ts\n")
    return ManifestResponse(body=b"\x47\x40\x00\x10transport-stream-data")


def service_for(monkeypatch, opener):
    monkeypatch.setattr("src.services.mobility_service.urllib.request.urlopen", opener)
    service = MobilityService.__new__(MobilityService)
    service.cameras = {
        "caltrans-d7-cctv-1031": {
            "id": "caltrans-d7-cctv-1031",
            "provider": "Caltrans",
            "stream_url": "https://wzmedia.dot.ca.gov/D7/CCTV-188.stream/playlist.m3u8",
        }
    }
    service._video_health_cache = {}
    service._video_health_failures = {}
    service._video_health_lock = threading.Lock()
    service.db_path = None
    return service


def test_valid_partial_content_manifest_is_available_and_cached(monkeypatch):
    calls = []
    service = service_for(monkeypatch, lambda request, timeout: calls.append((request, timeout)) or live_hls_opener(request, timeout))

    result = service.video_health("caltrans-d7-cctv-1031")
    cached = service.video_health("caltrans-d7-cctv-1031")

    assert result["state"] == "available"
    assert result["http_status"] == 206
    assert result["playlist_http_status"] == 206
    assert result["segment_http_status"] == 206
    assert "video segment" in result["message"]
    assert cached == result
    assert len(calls) == 3
    assert calls[0][0].get_header("Range") == "bytes=0-4095"
    assert calls[1][0].get_header("Range") == "bytes=0-4095"
    assert calls[2][0].get_header("Range") == "bytes=0-1023"
    assert calls[0][1] == 6


def test_manifest_without_a_readable_media_segment_is_not_available(monkeypatch):
    def opener(request, timeout):
        if request.full_url.endswith("playlist.m3u8"):
            return ManifestResponse(body=b"#EXTM3U\n#EXTINF:10,\nmissing.ts\n")
        raise urllib.error.HTTPError(request.full_url, 404, "Not Found", {}, None)

    service = service_for(monkeypatch, opener)
    result = service.video_health("caltrans-d7-cctv-1031")

    assert result["state"] == "temporary_error"
    assert result["http_status"] == 404
    assert result["playlist_http_status"] == 206
    assert result["segment_http_status"] == 404
    assert "media segment" in result["message"]


def test_persistent_not_found_status_is_unavailable_and_cached(monkeypatch):
    def not_found(*_args, **_kwargs):
        raise urllib.error.HTTPError("https://wzmedia.dot.ca.gov/playlist.m3u8", 404, "Not Found", {}, None)

    service = service_for(monkeypatch, not_found)
    result = service.video_health("caltrans-d7-cctv-1031")

    assert result["state"] == "unavailable"
    assert result["http_status"] == 404
    assert "HTTP 404" in result["message"]
    assert service.video_health("caltrans-d7-cctv-1031") == result


def test_provider_without_a_current_stream_url_is_unavailable_without_network_retry(monkeypatch):
    service = service_for(monkeypatch, lambda *_args, **_kwargs: (_ for _ in ()).throw(
        AssertionError("A provider-confirmed missing stream must not be probed.")))
    camera = service.cameras["caltrans-d7-cctv-1031"]
    camera["provider_stream_available"] = False
    camera["provider_stream_checked_at"] = "checked-now"

    result = service.video_health(camera["id"])

    assert result == {"state": "unavailable", "http_status": None, "checked_at": "checked-now",
                      "message": "Caltrans currently publishes no streaming video URL for this camera."}


def test_health_from_a_previous_stream_url_is_stale_and_not_reused(monkeypatch):
    calls = []
    service = service_for(monkeypatch, lambda request, timeout: calls.append(request.full_url) or live_hls_opener(request, timeout))
    camera_id = "caltrans-d7-cctv-1031"
    old_url = service.cameras[camera_id]["stream_url"]
    new_url = "https://wzmedia.dot.ca.gov/D7/CCTV-189.stream/playlist.m3u8"
    service._video_health_cache[camera_id] = (time.monotonic(), {
        "state": "unavailable", "http_status": 404, "checked_at": "old-check", "source_url": old_url,
    }, 300)
    service.cameras[camera_id]["stream_url"] = new_url

    assert service._cached_video_health(camera_id)["state"] == "stale"
    result = service.video_health(camera_id)

    assert result["state"] == "available"
    assert result["source_url"] == new_url
    assert calls[0] == new_url
    assert all(new_url.split("/")[2] in url for url in calls)


def test_temporary_provider_failure_is_not_misclassified_as_permanent(monkeypatch):
    service = service_for(monkeypatch, lambda *_args, **_kwargs: (_ for _ in ()).throw(TimeoutError()))

    result = service.video_health("caltrans-d7-cctv-1031")

    assert result["state"] == "temporary_error"
    assert result["http_status"] is None


def test_repeated_temporary_failures_use_bounded_per_camera_backoff(monkeypatch):
    import src.services.mobility_service as mobility_module

    clock = [100.0]
    calls = []
    monkeypatch.setattr(mobility_module.time, "monotonic", lambda: clock[0])
    service = service_for(monkeypatch, lambda *_args, **_kwargs: calls.append(clock[0]) or (_ for _ in ()).throw(TimeoutError()))

    first = service.video_health("caltrans-d7-cctv-1031")
    assert first["state"] == "temporary_error"
    assert service._video_health_cache["caltrans-d7-cctv-1031"][2] == 30

    clock[0] += 31
    service.video_health("caltrans-d7-cctv-1031")
    assert service._video_health_cache["caltrans-d7-cctv-1031"][2] == 60

    clock[0] += 30
    service.video_health("caltrans-d7-cctv-1031")
    assert len(calls) == 2

    clock[0] += 31
    service.video_health("caltrans-d7-cctv-1031")
    assert service._video_health_cache["caltrans-d7-cctv-1031"][2] == 120
    assert len(calls) == 3


def test_only_catalogued_caltrans_hls_urls_are_probed(monkeypatch):
    service = service_for(monkeypatch, lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("must not probe")))
    service.cameras["operator-camera"] = {
        "id": "operator-camera", "provider": "Operator source",
        "stream_url": "https://example.com/live.m3u8",
    }

    result = service.video_health("operator-camera")

    assert result["state"] == "unchecked"
    assert result["http_status"] is None


def test_unknown_camera_is_rejected():
    service = MobilityService.__new__(MobilityService)
    service.cameras = {}
    service._video_health_cache = {}
    service._video_health_lock = threading.Lock()

    try:
        service.video_health("missing-camera")
    except KeyError as error:
        assert error.args == ("missing-camera",)
    else:
        raise AssertionError("Unknown cameras must not trigger an outbound request.")


def test_monitor_route_refuses_provider_confirmed_missing_video(monkeypatch):
    import asyncio
    from fastapi import HTTPException
    from src.api.routes import video as video_route

    monkeypatch.setattr(video_route.mobility_service, "cameras", {
        "caltrans-d7-cctv-320": {"id": "caltrans-d7-cctv-320", "provider": "Caltrans",
                                 "stream_url": "https://wzmedia.dot.ca.gov/D7/old/playlist.m3u8",
                                 "provider_stream_available": False},
    })
    monkeypatch.setattr(video_route.video_service, "monitor", lambda *_args: (_ for _ in ()).throw(
        AssertionError("A camera with no official video URL must not start a session.")))

    async def attempt():
        return await video_route.start_monitoring("caltrans-d7-cctv-320",
            video_route.MonitoringLease(client_id="quality-check-client"))

    try:
        asyncio.run(attempt())
    except HTTPException as error:
        assert error.status_code == 409
        assert "not currently publishing" in error.detail
    else:
        raise AssertionError("Provider-confirmed missing video must not open a stale stream.")


def test_health_is_saved_and_restored_from_the_existing_local_database(tmp_path, monkeypatch):
    service = service_for(monkeypatch, live_hls_opener)
    service.db_path = tmp_path / "mobility.sqlite3"
    with sqlite3.connect(service.db_path) as db:
        db.execute("CREATE TABLE camera_video_health (camera_id TEXT PRIMARY KEY, payload TEXT NOT NULL)")

    saved = service.video_health("caltrans-d7-cctv-1031")
    with sqlite3.connect(service.db_path) as db:
        payload = db.execute("SELECT payload FROM camera_video_health WHERE camera_id = ?",
                             ("caltrans-d7-cctv-1031",)).fetchone()[0]
    assert json.loads(payload) == saved

    restored = MobilityService.__new__(MobilityService)
    restored.cameras = service.cameras
    restored._video_health_lock = threading.Lock()
    restored._video_health_cache = {"caltrans-d7-cctv-1031": (0.0, saved, 0)}
    stale = restored._cached_video_health("caltrans-d7-cctv-1031")
    assert stale["state"] == "stale"
    assert stale["checked_at"] == saved["checked_at"]


def test_background_monitor_checks_sources_without_opening_a_video_session():
    service = MobilityService.__new__(MobilityService)
    service.cameras = {
        "caltrans-d7-cctv-1031": {"id": "caltrans-d7-cctv-1031", "provider": "Caltrans",
                                  "stream_url": "https://wzmedia.dot.ca.gov/feed/playlist.m3u8"},
        "operator-camera": {"id": "operator-camera", "provider": "Operator source",
                            "stream_url": "https://example.com/live.m3u8"},
        "out-of-service-camera": {"id": "out-of-service-camera", "provider": "Caltrans",
                                  "provider_in_service": False,
                                  "stream_url": "https://wzmedia.dot.ca.gov/feed/offline.m3u8"},
    }
    service._video_health_stop = threading.Event()
    service._video_health_thread = None
    service._registry_lock = threading.Lock()
    service.refresh_official_video_sources = lambda: {"matched": 1, "changed": 0, "without_video": 0}
    checked = threading.Event()
    visited = []
    def record(camera_id):
        visited.append(camera_id)
        checked.set()
        service._video_health_stop.set()
        return {"state": "available"}
    service.video_health = record

    service.start_video_health_monitor()
    assert checked.wait(timeout=2)
    service.stop_video_health_monitor()
    assert visited == ["caltrans-d7-cctv-1031"]


def test_background_monitor_checks_other_sources_while_one_health_probe_is_slow():
    service = MobilityService.__new__(MobilityService)
    service.cameras = {
        f"caltrans-{number}": {
            "id": f"caltrans-{number}", "provider": "Caltrans",
            "stream_url": f"https://wzmedia.dot.ca.gov/D7/{number}.stream/playlist.m3u8",
        }
        for number in (1002, 1031)
    }
    service._video_health_stop = threading.Event()
    service._video_health_thread = None
    service._registry_lock = threading.Lock()
    service.refresh_official_video_sources = lambda: {"matched": 2, "changed": 0, "without_video": 0}
    slow_started = threading.Event()
    release_slow = threading.Event()
    fast_checked = threading.Event()
    visited = []

    def record(camera_id):
        visited.append(camera_id)
        if camera_id == "caltrans-1002":
            slow_started.set()
            release_slow.wait(timeout=3)
        else:
            fast_checked.set()
            service._video_health_stop.set()
        return {"state": "available"}

    service.video_health = record
    service.start_video_health_monitor()
    assert slow_started.wait(timeout=2)
    assert fast_checked.wait(timeout=2)
    release_slow.set()
    service.stop_video_health_monitor()
    assert set(visited) == {"caltrans-1002", "caltrans-1031"}
