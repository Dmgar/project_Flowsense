"""Bounded, shared camera capture, inference and annotated WebRTC delivery.

Capture and inference run on separate threads. Only the latest input, detection
and output are retained; slow viewers cannot queue seconds of old video.
"""
from __future__ import annotations

import asyncio
from collections import deque
from contextlib import nullcontext
from datetime import datetime, timezone, timedelta
from fractions import Fraction
import logging
import os
from pathlib import Path
import threading
import time
import uuid

import cv2
import numpy as np
from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
from aiortc.mediastreams import MediaStreamError
from av import VideoFrame

from src.core.config import settings
from src.perception.detector import VehicleDetector
from src.perception.traffic_detector import TrafficDetector, DetectionBatch, detect_low_light, is_low_light, merge_detections, reject_headlight_fragments
from src.perception.road_tracking import ROAD_CLASSES, RoadTracker, in_road_zone
from src.services.detection_store import (DetectionStore, EvidenceRecorder,
    EVIDENCE_FRAME_POLICY_VERSION, VIDEO_CAPACITY_SCAN_VERSION)
from src.services.camera_metadata import CAMERA_METADATA_POLICY_VERSION, CAMERA_SOURCE_CATALOG_POLICY_VERSION

logger = logging.getLogger("flowsense.video")
LOW_LIGHT_TRACK_CONFIDENCE = .10
LOW_LIGHT_OBSERVATION_CONFIDENCE = .10
CAMERA_DETECTION_POLICY_VERSION = 3
LIVE_LOW_LIGHT_CANDIDATE_OVERLAY_POLICY_VERSION = 1
LOW_LIGHT_DETAIL_ENHANCEMENT_POLICY_VERSION = 1
CAMERA_HEALTH_MONITOR_POLICY_VERSION = 3
ROAD_CORRELATION_PERFORMANCE_POLICY_VERSION = 2
ROAD_CORRELATION_EXPLAINABILITY_POLICY_VERSION = 1
RESTART_DRAIN_VERSION = 1
EVIDENCE_PAUSE_ORDER_VERSION = 1
TRACK_TIMING_POLICY_VERSION = 1
MONITOR_LEASE_SECONDS = 120
MAX_LIVE_RECONNECT_DELAY_SECONDS = 30
HIGH_RES_MIN_FREE_MEMORY_BYTES = 2_000_000_000


def available_system_memory_bytes():
    """Return available physical memory without requiring an extra package."""
    try:
        if os.name == "nt":
            import ctypes

            class MemoryStatus(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

            status = MemoryStatus()
            status.dwLength = ctypes.sizeof(status)
            return int(status.ullAvailPhys) if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)) else None
        page_size = os.sysconf("SC_PAGE_SIZE")
        available_pages = os.sysconf("SC_AVPHYS_PAGES")
        return int(page_size * available_pages)
    except (AttributeError, OSError, TypeError, ValueError):
        return None


def has_high_res_memory_headroom(available_bytes):
    """Skip supplemental high-resolution inference unless 2 GB remains free."""
    return isinstance(available_bytes, int) and available_bytes >= HIGH_RES_MIN_FREE_MEMORY_BYTES


def supplemental_detail_status(profile, zone_enabled, provider, active_sessions,
                                available_bytes, model_available):
    """Explain why the optional small-vehicle detail pass is or is not eligible."""
    if profile != "low_light":
        return None
    if not zone_enabled:
        return "road_zone_required"
    if not model_available:
        return "model_unavailable"
    if provider != "CUDAExecutionProvider":
        return "cuda_required"
    if active_sessions > 1:
        return "multiple_sessions"
    if not has_high_res_memory_headroom(available_bytes):
        return "memory_limited"
    return "eligible"


def live_reconnect_delay_seconds(attempt):
    """Back off repeated public-stream opens without giving up the live session."""
    return min(MAX_LIVE_RECONNECT_DELAY_SECONDS, 2 ** max(0, min(int(attempt) - 1, 5)))


def summarize_detection_window(history, instant, generation, window_seconds=2.0):
    """Summarize recent inference evidence so diagnostics do not overreact to one frame."""
    recent = [item[6] for item in history
              if len(item) > 6 and item[5] == generation
              and 0 <= instant - item[1] <= window_seconds]
    outside_classes = {}
    for item in recent:
        for label, count in item.get("outside_zone_classes", {}).items():
            outside_classes[label] = outside_classes.get(label, 0) + count
    return {
        "window_seconds": window_seconds,
        "window_frames": len(recent),
        "raw_candidate_frames": sum(item.get("raw_candidates", 0) > 0 for item in recent),
        "road_candidate_frames": sum(item.get("road_candidates", 0) > 0 for item in recent),
        "road_candidate_observations": sum(item.get("road_candidates", 0) for item in recent),
        "road_candidate_boxes": (recent[-1].get("road_candidate_boxes", [])[:12] if recent else []),
        "outside_zone_observations": sum(item.get("outside_zone_candidates", 0) for item in recent),
        "outside_zone_classes": outside_classes,
        "outside_zone_boxes": (recent[-1].get("outside_zone_boxes", [])[:12] if recent else []),
        "directional_outside_tracks": (recent[-1].get("directional_outside_tracks", [])[:12] if recent else []),
        "inbound_tracks_peak": max((item.get("inbound_tracks", 0) for item in recent), default=0),
    }


def directional_outside_tracks(tracks, frame_shape, zone):
    """Return direction-matched audit tracks outside the production zone.

    These temporary tracks help an operator diagnose a boundary that clips the
    approaching carriageway. They never enter production counts or storage.
    """
    if not zone.get("enabled"):
        return []
    result = []
    for track in tracks:
        if track.get("direction") != "approaching" or track.get("observation_hits", 0) < 2:
            continue
        if in_road_zone(track["bbox"], frame_shape, zone):
            continue
        result.append({key: track[key] for key in
                       ("bbox", "class", "candidate_class", "confidence", "observation_hits", "trail")})
    return result
