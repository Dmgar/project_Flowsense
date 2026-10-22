"""Public camera observations and durable, human-reviewed mobility cases."""
from __future__ import annotations

from collections import deque
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import threading
import time
import urllib.request
import urllib.error
from urllib.parse import urljoin, urlparse
import uuid

from src.core.config import settings
from src.services.camera_metadata import refresh_caltrans_video_sources


def now():
    return datetime.now(timezone.utc).isoformat()


def _read_hls_resource(url, byte_range, timeout=6):
    parsed = urlparse(url)
    if (parsed.scheme != "https" or not (parsed.hostname or "").lower().endswith(".dot.ca.gov")):
        raise ValueError("The HLS resource is outside the official Caltrans video domain.")
    request = urllib.request.Request(url, headers={
        "User-Agent": "FlowSense/1.0", "Range": byte_range})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        status = int(response.status)
        final_url = response.geturl() if hasattr(response, "geturl") else url
        if status not in (200, 206):
            return status, final_url, b""
        return status, final_url, response.read(4096 if "4095" in byte_range else 1024)


def _first_hls_child(manifest):
    lines = [line.strip() for line in manifest.splitlines() if line.strip()]
    for index, line in enumerate(lines):
        if line.startswith(("#EXT-X-STREAM-INF:", "#EXTINF:")):
            for child in lines[index + 1:]:
                if not child.startswith("#"):
                    return child
    return None


