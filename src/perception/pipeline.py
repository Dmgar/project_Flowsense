"""
Perception Pipeline — frame-by-frame orchestrator for the FlowSense vision system.

Connects the three stages of the perception engine:

    VideoSource → VehicleDetector → VehicleTracker → CongestionEstimator

and pushes the resulting ``CameraTelemetryReport`` to the backend via HTTP,
which dynamically updates the urban graph edge weights in real time.

Supports two execution modes:
  * **Batch** — process a local video file end-to-end.
  * **Streaming** — process frames from an RTSP / HTTP / webcam source continuously.
"""
import asyncio
import logging
import time
from typing import List, Optional

import cv2
import numpy as np

from src.perception.detector import VehicleDetector
from src.perception.tracker import VehicleTracker
from src.perception.congestion_estimator import CongestionEstimator
from src.perception.models import TrackedVehicle

logger = logging.getLogger("flowsense.perception.pipeline")


class PerceptionPipeline:
    """
    Orchestrates the full perception cycle for a single camera feed.

    Parameters
    ----------
    detector : VehicleDetector
        Pre-loaded vehicle detector instance.
    tracker : VehicleTracker
        Multi-object tracker instance.
    estimator : CongestionEstimator
        Congestion metrics calculator.
    camera_id : str
        FlowSense camera identifier (e.g. ``"CAM-NYC-MID-01"``).
    api_url : str
        Base URL of the FlowSense backend (e.g. ``"http://localhost:8000"``).
    """

    def __init__(
        self,
        detector: VehicleDetector,
        tracker: VehicleTracker,
        estimator: CongestionEstimator,
        camera_id: str,
        api_url: str = "http://localhost:8000",
    ):
        self.detector = detector
        self.tracker = tracker
        self.estimator = estimator
        self.camera_id = camera_id
        self.api_url = api_url.rstrip("/")

        # Runtime state
        self._is_running: bool = False
        self._frames_processed: int = 0
        self._last_detection_count: int = 0
        self._last_congestion_factor: float = 0.0
        self._fps_processing: float = 0.0

    # ------------------------------------------------------------------
    # Core processing loop
    # ------------------------------------------------------------------

    async def process_video(
        self,
        source: str,
        skip_frames: int = 3,
        max_frames: Optional[int] = None,
        visualize: bool = False,
        telemetry_interval: int = 10,
    ) -> dict:
        """
        Process a video source frame-by-frame.

        Parameters
        ----------
        source : str
            Path to a video file, RTSP URL, HTTP URL, or webcam index (``"0"``).
        skip_frames : int
            Run detection only every N frames for efficiency; intermediate
            frames still update the tracker via prediction.
        max_frames : int | None
            Stop after processing this many frames (``None`` = entire video).
        visualize : bool
            If ``True``, render annotated frames in a window.
        telemetry_interval : int
            Send telemetry to the backend every N detection cycles.

        Returns
        -------
        dict
            Summary statistics of the pipeline run.
        """
        # Resolve source (webcam index vs file/url)
        cap_source = int(source) if source.isdigit() else source
        cap = cv2.VideoCapture(cap_source)

        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video source: {source}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        self.tracker.fps = fps
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        logger.info(
            f"Pipeline started: camera={self.camera_id}, source={source}, "
            f"fps={fps:.1f}, total_frames={total_frames}, skip={skip_frames}"
        )

        self._is_running = True
        self._frames_processed = 0
        frame_idx = 0
        detection_cycle = 0
        start_time = time.perf_counter()

        try:
            while self._is_running:
                ret, frame = cap.read()
                if not ret:
                    break

                if max_frames and frame_idx >= max_frames:
                    break

                # Run detection+tracking every `skip_frames` frames
                if frame_idx % (skip_frames + 1) == 0:
                    detections = self.detector.detect(frame)
                    tracked = self.tracker.update(detections, frame)
                    detection_cycle += 1

                    # Estimate congestion
                    avg_flow = self.tracker.get_average_flow_velocity()
                    metrics = self.estimator.estimate(
                        tracked,
                        avg_speed_override=avg_flow if avg_flow > 0 else None,
                    )

                    self._last_detection_count = metrics.vehicle_count
                    self._last_congestion_factor = metrics.congestion_factor

                    # Send telemetry to backend periodically
                    if detection_cycle % telemetry_interval == 0:
                        await self._send_telemetry(metrics)

                    # Visual debug window
                    if visualize:
                        annotated = self.annotate_frame(frame, tracked)
                        cv2.imshow(f"FlowSense — {self.camera_id}", annotated)
                        if cv2.waitKey(1) & 0xFF == ord("q"):
                            break

                frame_idx += 1
                self._frames_processed = frame_idx

        finally:
            cap.release()
            if visualize:
                cv2.destroyAllWindows()
            self._is_running = False

        elapsed = time.perf_counter() - start_time
        self._fps_processing = frame_idx / elapsed if elapsed > 0 else 0.0

        summary = {
            "camera_id": self.camera_id,
            "frames_processed": frame_idx,
            "elapsed_seconds": round(elapsed, 2),
            "processing_fps": round(self._fps_processing, 1),
            "last_vehicle_count": self._last_detection_count,
            "last_congestion_factor": self._last_congestion_factor,
        }
        logger.info(f"Pipeline finished: {summary}")
        return summary

    # ------------------------------------------------------------------
    # Telemetry dispatch
    # ------------------------------------------------------------------

    async def _send_telemetry(self, metrics) -> None:
        """POST congestion metrics to the FlowSense backend."""
        url = f"{self.api_url}/api/v1/cameras/{self.camera_id}/telemetry"
        payload = {
            "camera_id": self.camera_id,
            "vehicle_count": metrics.vehicle_count,
            "average_speed_kmh": metrics.average_speed_kmh,
            "congestion_factor": metrics.congestion_factor,
        }

        try:
            import json
            import urllib.request

            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )

            def _post():
                with urllib.request.urlopen(req, timeout=5.0) as resp:
                    return resp.status, resp.read().decode("utf-8")

            status_code, body = await asyncio.to_thread(_post)
            if status_code == 200:
                logger.debug(f"Telemetry sent: CF={metrics.congestion_factor}")
            else:
                logger.warning(f"Telemetry POST returned {status_code}: {body}")
        except Exception as e:
            logger.debug(f"Telemetry send failed (backend may be offline): {e}")

    # ------------------------------------------------------------------
    # Frame annotation for debug visualisation
    # ------------------------------------------------------------------

    @staticmethod
    def annotate_frame(
        frame: np.ndarray,
        tracked_vehicles: List[TrackedVehicle],
    ) -> np.ndarray:
        """
        Draw bounding boxes, track IDs, and speed estimates on a frame copy.
        """
        annotated = frame.copy()

        # Colour palette per class
        colours = {
            "car": (0, 255, 100),       # green
            "bus": (255, 165, 0),        # orange
            "truck": (50, 100, 255),     # blue
            "motorcycle": (200, 50, 200),  # purple
        }

        for v in tracked_vehicles:
            x, y, w, h = v.bbox
            colour = colours.get(v.class_name, (255, 255, 255))

            # Bounding box
            cv2.rectangle(annotated, (x, y), (x + w, y + h), colour, 2)

            # Label: ID + class + speed
            label = f"ID:{v.track_id} {v.class_name} {v.estimated_speed_kmh:.0f}km/h"
            label_y = max(y - 8, 15)
            cv2.putText(
                annotated, label, (x, label_y),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, colour, 2,
            )

        # HUD overlay: total count
        hud = f"Vehicles: {len(tracked_vehicles)}"
        cv2.putText(
            annotated, hud, (10, 30),
            cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2,
        )

        return annotated

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    def stop(self) -> None:
        """Request the pipeline to stop at the next frame boundary."""
        self._is_running = False

    def get_status(self) -> dict:
        """Return current pipeline status as a plain dict."""
        return {
            "camera_id": self.camera_id,
            "pipeline_active": self._is_running,
            "model_loaded": self.detector.model_path,
            "fps_processing": round(self._fps_processing, 1),
            "last_detection_count": self._last_detection_count,
            "last_congestion_factor": round(self._last_congestion_factor, 3),
        }