CLASSES = {0: "pedestrian", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
BDD_CLASSES = {0: "pedestrian", 1: "rider", 2: "car", 3: "truck", 4: "bus", 6: "motorcycle", 7: "bicycle"}
COLORS = {"car": (110, 230, 100), "truck": (255, 170, 80), "bus": (70, 200, 255),
          "motorcycle": (240, 130, 220), "bicycle": (220, 220, 80), "pedestrian": (120, 180, 255),
          "rider": (255, 145, 80), "vehicle": (220, 220, 220)}
PROVISIONAL_COLOR = (48, 183, 255)


def traffic_motion_metrics(movement):
    """Summarize measured track motion without treating missing motion as zero."""
    values = [float(value) for value in movement if np.isfinite(value)]
    return {
        "slow_fraction": sum(value < .25 for value in values) / len(values) if values else None,
        "median_motion": float(np.median(values)) if values else None,
        "movement_sample_count": len(values),
    }


def draw_dashed_rectangle(image, bbox, color, thickness=2, dash=8, gap=5):
    """Draw a clearly provisional box without making it look confirmed."""
    x, y, width, height = (int(value) for value in bbox)
    step = dash + gap
    for offset in range(0, max(width, height), step):
        end_x, end_y = min(width, offset + dash), min(height, offset + dash)
        if offset < width:
            cv2.line(image, (x + offset, y), (x + end_x, y), color, thickness, cv2.LINE_AA)
            cv2.line(image, (x + offset, y + height), (x + end_x, y + height), color, thickness, cv2.LINE_AA)
        if offset < height:
            cv2.line(image, (x, y + offset), (x, y + end_y), color, thickness, cv2.LINE_AA)
            cv2.line(image, (x + width, y + offset), (x + width, y + end_y), color, thickness, cv2.LINE_AA)


def open_capture(source):
    if str(source).isdigit():
        return cv2.VideoCapture(int(source))
    return cv2.VideoCapture(str(source), cv2.CAP_FFMPEG,
                           [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 8000,
                            cv2.CAP_PROP_READ_TIMEOUT_MSEC, 15000])


def probe_video(source):
    """Reject still-image endpoints, not just missing URLs or bad MIME types."""
    cap = open_capture(source)
    try:
        if not cap.isOpened():
            raise ValueError("Could not open this video source.")
        positions = []
        for _ in range(3):
            ok, frame = cap.read()
            if not ok or frame is None:
                raise ValueError("A continuous video source is required. Still images are not supported.")
            positions.append(cap.get(cv2.CAP_PROP_POS_MSEC))
        if not str(source).isdigit() and len(set(positions)) == 1 and cap.get(cv2.CAP_PROP_FRAME_COUNT) == 1:
            raise ValueError("A continuous video source is required. Still images are not supported.")
    finally:
        cap.release()


def project_boxes(boxes, previous_gray, gray, scale, age_seconds=0, allow_prediction=True, strict_flow=False):
    """Track points from the actual detection image to the displayed image."""
    if not boxes:
        return []
    points, groups = [], []
    for box in boxes:
        x, y, w, h = box["bbox"]
        left, top = max(0, int(x * scale)), max(0, int(y * scale))
        right, bottom = min(previous_gray.shape[1], int((x + w) * scale)), min(previous_gray.shape[0], int((y + h) * scale))
        roi = previous_gray[top:bottom, left:right]
        features = cv2.goodFeaturesToTrack(roi, maxCorners=12, qualityLevel=.01, minDistance=3) if min(roi.shape, default=0) >= 3 else None
        selected = [(float(point[0][0]) + left, float(point[0][1]) + top) for point in features] if features is not None else []
        # A lack of texture is not evidence that the detected object disappeared.
        groups.append((len(points), len(selected)))
        points.extend(selected)
    moved = valid = None
    if points:
        origin = np.array(points, dtype=np.float32).reshape(-1, 1, 2)
        moved, valid, _ = cv2.calcOpticalFlowPyrLK(previous_gray, gray, origin, None,
                                                 winSize=(21, 21), maxLevel=3)
        if moved is not None:
            returned, backward_valid, _ = cv2.calcOpticalFlowPyrLK(gray, previous_gray, moved, None,
                                                                 winSize=(21, 21), maxLevel=3)
            if returned is None:
                valid[:] = 0
            else:
                consistent = np.linalg.norm((returned - origin).reshape(-1, 2), axis=1) <= 1
                valid = (valid.reshape(-1).astype(bool) & backward_valid.reshape(-1).astype(bool) & consistent).astype(np.uint8)
    result = []
    for index, box in enumerate(boxes):
        start, count = groups[index]
        mask = valid[start:start + count].reshape(-1).astype(bool) if moved is not None and count else np.array([], dtype=bool)
        if mask.any():
            shifts = (moved[start:start + count] - origin[start:start + count]).reshape(-1, 2)[mask]
            median = np.median(shifts, axis=0)
            if strict_flow and (len(shifts) < 3 or np.mean(np.linalg.norm(shifts-median,axis=1) < 3) < .6):
                continue
            delta = median / scale
            if not np.isfinite(delta).all():
                continue
            if strict_flow:
                expected = np.asarray(box.get("velocity",(0,0))) * age_seconds
                if np.linalg.norm(delta) > 1.5*np.hypot(*box["bbox"][2:]):
                    continue
                if np.linalg.norm(expected) > 5 and (np.linalg.norm(delta) < .2*np.linalg.norm(expected) or np.dot(delta,expected) < .5*np.linalg.norm(delta)*np.linalg.norm(expected)):
                    continue
        elif age_seconds <= .5 and allow_prediction:
            vx, vy = box.get("velocity", (0, 0))
            delta = (vx * age_seconds, vy * age_seconds)
        else:
            continue
        x, y, w, h = box["bbox"]
        result.append({**box, "bbox": (int(x + delta[0]), int(y + delta[1]), w, h), "predicted": True})
    return result


def aligned_boxes(history, sample, gray, scale):
    """Interpolate between actual detections on both sides of displayed video.

    Never invent a long trajectory after a model miss. An unbracketed detection
    is eligible for short optical-flow projection for at most 120 milliseconds.
    """
    sequence, instant, _, generation = sample
    observations = [item for item in history if item[5] == generation]
    past = {}
    for item in observations:
        if item[1] <= instant:
            for box in item[2]:
                past[box["id"]] = (item, box)
    result = []
    for track_id, (left, box) in past.items():
        right = next(((item, candidate) for item in observations if item[1] > instant
                      for candidate in item[2] if candidate["id"] == track_id and candidate["class"] == box["class"]), None)
        if right and 0 < right[0][1] - left[1] <= .8:
            item, target = right
            left_center = np.array((box["bbox"][0] + box["bbox"][2] / 2, box["bbox"][1] + box["bbox"][3] / 2))
            right_center = np.array((target["bbox"][0] + target["bbox"][2] / 2, target["bbox"][1] + target["bbox"][3] / 2))
            # Do not bridge a long jump between two different cars on the same
            # lane. Conservative association is preferable to an empty-road box.
            if np.linalg.norm(right_center - left_center) > max(12, np.hypot(*box["bbox"][2:])):
                continue
            fraction = (instant - left[1]) / (item[1] - left[1])
            bbox = tuple(round(a + (b - a) * fraction) for a, b in zip(box["bbox"], target["bbox"]))
            result.append({**box, "bbox": bbox, "confidence": min(box["confidence"], target["confidence"]), "predicted": True})
        elif 0 <= instant - left[1] <= (.5 if box.get("observation_hits",0) >= 3 else .25):
            if left[0] == sequence:
                result.append(box)
            else:
                prediction_horizon = .20 if box.get("observation_hits", 0) >= 3 and box.get("track_confidence", 0) >= .3 else .12
                result.extend(project_boxes([box], left[3], gray, scale, instant - left[1],
                                            allow_prediction=instant - left[1] <= prediction_horizon,
                                            strict_flow=instant-left[1] > .25))
    return result


def confirmed_boxes(boxes, history, instant, generation):
    """Start from a stronger hit; weaker hits need repeated observations.

    Interpolation and optical flow do not count as a second observation.
    """
    observations = {}
    for item in history:
        if item[5] != generation or abs(item[1] - instant) > .8:
            continue
        for box in item[2]:
            # Class consensus may upgrade the same low-light track from
            # provisional "vehicle" to "car". Confirmation belongs to the
            # tracker identity and distinct detector frames, not the label.
            key = box["id"]
            observations.setdefault(key, set()).add(item[0])
    return [box for box in boxes if (
        len(observations.get(box["id"], ())) >= 2
        if box.get("low_light") else
        box.get("track_confidence", box.get("confidence", 0)) >= .30
        or len(observations.get(box["id"], ())) >= 2
    )]


def unique_render_boxes(boxes, provisional_boxes):
    """Suppress duplicate overlapping road boxes across both render paths.

    Weak low-light candidates are collected separately from confirmed boxes.
    Running NMS on each list independently lets a provisional truck candidate
    be painted over the confirmed car box for the same physical vehicle.
    Keep the strongest single road box while preserving people and riders.
    This only affects the live overlay; saved track observations remain intact.
    """
    stable_vehicles = [box for box in boxes
                       if box.get("class_status") == "stable"
                       and box["class"] in ROAD_CLASSES]
    unshadowed = []
    for candidate in provisional_boxes:
        x, y, width, height = candidate["bbox"]
        area = max(1, width * height)
        shadowed = False
        for stable in stable_vehicles:
            sx, sy, sw, sh = stable["bbox"]
            intersection = max(0, min(x + width, sx + sw) - max(x, sx)) * max(
                0, min(y + height, sy + sh) - max(y, sy)
            )
            stable_area = max(1, sw * sh)
            contact_aligned = (
                abs((x + width / 2) - (sx + sw / 2)) <= .55 * min(width, sw)
                and abs((y + height) - (sy + sh)) <= .45 * min(height, sh)
            )
            if intersection / min(area, stable_area) >= .40 and contact_aligned:
                shadowed = True
                break
        if not shadowed:
            unshadowed.append(candidate)
    provisional_boxes = unshadowed
    provisional_ids = {box["id"] for box in provisional_boxes}
    combined = boxes + provisional_boxes
    unique = []
    for people in (False, True):
        group = [box for box in combined
                 if (box["class"] in {"pedestrian", "rider"}) == people]
        if not group:
            continue
        scores = [
            box.get("track_confidence", box["confidence"])
            + (0 if box.get("predicted") else 1)
            + (.05 if box.get("class_status") == "stable" else 0)
            for box in group
        ]
        keep = cv2.dnn.NMSBoxes([box["bbox"] for box in group], scores, 0, .6)
        unique.extend(group[int(index)] for index in np.asarray(keep).reshape(-1))
    kept_ids = {box["id"] for box in unique}
    return ([box for box in unique if box["id"] not in provisional_ids],
            [box for box in unique if box["id"] in provisional_ids])


def detection_overlay_label(box):
    """Keep provisional road classes visibly distinct from confirmed labels."""
    kind = box["class"]
    if kind == "vehicle":
        candidate = box.get("candidate_class")
        label = f"{candidate.title()}?" if candidate in ROAD_CLASSES else "Vehicle"
    else:
        label = kind.title()
    if box.get("direction_status") == "checking":
        label = f"Checking {label}"
    if box.get("bbox", (0, 0, 0, 0))[2] >= 40:
        label += f" #{box['id']}"
    return label


def detection_overlay_text(box, confidence, candidate=False, compact=False):
    """Keep object confidence separate from the vehicle's provisional class."""
    label = detection_overlay_label(box)
    if candidate:
        label = f"{label} · {round(confidence * 100)}%" if compact else f"Candidate {label} · detection {round(confidence * 100)}%"
    elif compact:
        label = f"{label} · {round(confidence * 100)}%"
    else:
        label = f"{label} · detection {round(confidence * 100)}%"
    return label


def place_detection_label(bbox, text_size, frame_shape, placed_rectangles, obstacles=()):
    """Place a detection label without covering another label or vehicle box."""
    x, y, box_width, box_height = bbox
    text_width, text_height = text_size
    frame_height, frame_width = frame_shape[:2]
    label_width = min(frame_width, text_width + 8)
    label_height = text_height + 9
    step = label_height + 3

    x_targets = [x, x - label_width - 5, x + box_width + 5,
                 x + (box_width - label_width) / 2]
    y_targets = [y - 5, y + box_height + label_height + 4,
                 y - step - 5, y + box_height + 2 * step]
    for distance in range(2, 8):
        y_targets.extend((y - distance * step - 5,
                          y + box_height + label_height + distance * step))

    candidates = []
    occupied = (*placed_rectangles, *obstacles)
    seen = set()
    for target_y in y_targets:
        for target_x in x_targets:
            left = int(np.clip(target_x, 0, max(0, frame_width - label_width)))
            baseline = int(np.clip(target_y, text_height + 5, max(text_height + 5, frame_height - 4)))
            rectangle = (left, baseline - text_height - 5,
                         left + label_width, baseline + 4)
            if rectangle in seen:
                continue
            seen.add(rectangle)
            overlap = any(rectangle[0] < other[2] + 2 and rectangle[2] + 2 > other[0]
                          and rectangle[1] < other[3] + 2 and rectangle[3] + 2 > other[1]
                          for other in occupied)
            if not overlap:
                return left, baseline, rectangle
            candidates.append((left, baseline, rectangle))

    # Dense scenes can exhaust the nearby slots. Choose the least-overlapping
    # location so every real detection remains labeled instead of hiding one.
    return min(candidates, key=lambda item: sum(
        (2 if other in placed_rectangles else 1) * (
            item[2][0] < other[2] and item[2][2] > other[0]
            and item[2][1] < other[3] and item[2][3] > other[1])
        for other in occupied), default=(0, text_height + 5, (0, 0, label_width, label_height)))


class VideoSession:
    def __init__(self, camera, infer, inference_gate=None, observation_store=None, model_name="configured-detector", zone_aware_inference=False):
        self.camera = camera
        self.id = uuid.uuid4().hex
        self.infer = infer
        self.zone_aware_inference = zone_aware_inference
        self.inference_gate = inference_gate
        self.observation_store = observation_store
        self.model_name = model_name
        self.detection_profile = "standard"
        self.execution_provider = "Detecting"
        self.filters_customized = False
        self.zone = observation_store.zone(camera["id"]) if observation_store else {"enabled": False, "revision": 0}
        self.recorder = None
        self.restart_drain_requested = threading.Event()
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self.latest = None
        self.analysis = None
        self.analysis_history = deque(maxlen=20)
        self.output = None
        self.state = "Connecting"
        self.error = ""
        self.inference_error = ""
        self.reconnect_attempts = 0
        self.retry_at = None
        self.generation = 0
        self.sequence = 0
        self.media_time = 0.0
        self.source_fps = 25.0
        self.generation_first_sequence = 1
        self.video_delay = .6
        self.processed = 0
        self.started = time.monotonic()
        self.last_output = 0.0
        self.output_total = 0
        self.output_times = deque(maxlen=150)
        self.inference_times = deque(maxlen=60)
        self.settings = {"confidence": .30, "classes": [*CLASSES.values(), "rider", "vehicle"], "show_candidates": True}
        self.recorded = camera.get("playback_mode") == "recorded"
        self.threads = [threading.Thread(target=self._capture, daemon=True, name=f"capture-{camera['id']}"),
                        threading.Thread(target=self._inference, daemon=True, name=f"detect-{camera['id']}")]
        for thread in self.threads:
            thread.start()

    def _capture(self):
        attempts = 0
        while not self.stop_event.is_set():
            cap = None
            try:
                self.state = "Connecting" if attempts == 0 else "Reconnecting"
                self.retry_at = None
                cap = open_capture(self.camera["stream_url"])
                if not cap.isOpened():
                    raise RuntimeError("Video source did not open.")
                fps = cap.get(cv2.CAP_PROP_FPS)
                fps = fps if 1 <= fps <= 120 else 25
                frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
                if 1 < frame_count < 100000000:
                    self.recorded = True
                self.generation += 1
                self.source_fps = fps
                self.generation_first_sequence = self.sequence + 1
                with self.lock:
                    self.analysis = None
                    self.latest = None
                    self.output = None
                    self.analysis_history.clear()
                origin, index, good_frames = time.monotonic(), 0, 0
                next_output = origin
                playback = deque(maxlen=32)
                while not self.stop_event.is_set():
                    ok, frame = cap.read()
                    if not ok or frame is None:
                        if self.recorded:
                            # Finish the aligned tail instead of losing the final
                            # processing-buffer interval of a recorded video.
                            for pending in playback:
                                if self.output and pending[0] <= self.output[0]:
                                    continue
                                if self.stop_event.wait(max(0, pending[1] + self.video_delay - time.monotonic())):
                                    return
                                self._publish(pending)
                            self.state = "Recorded playback ended"
                            return
                        raise RuntimeError("The provider interrupted its video stream.")
                    # HLS delivers segments in bursts. Pace live input as well as
                    # files, or an entire segment would become a few stills.
                    if not self.recorded and time.monotonic() - (origin + index / fps) > 2:
                        origin = time.monotonic() - index / fps
                    if self.stop_event.wait(max(0, origin + index / fps - time.monotonic())):
                        return
                    index += 1
                    self.media_time = (index - 1) / fps
                    if frame.shape[1] > 1280:
                        frame = cv2.resize(frame, (1280, round(frame.shape[0] * 1280 / frame.shape[1])))
                    instant = time.monotonic()
                    self.sequence += 1
                    sample = (self.sequence, instant, frame, self.generation)
                    with self.lock:
                        self.latest = sample
                    # Decode all input but compose at most 30 actual frames per second.
                    if fps > 30 and instant < next_output:
                        continue
                    next_output = max(next_output + 1 / min(30, fps), instant)
                    playback.append(sample)
                    # FIFO plus a small scheduling tolerance preserves every
                    # paced input frame instead of alternating skips on jitter.
                    if not playback or playback[0][1] > instant - self.video_delay + min(.01, .25 / fps):
                        continue
                    displayed = playback.popleft()
                    self._publish(displayed)
                    self.state = "Recorded playback" if self.recorded else "Live"
                    self.error = ""
                    good_frames += 1
                    if good_frames >= fps * 10:
                        attempts = 0
                        self.reconnect_attempts = 0
            except Exception:
                logger.warning("Video capture interrupted for %s", self.camera["id"], exc_info=True)
                if self.camera.get("playback_mode") == "recorded":
                    self.state = "Video unavailable"
                    self.error = "Recorded video source is unavailable."
                    return
                self.state = "Reconnecting"
                self.error = "Video source unavailable. Reconnecting automatically."
                with self.lock:
                    self.latest = self.output = self.analysis = None
                    self.analysis_history.clear()
                attempts += 1
                self.reconnect_attempts = attempts
                delay = live_reconnect_delay_seconds(attempts)
                self.retry_at = time.monotonic() + delay
                self.stop_event.wait(delay)
            finally:
                if cap is not None:
                    cap.release()

    def _publish(self, sample):
        annotated, metrics = self._compose(sample)
        if self.observation_store is not None:
            if self.recorder is None:
                self.recorder = EvidenceRecorder(self.observation_store, self.camera["id"], self.id,
                                                 min(30, self.source_fps), self.model_name)
                if self.restart_drain_requested.is_set():
                    self.recorder.request_restart_drain()
            self.recorder.submit(annotated, metrics)
        instant = time.monotonic()
        with self.lock:
            self.output = (sample[0], instant, annotated, metrics)
        self.last_output = instant
        self.output_total += 1
        self.output_times.append(instant)

    def request_restart_drain(self):
        self.restart_drain_requested.set()
        if self.recorder is not None:
            self.recorder.request_restart_drain()

    def cancel_restart_drain(self):
        self.restart_drain_requested.clear()
        if self.recorder is not None:
            self.recorder.cancel_restart_drain()

    @property
    def restart_drain_ready(self):
        return self.recorder is None or self.recorder.restart_drain_ready

    def _detect_latest(self, last_sequence):
        # Select a fresh frame after shared model access; schedule detail work
        # per camera so contention never creates a stale analysis backlog.
        with self.inference_gate if self.inference_gate is not None else nullcontext():
            if self.stop_event.is_set():
                return None
            with self.lock:
                sample = self.latest
            if sample is None or sample[0] == last_sequence or time.monotonic() - sample[1] > 1:
                return None
            if getattr(self, "zone_aware_inference", False):
                with self.lock:
                    zone = dict(self.zone)
                    zone["_detail_crop_cursor"] = int(self.zone.get("_detail_crop_cursor", 0))
                zone["_high_resolution_detail"] = (self.processed + 1) % 3 == 0
                detections = self.infer(sample[2], zone=zone)
                with self.lock:
                    # Keep this scheduling hint on the live session only; it
                    # is not part of the saved, operator-reviewed road zone.
                    self.zone["_detail_crop_cursor"] = int(zone.get("_detail_crop_cursor", 0)) % 3
                return sample, detections
            return sample, self.infer(sample[2])

    def _inference(self):
        last_sequence, generation = -1, -1
        tracker = audit_tracker = None
        while not self.stop_event.wait(.01):
            try:
                result = self._detect_latest(last_sequence)
                if result is None:
                    continue
                (sequence, instant, frame, current_generation), detections = result
                if current_generation != generation:
                    tracker = RoadTracker(fps=self.source_fps)
                    audit_tracker = RoadTracker(fps=self.source_fps)
                    generation = current_generation
                # A newer source generation must never receive old boxes.
                if time.monotonic() - instant > 1 or self.generation != generation:
                    continue
                with self.lock:
                    zone = dict(self.zone)
                profile = getattr(detections, "profile", "standard")
                boxes = tracker.update(detections, frame, instant, {**zone, "low_light": profile == "low_light"})
                directional_outside = []
                if zone.get("enabled"):
                    audit_zone = {**zone, "enabled": True,
                        "polygon": [[0., 0.], [1., 0.], [1., 1.], [0., 1.]],
                        "counting_line_y": 1.01}
                    audit_boxes = audit_tracker.update(detections, frame, instant,
                                                        {**audit_zone, "low_light": profile == "low_light"})
                    directional_outside = directional_outside_tracks(audit_boxes, frame.shape, zone)
                scale = min(1, 512 / frame.shape[1])
                gray = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), None, fx=scale, fy=scale)
                with self.lock:
                    self.model_name = getattr(detections, "model_name", self.model_name)
                    self.detection_profile = profile
                    if not self.filters_customized:
                        self.settings["confidence"] = LOW_LIGHT_TRACK_CONFIDENCE if profile == "low_light" else .30
                    road_candidates = [d for d in detections if in_road_zone(d.bbox, frame.shape, zone)]
                    outside_zone_candidates = [d for d in detections if not in_road_zone(d.bbox, frame.shape, zone)]
                    outside_zone_classes = {}
                    for candidate in outside_zone_candidates:
                        outside_zone_classes[candidate.class_name] = outside_zone_classes.get(candidate.class_name, 0) + 1
                    outside_zone_boxes = [{"bbox": list(candidate.bbox), "class": candidate.class_name,
                                           "confidence": round(candidate.confidence, 3)}
                                          for candidate in outside_zone_candidates[:12]]
                    road_candidate_boxes = [{"bbox": list(candidate.bbox), "class": candidate.class_name,
                                             "confidence": round(candidate.confidence, 3)}
                                            for candidate in road_candidates[:12]]
                    diagnostics = {"raw_candidates": len(detections),
                        "road_candidates": len(road_candidates),
                        "road_candidate_boxes": road_candidate_boxes,
                        "outside_zone_candidates": len(outside_zone_candidates),
                        "outside_zone_classes": outside_zone_classes,
                        "outside_zone_boxes": outside_zone_boxes,
                        "directional_outside_tracks": directional_outside,
                        "duplicate_candidates": tracker.suppressed_candidates,
                        "inbound_tracks": len(boxes)}
                    self.analysis = (sequence, instant, boxes, gray, scale, generation, diagnostics)
                    self.analysis_history.append(self.analysis)
                self.inference_error = ""
                self.execution_provider = getattr(detections, "execution_provider", None) or self.execution_provider
                self.processed += 1
                self.inference_times.append(time.monotonic())
                last_sequence = sequence
                # Fast road models can analyze the next real frame without an
                # additional fixed 80 ms pause. Bound the analysis rate to 10 Hz.
                self.stop_event.wait(max(.005, .1 - (time.monotonic() - instant)))
            except Exception:
                logger.warning("Inference unavailable for %s", self.camera["id"], exc_info=True)
                with self.lock:
                    self.analysis = None
                    self.analysis_history.clear()
                self.inference_error = "Detection unavailable"
                self.stop_event.wait(2)

    def _compose(self, sample):
        sequence, instant, frame, generation = sample
        with self.lock:
            history = list(self.analysis_history)
            filters = dict(self.settings)
            zone = dict(self.zone)
        rendered = frame.copy()
        counts = None
        age = None
        model_detections = None
        boxes = []
        provisional_boxes = []
        visible_boxes = []
        observed = []
        pipeline = {}
        placed_labels = []
        prior = [item for item in history if item[5] == generation and 0 <= instant - item[1] <= 1]
        if prior:
            analysis = prior[-1]
            pipeline = dict(analysis[6]) if len(analysis) > 6 else {}
            pipeline.update(summarize_detection_window(history, instant, generation))
            age = instant - analysis[1]
            scale = analysis[4]
            gray = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), None, fx=scale, fy=scale)
            detected = aligned_boxes(history, sample, gray, scale)
            pipeline["aligned_tracks"] = len(detected)
            detected = confirmed_boxes(detected, history, instant, generation)
            pipeline["confirmed_tracks"] = len(detected)
            observation_floor = LOW_LIGHT_OBSERVATION_CONFIDENCE if self.detection_profile == "low_light" else .20
            observed = [box for box in detected if in_road_zone(box["bbox"], frame.shape, zone)
                        and (box.get("track_confidence", box["confidence"]) >= observation_floor or box.get("counted"))]
            model_detections = len(detected)
            boxes = [box for box in detected if box.get("track_confidence", box["confidence"]) >= filters["confidence"] and box["class"] in filters["classes"]]
            displayed_ids = {box["id"] for box in boxes}
            if self.detection_profile == "low_light" and filters.get("show_candidates", True):
                provisional_boxes = [box for box in observed
                    if box["id"] not in displayed_ids
                    and box.get("low_light")
                    and box.get("observation_hits", 0) >= 2
                    and LOW_LIGHT_TRACK_CONFIDENCE <= box.get("track_confidence", box["confidence"]) < filters["confidence"]
                    and (box["class"] in filters["classes"]
                         or box.get("candidate_class") in filters["classes"])]
            provisional_ids = {box["id"] for box in provisional_boxes}
            boxes = [box for box in boxes if box["bbox"][0] < frame.shape[1] and box["bbox"][1] < frame.shape[0]
                     and box["bbox"][0] + box["bbox"][2] > 0 and box["bbox"][1] + box["bbox"][3] > 0]
            boxes = [box for box in boxes if in_road_zone(box["bbox"], frame.shape, zone)]
            # Run duplicate suppression after both normal and provisional
            # candidates have been combined, so weak tracks cannot paint
            # overlapping class guesses on top of a stronger vehicle box.
            boxes, provisional_boxes = unique_render_boxes(boxes, provisional_boxes)
            provisional_ids = {box["id"] for box in provisional_boxes}
            counts = {name: 0 for name in [*CLASSES.values(), "rider", "vehicle"]}
            visible_boxes = boxes + provisional_boxes
            # In low light, show current in-zone model candidates even before
            # the tracker has enough repeated evidence to create a track. The
            # amber styling and label keep these review hints separate from
            # tracks, crossings, saved observations, and road estimates.
            candidate_boxes = []
            if (self.detection_profile == "low_light" and filters.get("show_candidates", True)
                    and age is not None and age <= .25):
                for candidate in pipeline.get("road_candidate_boxes", [])[:6]:
                    if (candidate.get("class") not in filters["classes"]
                            or candidate.get("confidence", 0) < LOW_LIGHT_TRACK_CONFIDENCE):
                        continue
                    candidate_bbox = tuple(int(value) for value in candidate.get("bbox", ()))
                    if len(candidate_bbox) != 4 or candidate_bbox[2] <= 0 or candidate_bbox[3] <= 0:
                        continue
                    x, y, width, height = candidate_bbox
                    if x >= frame.shape[1] or y >= frame.shape[0] or x + width <= 0 or y + height <= 0:
                        continue
                    candidate_area = max(1, width * height)
                    shadowed = False
                    for tracked in visible_boxes:
                        tx, ty, tw, th = tracked["bbox"]
                        intersection = max(0, min(x + width, tx + tw) - max(x, tx)) * max(
                            0, min(y + height, ty + th) - max(y, ty))
                        if intersection / min(candidate_area, max(1, tw * th)) >= .40:
                            shadowed = True
                            break
                    if not shadowed:
                        candidate_boxes.append({**candidate, "bbox": candidate_bbox})
            for candidate in candidate_boxes:
                x, y, width, height = candidate["bbox"]
                draw_dashed_rectangle(rendered, (x, y, width, height), PROVISIONAL_COLOR, 1)
                label = f"Candidate {candidate['class'].title()} · {round(candidate['confidence'] * 100)}%"
                font = max(.42, min(.65, frame.shape[1] / 2000))
                (label_w, label_h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font, 2)
                obstacles = [(other["bbox"][0], other["bbox"][1],
                              other["bbox"][0] + other["bbox"][2], other["bbox"][1] + other["bbox"][3])
                             for other in visible_boxes]
                lx, ly, label_rect = place_detection_label((x, y, width, height), (label_w, label_h),
                                                            frame.shape, placed_labels, obstacles)
                placed_labels.append(label_rect)
                cv2.rectangle(rendered, (lx, ly - label_h - 5), (lx + label_w + 8, ly + 4),
                              PROVISIONAL_COLOR, -1)
                cv2.putText(rendered, label, (lx + 4, ly), cv2.FONT_HERSHEY_SIMPLEX,
                            font, (15, 22, 16), 2, cv2.LINE_AA)
            compact_labels = len(visible_boxes) >= 10
            label_order = sorted(visible_boxes, key=lambda item: (
                item.get("track_confidence", item.get("confidence", 0)),
                item["bbox"][2] * item["bbox"][3]), reverse=True)
            for box in label_order:
                x, y, w, h = box["bbox"]
                provisional = (box["id"] in provisional_ids or box.get("class_status") == "uncertain"
                               or box.get("direction_status") == "checking")
                color = PROVISIONAL_COLOR if provisional else COLORS[box["class"]]
                counts[box["class"]] += 1
                if provisional:
                    draw_dashed_rectangle(rendered, (x, y, w, h), color, 2)
                else:
                    cv2.rectangle(rendered, (x, y), (x + w, y + h), color, 2)
                label = detection_overlay_label(box)
                confidence = box.get("confidence", box.get("track_confidence", 0))
                if box["id"] in provisional_ids:
                    label = detection_overlay_text(box, confidence, candidate=True, compact=compact_labels)
                elif provisional:
                    label = detection_overlay_text(box, confidence, compact=compact_labels)
                elif compact_labels:
                    label = detection_overlay_text(box, confidence, compact=True)
                font = max(.42, min(.65, frame.shape[1] / 2000))
                (label_w, label_h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font, 2)
                obstacles = [(other["bbox"][0], other["bbox"][1],
                              other["bbox"][0] + other["bbox"][2], other["bbox"][1] + other["bbox"][3])
                             for other in visible_boxes if other["id"] != box["id"]]
                lx, ly, label_rect = place_detection_label((x, y, w, h), (label_w, label_h),
                                                            frame.shape, placed_labels, obstacles)
                placed_labels.append(label_rect)
                cv2.rectangle(rendered, (lx, ly - label_h - 5), (lx + label_w + 8, ly + 4), color, -1)
                cv2.putText(rendered, label, (lx + 4, ly), cv2.FONT_HERSHEY_SIMPLEX, font, (15, 22, 16), 2, cv2.LINE_AA)
        title = "Inbound monitoring" if zone.get("enabled") else "Traffic monitoring"
        cv2.rectangle(rendered, (8, 8), (215, 35), (26, 39, 33), -1)
        cv2.putText(rendered, title, (16, 27), 0, .5, (220, 238, 226), 1, cv2.LINE_AA)
        observed_at = datetime.now(timezone.utc) - timedelta(seconds=max(0, time.monotonic() - instant))
        def reading(box):
            crossing = box.get("crossing_instant")
            return {"id": box["id"], "class": box["class"], "bbox": box["bbox"],
                "confidence": round(box["confidence"], 3), "track_confidence": round(box.get("track_confidence", box["confidence"]), 3),
                "first_seen_at": (observed_at - timedelta(seconds=max(0, box.get("track_age_seconds", 0)))).isoformat(),
                "class_status": box.get("class_status"),
                "candidate_class": box.get("candidate_class") if box.get("class_status") == "uncertain" else None,
                "trail": [(int(x), int(y)) for x, y in box.get("trail", ())],
                "direction": box.get("direction"), "direction_status": box.get("direction_status", "confirmed"),
                "counted": box.get("counted", False),
                "model_hits": box.get("observation_hits", 0),
                "crossed_at": (datetime.now(timezone.utc) - timedelta(seconds=max(0, time.monotonic() - crossing))).isoformat() if crossing is not None else None}
        mask = np.zeros((180, 320), np.uint8)
        zone_mask = np.ones_like(mask)
        # Provisional direction-checking tracks remain visible and saved,
        # but must not inflate road occupancy or slow-traffic estimates.
        vehicles = [box for box in observed if box["class"] not in {"pedestrian", "rider"}
                    and box.get("direction_status") != "checking"]
        if zone.get("enabled"):
            zone_mask[:] = 0
            cv2.fillPoly(zone_mask, [np.round(np.asarray(zone["polygon"]) * (320, 180)).astype(np.int32)], 1)
        for box in vehicles:
            x, y, w, h = box["bbox"]
            cv2.rectangle(mask, (round(x * 320 / frame.shape[1]), round(y * 180 / frame.shape[0])),
                (round((x + w) * 320 / frame.shape[1]), round((y + h) * 180 / frame.shape[0])), 1, -1)
        movement = [box["motion_lengths_per_second"] for box in vehicles if "motion_lengths_per_second" in box]
        traffic = {"object_count": len(vehicles), "image_coverage": float((mask * zone_mask).sum() / max(1, zone_mask.sum())),
            "visibility": "low_light" if self.detection_profile.startswith("low_light") else "standard",
            **traffic_motion_metrics(movement), "analysis_available": counts is not None}
        return rendered, {"sequence": sequence, "counts": counts, "track_ids": [box["id"] for box in visible_boxes],
                          "observed_at": observed_at.isoformat(),
                          "detections": [reading(box) for box in visible_boxes], "observed_detections": [reading(box) for box in observed],
                          "traffic": traffic,
                          "model": self.model_name, "detection_profile": self.detection_profile,
                          "execution_provider": self.execution_provider,
                          "analysis_pipeline": {**pipeline, "displayed_tracks": len(visible_boxes),
                                                "confirmed_displayed_tracks": len(boxes),
                                                "provisional_displayed_tracks": len(provisional_boxes)},
                          "analysis_zone": zone,
                          "model_detections": model_detections,
                          "media_time_seconds": round((sequence - self.generation_first_sequence) / self.source_fps, 3), "generation": generation,
                          "processing_buffer_seconds": self.video_delay,
                          "inference_age_seconds": round(age, 3) if age is not None else None,
                          "width": frame.shape[1], "height": frame.shape[0]}

    def status(self):
        instant = time.monotonic()
        with self.lock:
            output = self.output
            filters = dict(self.settings)
        recent = output is not None and instant - output[1] < 2 and self.state in {"Live", "Recorded playback"}
        return {"session_id": self.id, "camera_id": self.camera["id"],
                "state": self.state if recent or self.state not in {"Live", "Recorded playback"} else "Buffering",
                "error": self.error, "inference_error": self.inference_error,
                "counts": output[3]["counts"] if recent else None,
                "sample_age_seconds": round(instant - output[1], 3) if output else None,
                "metrics": output[3] if recent else None,
                "output_fps": self._rate(self.output_times),
                "inference_fps": self._rate(self.inference_times),
                "frames_decoded": self.sequence, "frames_published": self.output_total,
                "inference_updates": self.processed,
                "settings": filters, "recorded": self.recorded,
                "model": self.model_name,
                "execution_provider": self.execution_provider,
                "detection_profile": self.detection_profile,
                "analysis_zone": dict(self.zone), "tracker": "Roboflow ByteTrack 2.6.1",
                "reconnect_attempts": self.reconnect_attempts,
                "retry_in_seconds": round(max(0.0, self.retry_at - instant), 1) if self.retry_at else None,
                "evidence_fps": self.recorder.evidence_fps if self.recorder else None,
                "storage_error": self.recorder.status_error if self.recorder else ""}

    @staticmethod
    def _rate(timestamps):
        # Copy while holding the GIL; deque iteration cannot race thread appends.
        recent = list(timestamps)
        return round((len(recent) - 1) / max(.001, recent[-1] - recent[0]), 1) if len(recent) > 1 else 0

    async def close(self):
        self.stop_event.set()
        await asyncio.gather(*(asyncio.to_thread(thread.join, 18) for thread in self.threads))
        if self.recorder is not None:
            await asyncio.to_thread(self.recorder.close)
        with self.lock:
            self.latest = self.output = self.analysis = None
            self.analysis_history.clear()