class MobilityService:
    def __init__(self):
        catalog = Path(__file__).resolve().parents[2] / "data/public_cameras_los_angeles.json"
        self.cameras = {item["id"]: item for item in json.loads(catalog.read_text(encoding="utf-8"))}
        self.route_metadata_path = Path(__file__).resolve().parents[2] / "data/caltrans_camera_route_metadata.json"
        self._route_metadata_mtime_ns = None
        self._frames = {}
        self._history = {}
        self._history_images = {}
        self._locks = {}
        self._detector = None
        self._detector_lock = threading.Lock()
        self._registry_lock = threading.Lock()
        self._video_health_cache = {}
        self._video_health_failures = {}
        self._video_health_lock = threading.Lock()
        self._video_health_stop = threading.Event()
        self._video_health_thread = None
        self.db_path = settings.DATA_PROCESSED_DIR / f"mobility_cases_{settings.CITY_PROFILE}.sqlite3"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.db_path)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS mobility_cases (id TEXT PRIMARY KEY, signal_id TEXT UNIQUE, payload TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS connected_cameras (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS camera_video_health (camera_id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            for payload, in db.execute("SELECT payload FROM connected_cameras"):
                item = json.loads(payload)
                self.cameras[item["id"]] = item
            for camera_id, payload in db.execute("SELECT camera_id, payload FROM camera_video_health"):
                try:
                    self._video_health_cache[camera_id] = (0.0, json.loads(payload), 0)
                except (TypeError, json.JSONDecodeError):
                    continue
        self.refresh_route_metadata()

    def refresh_route_metadata(self):
        """Apply newly published, exact-match route metadata without restarting the API."""
        try:
            modified = self.route_metadata_path.stat().st_mtime_ns
        except OSError:
            return 0
        with self._registry_lock:
            if modified == self._route_metadata_mtime_ns:
                return 0
            try:
                metadata = json.loads(self.route_metadata_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return 0
            from src.services.camera_metadata import enrich_caltrans_route_metadata
            enriched = enrich_caltrans_route_metadata(self.cameras, metadata)
            self._route_metadata_mtime_ns = modified
            return enriched

    def list_cameras(self, video_only=False):
        self.refresh_route_metadata()
        result = []
        for item in list(self.cameras.values()):
            if video_only and not item.get("stream_url"):
                continue
            captured = self._frames.get(item["id"])
            age = max(0, time.monotonic() - captured["fetched_at"]) if captured else None
            recent = age is not None and age <= item.get("refresh_seconds", 120) + 30
            status = ("provider_notice" if captured.get("possible_placeholder") else "online") if recent else "stale" if captured else "unverified"
            result.append({**item, "image_url": f"/api/v1/mobility/cameras/{item['id']}/snapshot",
                           "video_health": self._cached_video_health(item["id"]),
                           "status": status, "last_observed_at": captured.get("observed_at") if captured else None,
                           "last_source_status": ("provider_notice" if captured.get("possible_placeholder") else "image") if captured else None,
                           "observation_age_seconds": round(age) if age is not None else None,
                           "data_origin": "public_camera" if item.get("provider") == "Caltrans" else "connected_camera"})
        return result

    def _cached_video_health(self, camera_id):
        camera = self.cameras.get(camera_id, {})
        if camera.get("provider_stream_available") is False:
            return {"state": "unavailable", "http_status": None,
                    "checked_at": camera.get("provider_stream_checked_at"),
                    "message": "Caltrans currently publishes no streaming video URL for this camera."}
        with self._video_health_lock:
            cached = self._video_health_cache.get(camera_id)
            if not cached:
                return None
            age = time.monotonic() - cached[0]
            result = dict(cached[1])
            if result.get("source_url") != camera.get("stream_url"):
                result["state"] = "stale"
                result["message"] = "The camera source URL changed; a fresh video check is pending."
            elif age >= cached[2]:
                result["state"] = "stale"
                last_status = result.get("http_status")
                result["message"] = (f"The last HLS check returned HTTP {last_status}; a fresh check is pending."
                                      if last_status else "The last source check is stale; a new check is pending.")
            return result

    def video_health(self, camera_id):
        """Check one Caltrans HLS URL on demand without rewriting the catalog."""
        camera = self.cameras.get(camera_id)
        if not camera:
            raise KeyError(camera_id)
        if camera.get("provider_stream_available") is False:
            return {"state": "unavailable", "http_status": None,
                    "checked_at": camera.get("provider_stream_checked_at"),
                    "message": "Caltrans currently publishes no streaming video URL for this camera."}
        stream_url = camera.get("stream_url", "")
        parsed = urlparse(stream_url)
        if (camera.get("provider") != "Caltrans" or not stream_url
                or not parsed.path.lower().endswith(".m3u8")
                or not (parsed.hostname or "").lower().endswith(".dot.ca.gov")):
            return {"state": "unchecked", "http_status": None, "checked_at": None,
                    "message": "Live source checks are available for Caltrans HLS feeds."}

        instant = time.monotonic()
        with self._video_health_lock:
            cached = self._video_health_cache.get(camera_id)
            if (cached and cached[1].get("source_url") == stream_url
                    and cached[2] > 0 and instant - cached[0] < cached[2]):
                return dict(cached[1])
            if cached and cached[1].get("source_url") != stream_url:
                self._video_health_failures.pop(camera_id, None)

        state, http_status, message = "temporary_error", None, "The HLS source could not be checked."
        playlist_status = None
        segment_status = None
        stage = "playlist"
        try:
            playlist_status, playlist_url, body = _read_hls_resource(stream_url, "bytes=0-4095")
            http_status = playlist_status
            manifest = body.decode("utf-8", errors="replace").lstrip("\ufeff \r\n")
            if playlist_status not in (200, 206) or not manifest.startswith("#EXTM3U"):
                if playlist_status in (404, 410):
                    state, message = "unavailable", f"The HLS endpoint returned HTTP {playlist_status}."
                else:
                    message = f"The HLS playlist returned HTTP {playlist_status} or an invalid manifest."
            else:
                child_url = _first_hls_child(manifest)
                if child_url and child_url.lower().split("?", 1)[0].endswith(".m3u8"):
                    stage = "variant_playlist"
                    variant_status, variant_url, variant_body = _read_hls_resource(
                        urljoin(playlist_url, child_url), "bytes=0-4095")
                    playlist_status = variant_status
                    http_status = variant_status
                    variant_manifest = variant_body.decode("utf-8", errors="replace").lstrip("\ufeff \r\n")
                    if variant_status not in (200, 206) or not variant_manifest.startswith("#EXTM3U"):
                        message = f"The HLS variant playlist could not be read (HTTP {variant_status})."
                        child_url = None
                    else:
                        child_url = _first_hls_child(variant_manifest)
                        playlist_url = variant_url
                if child_url and not child_url.lower().split("?", 1)[0].endswith(".m3u8"):
                    stage = "media_segment"
                    segment_status, _segment_url, segment_body = _read_hls_resource(
                        urljoin(playlist_url, child_url), "bytes=0-1023")
                    http_status = segment_status
                    if segment_status in (200, 206) and segment_body:
                        state, message = "available", "The HLS playlist and a live video segment both responded."
                    else:
                        message = f"The HLS playlist is readable, but its video segment check failed (HTTP {segment_status})."
                elif child_url is None:
                    message = "The HLS playlist is readable, but it contains no playable video segment."
        except urllib.error.HTTPError as error:
            http_status = int(error.code)
            if stage == "playlist" and http_status in (404, 410):
                state, message = "unavailable", f"The HLS endpoint returned HTTP {http_status}."
            else:
                state, message = "temporary_error", f"The HLS {stage.replace('_', ' ')} returned HTTP {http_status}."
            if stage != "playlist":
                segment_status = http_status
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            state, message = "temporary_error", f"The HLS {stage.replace('_', ' ')} timed out or could not be verified."

        # A complete sequential sweep takes about a minute; keep a result fresh
        # long enough for the entire 71-camera catalog to finish a round.
        if state == "temporary_error":
            with self._video_health_lock:
                failures = self._video_health_failures.get(camera_id, 0) + 1
                self._video_health_failures[camera_id] = failures
            cache_seconds = min(300, 30 * (2 ** min(failures - 1, 4)))
        else:
            with self._video_health_lock:
                self._video_health_failures.pop(camera_id, None)
            cache_seconds = 300 if state == "unavailable" else 600
        result = {"state": state, "http_status": http_status, "checked_at": now(),
                  "source_url": stream_url,
                  "playlist_http_status": playlist_status,
                  "segment_http_status": segment_status,
                  "message": message}
        with self._video_health_lock:
            self._video_health_cache[camera_id] = (time.monotonic(), result, cache_seconds)
        if self.db_path is not None:
            try:
                with closing(sqlite3.connect(self.db_path, timeout=5)) as db, db:
                    db.execute("INSERT INTO camera_video_health(camera_id, payload) VALUES (?, ?) "
                               "ON CONFLICT(camera_id) DO UPDATE SET payload=excluded.payload",
                               (camera_id, json.dumps(result)))
            except sqlite3.Error:
                # Health remains available in memory; a transient database issue must not fail the request.
                pass
        return dict(result)

    def refresh_official_video_sources(self):
        """Refresh Caltrans stream links without replacing catalog or evidence data."""
        from src.services.camera_metadata import _D7_CCTV_SOURCE
        try:
            with urllib.request.urlopen(_D7_CCTV_SOURCE, timeout=20) as response:
                raw = response.read(25_000_001)
            if len(raw) > 25_000_000:
                return {"matched": 0, "changed": 0, "without_video": 0, "error": "feed_too_large"}
            payload = json.loads(raw.decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError):
            return {"matched": 0, "changed": 0, "without_video": 0, "error": "feed_unavailable"}
        checked_at = now()
        with self._registry_lock:
            result = refresh_caltrans_video_sources(self.cameras, payload, checked_at)
        result["checked_at"] = checked_at
        return result

    def start_video_health_monitor(self):
        """Refresh public Caltrans source health gradually, without opening video sessions."""
        if self._video_health_thread and self._video_health_thread.is_alive():
            return
        self._video_health_stop.clear()
        self._video_health_thread = threading.Thread(
            target=self._refresh_video_health_loop, name="camera-health-monitor", daemon=True)
        self._video_health_thread.start()

    def stop_video_health_monitor(self):
        self._video_health_stop.set()
        thread = self._video_health_thread
        if thread and thread.is_alive():
            thread.join(timeout=12)
        self._video_health_thread = None

    def _refresh_video_health_loop(self):
        from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

        camera_ids = []
        index = 0
        next_catalog_refresh = 0.0
        pending = set()
        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="camera-health") as executor:
            while not self._video_health_stop.is_set():
                instant = time.monotonic()
                if instant >= next_catalog_refresh and not pending:
                    self.refresh_official_video_sources()
                    with self._registry_lock:
                        camera_ids = [camera_id for camera_id, camera in self.cameras.items()
                                      if camera.get("provider") == "Caltrans"
                                      and camera.get("provider_in_service") is not False
                                      and camera.get("provider_stream_available") is not False
                                      and camera.get("stream_url", "").lower().split("?", 1)[0].endswith(".m3u8")]
                    index = 0
                    next_catalog_refresh = time.monotonic() + 1800
                if not camera_ids:
                    self._video_health_stop.wait(5)
                    continue

                # A slow HLS endpoint must not hold up health checks for every other camera.
                while index < len(camera_ids) and len(pending) < 4 and not self._video_health_stop.is_set():
                    camera_id = camera_ids[index]
                    index += 1
                    pending.add(executor.submit(self.video_health, camera_id))
                    if len(pending) < 4 and index < len(camera_ids):
                        self._video_health_stop.wait(0.25)
                if index >= len(camera_ids) and not pending:
                    # Start another cache-refresh pass after a short, bounded pause.
                    index = 0
                    self._video_health_stop.wait(30)
                    continue
                completed, pending = wait(pending, timeout=0.25, return_when=FIRST_COMPLETED)
                for future in completed:
                    try:
                        future.result()
                    except Exception:
                        # Keep the monitor alive; a later camera or cycle can recover.
                        pass

    def connect(self, payload):
        source = payload["source"]
        parsed = urlparse(source)
        if not source.isdigit() and parsed.scheme not in {"http", "https", "rtsp"}:
            raise ValueError("Use an HTTP(S) video stream, an RTSP camera or a webcam index.")
        if parsed.username or parsed.password:
            raise ValueError("Do not include credentials in the camera URL.")
        if parsed.path.lower().endswith((".jpg", ".jpeg", ".png", ".gif", ".webp")):
            raise ValueError("Still images are not supported. Connect a continuous video source.")
        from src.services.video_service import probe_video
        probe_video(source)
        camera_id = "connected-" + uuid.uuid4().hex[:10]
        item = {"id": camera_id, "name": payload["name"], "district": "Connected source",
                "lat": payload["lat"], "lng": payload["lng"], "image_url": source,
                "stream_url": source, "source_url": source if parsed.scheme in {"http", "https"} else "",
                "provider": "Operator source", "refresh_seconds": 20}
        # Save only a source that was verified to yield consecutive video frames.
        self.cameras[camera_id] = item
        try:
            with closing(sqlite3.connect(self.db_path)) as db, db:
                db.execute("INSERT INTO connected_cameras VALUES (?, ?)", (camera_id, json.dumps(item)))
        except Exception:
            self.cameras.pop(camera_id, None)
            raise
        return next(item for item in self.list_cameras() if item["id"] == camera_id)

    def capture(self, camera_id):
        import cv2
        import numpy as np
        if camera_id not in self.cameras:
            raise KeyError(camera_id)
        with self._registry_lock:
            lock = self._locks.setdefault(camera_id, threading.Lock())
        with lock:
            camera = self.cameras[camera_id]
            cached = self._frames.get(camera_id)
            if cached and time.monotonic() - cached["fetched_at"] < camera.get("refresh_seconds", 120):
                return cached
            source = camera["image_url"]
            if source.startswith(("https://", "http://")):
                request = urllib.request.Request(source, headers={"User-Agent": "FlowSense/1.0"})
                with urllib.request.urlopen(request, timeout=12) as response:
                    image = response.read(10_000_001)
                if len(image) > 10_000_000:
                    raise ValueError("The image exceeds the allowed size.")
                frame = cv2.imdecode(np.frombuffer(image, dtype=np.uint8), cv2.IMREAD_COLOR)
            else:
                cap = (cv2.VideoCapture(int(source)) if source.isdigit() else
                       cv2.VideoCapture(source, cv2.CAP_FFMPEG,
                                        [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 10000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 10000]))
                try:
                    success, frame = cap.read()
                    if not success:
                        frame = None
                finally:
                    cap.release()
            if frame is None:
                raise ValueError("The source did not return a valid image.")
            _, encoded = cv2.imencode(".jpg", frame)
            captured = {"image": encoded.tobytes(), "frame": frame, "observed_at": now(),
                        "fetched_at": time.monotonic(), "detections": None,
                        "possible_placeholder": camera.get("provider") == "Caltrans" and float(np.mean(np.all(frame > 235, axis=2))) > .70,
                        "hash": hashlib.sha256(encoded.tobytes()).hexdigest()[:16]}
            self._frames[camera_id] = captured
            return captured

    def observe(self, camera_id):
        captured = self.capture(camera_id)
        frame = captured["frame"]
        height, width = frame.shape[:2]
        detection_error = None
        with self._detector_lock:
            if captured.get("possible_placeholder"):
                detection_error = "El proveedor muestra un posible aviso de indisponibilidad. No se calculan conteos sobre este fotograma."
            elif captured["detections"] is None:
                try:
                    from src.perception.detector import VehicleDetector
                    if not settings.PERCEPTION_MODEL_PATH.is_file():
                        raise ValueError("Detection model not installed.")
                    if self._detector is None:
                        self._detector = VehicleDetector(str(settings.PERCEPTION_MODEL_PATH),
                            confidence_threshold=0.35,
                            class_names={0: "pedestrian", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"})
                    captured["detections"] = [
                        {"className": item.class_name, "confidence": item.confidence,
                         "bbox": {"x": item.bbox[0] / width, "y": item.bbox[1] / height,
                                  "width": item.bbox[2] / width, "height": item.bbox[3] / height}}
                        for item in self._detector.detect(frame)]
                except Exception:
                    detection_error = "Inference unavailable. The public image remains visible."
        counts = {name: 0 for name in ["car", "motorcycle", "bus", "truck", "bicycle", "pedestrian"]}
        for item in captured["detections"] or []:
            counts[item["className"]] += 1
        result = {"camera_id": camera_id, "observed_at": captured["observed_at"],
                  "source_status": "provider_notice" if captured.get("possible_placeholder") else "image",
                  "provider_frame_time": None, "frame_id": captured["hash"],
                  "width": width, "height": height, "detections": captured["detections"] or [],
                  "counts": counts if captured["detections"] is not None else None,
                  "inference_status": "ready" if captured["detections"] is not None else "unavailable",
                  "inference_error": detection_error, "data_origin": "opencv_snapshot",
                  "speed_kmh": None, "lane_occupancy": None,
                  "note": "Instantaneous count. This is not an hourly traffic count or calibrated speed."}
        history = self._history.setdefault(camera_id, deque(maxlen=60))
        if not history or history[-1]["observed_at"] != result["observed_at"]:
            history.append(result)
            self._history_images.setdefault(camera_id, deque(maxlen=60)).append((result["frame_id"], captured["image"]))
        return result

    def historical_image(self, camera_id, frame_id):
        for key, image in self._history_images.get(camera_id, []):
            if key == frame_id:
                return image
        raise KeyError(frame_id)

    def history(self, camera_id):
        return list(self._history.get(camera_id, []))

    def cases(self):
        with closing(sqlite3.connect(self.db_path)) as db:
            return sorted([json.loads(row[0]) for row in db.execute("SELECT payload FROM mobility_cases")],
                          key=lambda item: item["updated_at"], reverse=True)

    def create_case(self, payload):
        with closing(sqlite3.connect(self.db_path, timeout=10)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT payload FROM mobility_cases WHERE signal_id=?", (payload["signal_id"],)).fetchone()
            if existing:
                return json.loads(existing[0])
            timestamp = now()
            item = {"id": "FS-" + uuid.uuid4().hex[:8].upper(), **payload, "status": "new",
                    "created_at": timestamp, "updated_at": timestamp,
                    "audit": [{"at": timestamp, "action": "new", "note": payload.get("note", ""), "owner": payload["owner"]}]}
            db.execute("INSERT INTO mobility_cases VALUES (?, ?, ?)", (item["id"], item["signal_id"], json.dumps(item)))
            return item

    def review_case(self, case_id, payload):
        allowed = {"new": {"assigned", "under_review", "dismissed"},
                   "assigned": {"under_review", "confirmed", "dismissed"},
                   "under_review": {"assigned", "confirmed", "dismissed"},
                   "confirmed": {"resolved"}, "resolved": set(), "dismissed": set()}
        with closing(sqlite3.connect(self.db_path, timeout=10)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT payload FROM mobility_cases WHERE id=?", (case_id,)).fetchone()
            if not row:
                raise KeyError(case_id)
            item = json.loads(row[0])
            target = payload["status"]
            if target not in allowed[item["status"]]:
                raise ValueError("This transition requires review and confirmation first; closed cases cannot be modified.")
            item.update(status=target, owner=payload["owner"], updated_at=now())
            item["audit"].append({"at": item["updated_at"], "action": target,
                                  "note": payload["note"], "owner": payload["owner"]})
            db.execute("UPDATE mobility_cases SET payload=? WHERE id=?", (json.dumps(item), case_id))
            return item


mobility_service = MobilityService()
