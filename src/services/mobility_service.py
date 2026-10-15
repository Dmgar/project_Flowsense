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
from urllib.parse import urlparse
import uuid

from src.core.config import settings


def now():
    return datetime.now(timezone.utc).isoformat()


class MobilityService:
    def __init__(self):
        catalog = Path(__file__).resolve().parents[2] / "data/public_cameras_los_angeles.json"
        self.cameras = {item["id"]: item for item in json.loads(catalog.read_text(encoding="utf-8"))}
        self._frames = {}
        self._history = {}
        self._history_images = {}
        self._locks = {}
        self._detector = None
        self._detector_lock = threading.Lock()
        self._registry_lock = threading.Lock()
        self.db_path = settings.DATA_PROCESSED_DIR / f"mobility_cases_{settings.CITY_PROFILE}.sqlite3"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.db_path)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS mobility_cases (id TEXT PRIMARY KEY, signal_id TEXT UNIQUE, payload TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS connected_cameras (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            for payload, in db.execute("SELECT payload FROM connected_cameras"):
                item = json.loads(payload)
                self.cameras[item["id"]] = item

    def list_cameras(self):
        result = []
        for item in list(self.cameras.values()):
            captured = self._frames.get(item["id"])
            age = max(0, time.monotonic() - captured["fetched_at"]) if captured else None
            recent = age is not None and age <= item.get("refresh_seconds", 120) + 30
            status = ("provider_notice" if captured.get("possible_placeholder") else "online") if recent else "stale" if captured else "unverified"
            result.append({**item, "image_url": f"/api/v1/mobility/cameras/{item['id']}/snapshot",
                           "status": status, "last_observed_at": captured.get("observed_at") if captured else None,
                           "last_source_status": ("provider_notice" if captured.get("possible_placeholder") else "image") if captured else None,
                           "observation_age_seconds": round(age) if age is not None else None,
                           "data_origin": "public_camera" if item.get("provider") == "Caltrans" else "connected_camera"})
        return result

    def connect(self, payload):
        source = payload["source"]
        parsed = urlparse(source)
        if not source.isdigit() and parsed.scheme not in {"http", "https", "rtsp"}:
            raise ValueError("Usa una imagen HTTP(S), una cámara RTSP o el índice de webcam.")
        if parsed.username or parsed.password:
            raise ValueError("No incluyas credenciales en la URL de la cámara.")
        camera_id = "connected-" + uuid.uuid4().hex[:10]
        item = {"id": camera_id, "name": payload["name"], "district": "Fuente conectada",
                "lat": payload["lat"], "lng": payload["lng"], "image_url": source,
                "stream_url": "", "source_url": source if parsed.scheme in {"http", "https"} else "",
                "provider": "Fuente del operador", "refresh_seconds": 20}
        # A saved connection must actually yield a decodable frame.
        self.cameras[camera_id] = item
        try:
            self.capture(camera_id)
        except Exception:
            self.cameras.pop(camera_id, None)
            raise ValueError("No se pudo leer una imagen de esa fuente. Revisa URL y disponibilidad.") from None
        with closing(sqlite3.connect(self.db_path)) as db, db:
            db.execute("INSERT INTO connected_cameras VALUES (?, ?)", (camera_id, json.dumps(item)))
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
                    raise ValueError("La imagen supera el tamaño permitido.")
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
                raise ValueError("La fuente no devolvió una imagen válida.")
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
                        raise ValueError("Modelo de detección no instalado.")
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
                    detection_error = "Inferencia no disponible. La imagen pública sigue siendo visible."
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
                  "note": "Conteo instantáneo. No es aforo horario ni velocidad calibrada."}
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
                raise ValueError("La transición requiere revisar y confirmar primero; los casos cerrados no se modifican.")
            item.update(status=target, owner=payload["owner"], updated_at=now())
            item["audit"].append({"at": item["updated_at"], "action": target,
                                  "note": payload["note"], "owner": payload["owner"]})
            db.execute("UPDATE mobility_cases SET payload=? WHERE id=?", (json.dumps(item), case_id))
            return item


mobility_service = MobilityService()