class CameraVideoTrack(VideoStreamTrack):
    def __init__(self, session):
        super().__init__()
        self.session = session
        self.sequence = -1
        self.origin = None

    async def recv(self):
        while self.readyState == "live" and not self.session.stop_event.is_set():
            with self.session.lock:
                sample = self.session.output
            if sample and sample[0] != self.sequence and time.monotonic() - sample[1] < 2:
                self.sequence = sample[0]
                self.origin = sample[1] if self.origin is None else self.origin
                frame = VideoFrame.from_ndarray(sample[2], format="bgr24")
                frame.pts = round((sample[1] - self.origin) * 90000)
                frame.time_base = Fraction(1, 90000)
                return frame
            if self.session.state in {"Video unavailable", "Recorded playback ended"}:
                raise MediaStreamError
            await asyncio.sleep(.005)
        raise MediaStreamError


class VideoService:
    def __init__(self, observation_store=None):
        self.sessions = {}
        self.peers = {}
        self.lock = asyncio.Lock()
        self.model_lock = threading.RLock()
        self.detector = None
        self.low_light_detector = None
        self.low_light_road_detector = None
        self.low_light_high_res_detector = None
        self.low_light_high_res_road_detector = None
        self.high_res_detail_detector = None
        self.high_res_detail_road_detector = None
        self.high_res_detail_retry_after = 0.0
        self.expiry = {}
        self._observation_store = None
        self.observation_store = observation_store
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.monitor_leases = {}
        self.monitor_tasks = {}
        self.restart_drain_active = False

    @property
    def observation_store(self):
        return self._observation_store

    @observation_store.setter
    def observation_store(self, store):
        self._observation_store = store
        if store is not None and hasattr(store, "active_cameras_provider"):
            store.active_cameras_provider = self.active_camera_ids

    def active_camera_ids(self) -> set[str]:
        now = time.monotonic()
        active = set()
        for (leased_camera, _), stamp in self.monitor_leases.items():
            if now - stamp < MONITOR_LEASE_SECONDS:
                active.add(leased_camera)
        for _, peer_session, _ in self.peers.values():
            if peer_session and getattr(peer_session, "camera", None) and peer_session.camera.get("id"):
                active.add(peer_session.camera["id"])
        for camera_id, session in self.sessions.items():
            if not session.stop_event.is_set() and session.state not in {"Video unavailable", "Recorded playback ended"}:
                active.add(camera_id)
        return active

    async def monitor(self, camera, client_id):
        async with self.lock:
            if self.restart_drain_active:
                raise OverflowError("Camera service is preparing a brief restart. Try again shortly.")
            session = self.sessions.get(camera["id"])
            if session and session.state in {"Video unavailable", "Recorded playback ended"}:
                expiry = self.expiry.pop(session.id, None)
                if expiry:
                    expiry.cancel()
                await session.close()
                self.sessions.pop(camera["id"])
                session = None
            if session and session.stop_event.is_set():
                raise OverflowError("Camera is reconnecting. Monitoring will retry.")
            if session is None:
                if len(self.sessions) >= 4:
                    raise OverflowError("Four cameras are already being monitored.")
                session = VideoSession(camera, self.infer, self.model_lock, self.observation_store,
                    settings.VIDEO_MODEL_PATH.name, zone_aware_inference=self.observation_store is not None)
                self.sessions[camera["id"]] = session
            key = (camera["id"], client_id)
            self.monitor_leases[key] = time.monotonic()
            if key not in self.monitor_tasks:
                self.monitor_tasks[key] = asyncio.create_task(self._watch_monitor(key))
            return {"status": "monitoring", "camera_id": camera["id"]}

    def _has_monitor(self, camera_id):
        return any(key[0] == camera_id and time.monotonic() - stamp < MONITOR_LEASE_SECONDS for key, stamp in self.monitor_leases.items())

    async def _watch_monitor(self, key):
        try:
            while key in self.monitor_leases:
                await asyncio.sleep(10)
                if time.monotonic() - self.monitor_leases.get(key, 0) >= MONITOR_LEASE_SECONDS:
                    await self.stop_monitor(*key)
        finally:
            self.monitor_tasks.pop(key, None)

    async def stop_monitor(self, camera_id, client_id):
        self.monitor_leases.pop((camera_id, client_id), None)
        session = self.sessions.get(camera_id)
        if session and not self._has_monitor(camera_id) and not any(item[1] is session for item in self.peers.values()) and session.id not in self.expiry:
            self.expiry[session.id] = asyncio.create_task(self._expire(camera_id, session))
        return {"status": "background monitoring stopped"}

    async def prepare_restart(self):
        """Drain active evidence clips before a planned local API restart."""
        async with self.lock:
            self.restart_drain_active = True
            sessions = list(self.sessions.items())
            for _, session in sessions:
                session.request_restart_drain()
        cameras = [{"camera_id": camera_id, "ready": session.restart_drain_ready}
                   for camera_id, session in sessions]
        return {"ready": all(item["ready"] for item in cameras),
                "cameras": cameras, "active_sessions": len(cameras)}

    async def cancel_restart(self):
        async with self.lock:
            self.restart_drain_active = False
            for session in self.sessions.values():
                session.cancel_restart_drain()
        return {"status": "restart cancelled"}

    def infer(self, frame, zone=None):
        with self.model_lock:
            low_light = is_low_light(frame)
            if low_light and settings.VIDEO_LOW_LIGHT_MODEL_PATH.is_file():
                model_name = settings.VIDEO_LOW_LIGHT_MODEL_PATH.name
                if self.low_light_detector is None:
                    self.low_light_detector = VehicleDetector(str(settings.VIDEO_LOW_LIGHT_MODEL_PATH), confidence_threshold=.10,
                        backend=settings.PERCEPTION_BACKEND,
                        class_names=BDD_CLASSES if settings.VIDEO_LOW_LIGHT_PROFILE == "bdd100k" else CLASSES,
                        num_classes=10 if settings.VIDEO_LOW_LIGHT_PROFILE == "bdd100k" else 80,
                        input_size=settings.VIDEO_LOW_LIGHT_INPUT_SIZE)
                if settings.VIDEO_LOW_LIGHT_PROFILE == "bdd100k":
                    detector = self.low_light_detector
                    # The 960 export improves small distant-car evidence but is
                    # expensive on CPU. Use it only on CUDA and only when this
                    # service has a single active camera session; multi-camera
                    # viewing keeps the faster 640 profile for fairer cadence.
                    active_sessions = sum(not session.stop_event.is_set() for session in self.sessions.values())
                    can_use_high_res = (getattr(detector, "execution_provider", None) == "CUDAExecutionProvider"
                        and active_sessions <= 1 and bool(zone and zone.get("enabled") and zone.get("_high_resolution_detail"))
                        and has_high_res_memory_headroom(available_system_memory_bytes())
                        and settings.VIDEO_LOW_LIGHT_HIGH_RES_MODEL_PATH.is_file())
                    if can_use_high_res and self.low_light_high_res_detector is None:
                        try:
                            self.low_light_high_res_detector = VehicleDetector(
                                str(settings.VIDEO_LOW_LIGHT_HIGH_RES_MODEL_PATH), confidence_threshold=.10,
                                backend=settings.PERCEPTION_BACKEND, class_names=BDD_CLASSES,
                                num_classes=10, input_size=960)
                            if getattr(self.low_light_high_res_detector, "execution_provider", None) != "CUDAExecutionProvider":
                                self.low_light_high_res_detector = None
                        except Exception:
                            logger.warning("High-resolution CUDA night model unavailable; using the 640-pixel model.", exc_info=True)
                            self.low_light_high_res_detector = None
                    if self.low_light_road_detector is None:
                        self.low_light_road_detector = TrafficDetector(detector)
                    road_detector = self.low_light_road_detector
                    # Keep the 640-pixel boxes on every sample for stable
                    # tracking. On selected CUDA samples, fuse the 960-pixel
                    # inbound crops as supplemental small-vehicle evidence;
                    # replacing the base boxes with a different scale reduced
                    # track continuity in the paired night-video comparison.
                    detections = (road_detector.detect(frame, zone, enhance_detail=True)
                                  if zone and zone.get("enabled")
                                  else detector.detect(frame))
                    if can_use_high_res and self.low_light_high_res_detector is not None:
                        try:
                            if self.low_light_high_res_road_detector is None:
                                self.low_light_high_res_road_detector = TrafficDetector(self.low_light_high_res_detector)
                            detail_detections = self.low_light_high_res_road_detector.detect(frame, zone)
                            detections = merge_detections(
                                [*detections, *detail_detections],
                                threshold=detector.confidence_threshold,
                            )
                            model_name = f"{settings.VIDEO_LOW_LIGHT_MODEL_PATH.name}+{settings.VIDEO_LOW_LIGHT_HIGH_RES_MODEL_PATH.name}"
                        except Exception:
                            logger.warning("High-resolution night detail pass failed; preserving the base detections.", exc_info=True)
                    detections = reject_headlight_fragments(detections)
                else:
                    detections = detect_low_light(self.low_light_detector, frame)
                    detector = self.low_light_detector
                provider = getattr(detector, "execution_provider", None)
                model_path = getattr(detector, "model_path", settings.VIDEO_LOW_LIGHT_MODEL_PATH)
                return DetectionBatch(detections, model_name if settings.VIDEO_LOW_LIGHT_PROFILE == "bdd100k" else Path(model_path).name, "low_light", provider)
            if self.detector is None:
                self.detector = TrafficDetector(VehicleDetector(str(settings.VIDEO_MODEL_PATH), confidence_threshold=.10,
                                               backend=settings.PERCEPTION_BACKEND, class_names=CLASSES))
            detections = self.detector.detect(frame, zone=zone)
            provider = getattr(self.detector.detector, "execution_provider", None)
            model_name = settings.VIDEO_MODEL_PATH.name
            active_sessions = sum(not session.stop_event.is_set() for session in self.sessions.values())
            can_use_high_res_detail = (
                provider == "CUDAExecutionProvider"
                and active_sessions <= 1
                and bool(zone and zone.get("enabled") and zone.get("_high_resolution_detail"))
                and has_high_res_memory_headroom(available_system_memory_bytes())
                and settings.VIDEO_HIGH_RES_DETAIL_MODEL_PATH.is_file()
            )
            if can_use_high_res_detail:
                if self.high_res_detail_detector is None and time.monotonic() >= self.high_res_detail_retry_after:
                    try:
                        self.high_res_detail_detector = VehicleDetector(
                            str(settings.VIDEO_HIGH_RES_DETAIL_MODEL_PATH),
                            confidence_threshold=.10,
                            backend=settings.PERCEPTION_BACKEND,
                            class_names=CLASSES,
                            input_size=1280,
                        )
                        if getattr(self.high_res_detail_detector, "execution_provider", None) != "CUDAExecutionProvider":
                            self.high_res_detail_detector = None
                            self.high_res_detail_retry_after = time.monotonic() + 60
                    except Exception:
                        logger.warning("High-resolution daytime detail model unavailable; preserving base detections.", exc_info=True)
                        self.high_res_detail_detector = None
                        self.high_res_detail_retry_after = time.monotonic() + 60
                if self.high_res_detail_detector is not None:
                    try:
                        if self.high_res_detail_road_detector is None:
                            self.high_res_detail_road_detector = TrafficDetector(self.high_res_detail_detector)
                        detail_detections = self.high_res_detail_road_detector.detect_far_road(frame, zone)
                        detections = merge_detections(
                            [*detections, *detail_detections],
                            threshold=self.detector.detector.confidence_threshold,
                        )
                        model_name = f"{settings.VIDEO_MODEL_PATH.name}+{settings.VIDEO_HIGH_RES_DETAIL_MODEL_PATH.name}"
                    except Exception:
                        logger.warning("High-resolution daytime detail pass failed; preserving the base detections.", exc_info=True)
                        self.high_res_detail_retry_after = time.monotonic() + 60
            return DetectionBatch(detections, model_name,
                                  "low_light_unavailable" if low_light else "standard", provider)

    async def offer(self, camera, sdp, description_type):
        if not camera.get("stream_url"):
            raise ValueError("Video not supported by this source.")
        async with self.lock:
            if self.restart_drain_active:
                raise OverflowError("Camera service is preparing a brief restart. Try again shortly.")
            if len(self.peers) >= 12:
                raise OverflowError("Viewer capacity reached. Close another video view.")
            session = self.sessions.get(camera["id"])
            if session and session.state in {"Video unavailable", "Recorded playback ended"}:
                # Terminal sessions have stopped decoding; finish reclaiming the
                # native handle before admitting a replacement to the same slot.
                expiry = self.expiry.pop(session.id, None)
                if expiry:
                    expiry.cancel()
                await session.close()
                self.sessions.pop(camera["id"])
                session = None
            if session and session.stop_event.is_set():
                raise OverflowError("This camera is closing its previous connection. Reconnect in a moment.")
            if session is None:
                if len(self.sessions) >= 4:
                    raise OverflowError("Video capacity reached. Close a camera before opening another.")
                session = VideoSession(camera, self.infer, inference_gate=self.model_lock,
                                       observation_store=self.observation_store,
                                       model_name=settings.VIDEO_MODEL_PATH.name, zone_aware_inference=self.observation_store is not None)
                self.sessions[camera["id"]] = session
            expiry = self.expiry.pop(session.id, None)
            if expiry:
                expiry.cancel()
            peer = RTCPeerConnection(RTCConfiguration(iceServers=[]))
            viewer_id = uuid.uuid4().hex
            self.peers[viewer_id] = (peer, session, time.monotonic())

        @peer.on("connectionstatechange")
        async def state_changed():
            if peer.connectionState in {"failed", "closed"}:
                await self.leave(viewer_id)

        try:
            await peer.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=description_type))
            peer.addTrack(CameraVideoTrack(session))
            await peer.setLocalDescription(await peer.createAnswer())
            # A client that disappears during signaling must not hold resources.
            asyncio.create_task(self._watch(viewer_id))
            return {"sdp": peer.localDescription.sdp, "type": peer.localDescription.type,
                    "viewer_id": viewer_id, "session_id": session.id}
        except BaseException:
            await self.leave(viewer_id)
            raise

    async def _watch(self, viewer_id):
        while viewer_id in self.peers:
            await asyncio.sleep(10)
            entry = self.peers.get(viewer_id)
            if entry and time.monotonic() - entry[2] > 35:
                await self.leave(viewer_id)

    def reading(self, viewer_id):
        peer, session, _ = self.peers[viewer_id]
        self.peers[viewer_id] = (peer, session, time.monotonic())
        return session.status()

    def capture_status(self, camera_id):
        now = time.monotonic()
        session = self.sessions.get(camera_id)
        lease_count = sum(1 for (leased_camera, _), stamp in self.monitor_leases.items()
                          if leased_camera == camera_id and now - stamp < MONITOR_LEASE_SECONDS)
        viewer_count = sum(1 for _, peer_session, _ in self.peers.values()
                           if peer_session.camera["id"] == camera_id)
        state = session.status() if session else None
        active = lease_count > 0 or viewer_count > 0
        metrics = state.get("metrics") if state else None
        pipeline = metrics.get("analysis_pipeline", {}) if metrics else {}
        zone = self.observation_store.zone(camera_id) if self.observation_store else {}
        supplemental_status = supplemental_detail_status(
            state.get("detection_profile") if state else None,
            bool(zone.get("enabled")),
            state.get("execution_provider") if state else None,
            sum(not item.stop_event.is_set() for item in self.sessions.values()),
            available_system_memory_bytes(),
            settings.VIDEO_LOW_LIGHT_HIGH_RES_MODEL_PATH.is_file(),
        )
        return {
            "active": active,
            "camera_detection_policy_version": CAMERA_DETECTION_POLICY_VERSION,
            "live_low_light_candidate_overlay_policy_version": LIVE_LOW_LIGHT_CANDIDATE_OVERLAY_POLICY_VERSION,
            "low_light_detail_enhancement_policy_version": LOW_LIGHT_DETAIL_ENHANCEMENT_POLICY_VERSION,
            "camera_metadata_policy_version": CAMERA_METADATA_POLICY_VERSION,
            "camera_source_catalog_policy_version": CAMERA_SOURCE_CATALOG_POLICY_VERSION,
            "camera_health_monitor_policy_version": CAMERA_HEALTH_MONITOR_POLICY_VERSION,
            "road_correlation_performance_policy_version": ROAD_CORRELATION_PERFORMANCE_POLICY_VERSION,
            "road_correlation_explainability_policy_version": ROAD_CORRELATION_EXPLAINABILITY_POLICY_VERSION,
            "restart_drain_version": RESTART_DRAIN_VERSION,
            "evidence_pause_order_version": EVIDENCE_PAUSE_ORDER_VERSION,
            "video_capacity_scan_version": VIDEO_CAPACITY_SCAN_VERSION,
            "evidence_frame_policy_version": EVIDENCE_FRAME_POLICY_VERSION,
            "track_timing_policy_version": TRACK_TIMING_POLICY_VERSION,
            "session_state": state["state"] if state else "Not connected",
            "monitoring_lease_count": lease_count,
            "live_viewer_count": viewer_count,
            "sample_age_seconds": state["sample_age_seconds"] if state else None,
            "frames_decoded": state["frames_decoded"] if state else 0,
            "inference_updates": state["inference_updates"] if state else 0,
            "model": state.get("model") if state else None,
            "detection_profile": state.get("detection_profile") if state else None,
            "supplemental_detail_status": supplemental_status,
            "execution_provider": state.get("execution_provider") if state else None,
            "output_fps": state.get("output_fps", 0) if state else 0,
            "inference_fps": state.get("inference_fps", 0) if state else 0,
            "evidence_fps": state.get("evidence_fps") if state else None,
            "visible_tracks": len(metrics.get("detections", [])) if metrics else None,
            "confirmed_visible_tracks": pipeline.get("confirmed_displayed_tracks") if metrics else None,
            "provisional_visible_tracks": pipeline.get("provisional_displayed_tracks") if metrics else None,
            "reconnect_attempts": state["reconnect_attempts"] if state else 0,
            "retry_in_seconds": state["retry_in_seconds"] if state else None,
            "error": state["error"] if state else "",
            "inference_error": state["inference_error"] if state else "",
            "storage_error": state.get("storage_error", "") if state else "",
        }

    async def leave(self, viewer_id):
        entry = self.peers.pop(viewer_id, None)
        if not entry:
            return
        peer, session, _ = entry
        await peer.close()
        camera_id = session.camera["id"]
        if not any(item[1] is session for item in self.peers.values()) and session.id not in self.expiry:
            self.expiry[session.id] = asyncio.create_task(self._expire(camera_id, session))

    async def _expire(self, camera_id, session):
        try:
            await asyncio.sleep(3)
            async with self.lock:
                if any(item[1] is session for item in self.peers.values()) or self._has_monitor(camera_id):
                    self.expiry.pop(session.id, None)
                    return
                # Closing native captures still occupy their capacity slot.
                session.stop_event.set()
            await session.close()
            async with self.lock:
                if self.sessions.get(camera_id) is session:
                    self.sessions.pop(camera_id)
                self.expiry.pop(session.id, None)
        except asyncio.CancelledError:
            pass

    async def shutdown(self):
        for task in self.monitor_tasks.values():
            task.cancel()
        self.monitor_leases.clear()
        self.monitor_tasks.clear()
        for task in self.expiry.values():
            task.cancel()
        self.expiry.clear()
        for viewer_id in list(self.peers):
            await self.leave(viewer_id)
        for task in self.expiry.values():
            task.cancel()
        self.expiry.clear()
        sessions = list(self.sessions.values())
        self.sessions.clear()
        await asyncio.gather(*(session.close() for session in sessions))


video_service = VideoService(DetectionStore(
    settings.DATA_PROCESSED_DIR / f"video_{settings.CITY_PROFILE}",
    settings.VIDEO_EVIDENCE_MAX_BYTES,
    settings.VIDEO_RECORD_EVIDENCE,
    min_free_bytes=settings.VIDEO_EVIDENCE_MIN_FREE_BYTES,
    clip_directory=settings.VIDEO_EVIDENCE_DIR,
))
