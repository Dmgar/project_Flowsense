"""
Multi-object vehicle tracker for the FlowSense Perception Engine.

Uses IoU-based matching to associate detections across frames and maintain
persistent vehicle identities.  Optionally leverages OpenCV optical flow
(Farneback) for global flow velocity estimation.

Design decisions
----------------
* We avoid heavy deep-learning re-ID; simple IoU + centroid distance is
  sufficient for traffic cameras with mostly parallel flow.
* Speed estimation converts per-frame pixel displacement to km/h using a
  configurable calibration factor (pixels-per-meter).
"""
import logging
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from src.perception.models import Detection, TrackedVehicle

logger = logging.getLogger("flowsense.perception.tracker")


def _iou(box_a: Tuple[int, int, int, int], box_b: Tuple[int, int, int, int]) -> float:
    """Compute Intersection-over-Union between two (x, y, w, h) boxes."""
    ax, ay, aw, ah = box_a
    bx, by, bw, bh = box_b

    x1 = max(ax, bx)
    y1 = max(ay, by)
    x2 = min(ax + aw, bx + bw)
    y2 = min(ay + ah, by + bh)

    inter = max(0, x2 - x1) * max(0, y2 - y1)
    area_a = aw * ah
    area_b = bw * bh
    union = area_a + area_b - inter

    return inter / union if union > 0 else 0.0


def _centroid(bbox: Tuple[int, int, int, int]) -> Tuple[float, float]:
    """Return centre point of a (x, y, w, h) box."""
    x, y, w, h = bbox
    return (x + w / 2.0, y + h / 2.0)


class VehicleTracker:
    """
    Multi-object tracker that matches detections to existing tracks via IoU
    and assigns persistent IDs.

    Parameters
    ----------
    max_age : int
        Maximum number of frames a track may go unseen before being dropped.
    iou_threshold : float
        Minimum IoU to consider a detection-track match.
    pixels_per_meter : float
        Calibration constant to convert pixel displacement to real-world metres.
        Depends on camera angle and resolution; default is a rough estimate for
        a typical overhead traffic cam at ~8m height.
    fps : float
        Video frame rate, used together with ``pixels_per_meter`` to compute
        speed in km/h.
    use_optical_flow : bool
        Whether to compute global optical flow for aggregate velocity estimation.
    """

    def __init__(
        self,
        max_age: int = 15,
        iou_threshold: float = 0.3,
        pixels_per_meter: float = 12.0,
        fps: float = 30.0,
        use_optical_flow: bool = False,
    ):
        self.max_age = max_age
        self.iou_threshold = iou_threshold
        self.pixels_per_meter = pixels_per_meter
        self.fps = fps
        self.use_optical_flow = use_optical_flow

        self._next_id: int = 1
        self._tracks: Dict[int, TrackedVehicle] = {}
        self._prev_gray: Optional[np.ndarray] = None
        self._global_flow_speed: float = 0.0  # px/frame from optical flow

    # ------------------------------------------------------------------
    # Core tracking
    # ------------------------------------------------------------------

    def update(self, detections: List[Detection], frame: np.ndarray) -> List[TrackedVehicle]:
        """
        Update internal tracks with new detections and return currently active tracks.

        Parameters
        ----------
        detections : List[Detection]
            Current-frame detections from ``VehicleDetector.detect()``.
        frame : np.ndarray
            Current BGR frame (used for optical flow if enabled).

        Returns
        -------
        List[TrackedVehicle]
            Active tracked vehicles with updated positions and speed estimates.
        """
        det_centroids = [_centroid(d.bbox) for d in detections]

        # --- Greedy IoU matching ---
        matched_tracks: set[int] = set()
        matched_dets: set[int] = set()

        # Build cost matrix: track_id -> [(det_idx, iou)]
        matches: List[Tuple[int, int, float]] = []  # (track_id, det_idx, iou)
        for tid, track in self._tracks.items():
            for d_idx, det in enumerate(detections):
                score = _iou(track.bbox, det.bbox)
                if score >= self.iou_threshold:
                    matches.append((tid, d_idx, score))

        # Sort by IoU descending for greedy assignment
        matches.sort(key=lambda m: m[2], reverse=True)

        for tid, d_idx, score in matches:
            if tid in matched_tracks or d_idx in matched_dets:
                continue

            det = detections[d_idx]
            track = self._tracks[tid]

            old_cx, old_cy = track.centroid
            new_cx, new_cy = det_centroids[d_idx]
            displacement = np.hypot(new_cx - old_cx, new_cy - old_cy)
            velocity_px = displacement  # px/frame
            speed_kmh = (velocity_px / self.pixels_per_meter) * self.fps * 3.6

            track.bbox = det.bbox
            track.class_name = det.class_name
            track.centroid = (new_cx, new_cy)
            track.velocity_px_per_frame = round(velocity_px, 2)
            track.estimated_speed_kmh = round(speed_kmh, 1)
            track.age += 1
            track.frames_since_seen = 0

            matched_tracks.add(tid)
            matched_dets.add(d_idx)

        # --- Age out unmatched tracks ---
        for tid in list(self._tracks.keys()):
            if tid not in matched_tracks:
                self._tracks[tid].frames_since_seen += 1
                if self._tracks[tid].frames_since_seen > self.max_age:
                    del self._tracks[tid]

        # --- Create new tracks for unmatched detections ---
        for d_idx, det in enumerate(detections):
            if d_idx not in matched_dets:
                cx, cy = det_centroids[d_idx]
                new_track = TrackedVehicle(
                    track_id=self._next_id,
                    bbox=det.bbox,
                    class_name=det.class_name,
                    centroid=(cx, cy),
                    velocity_px_per_frame=0.0,
                    estimated_speed_kmh=0.0,
                    age=1,
                    frames_since_seen=0,
                )
                self._tracks[self._next_id] = new_track
                self._next_id += 1

        # --- Optional global optical flow ---
        if self.use_optical_flow:
            self._compute_optical_flow(frame)

        return list(self._tracks.values())

    # ------------------------------------------------------------------
    # Optical flow (aggregate velocity estimation)
    # ------------------------------------------------------------------

    def _compute_optical_flow(self, frame: np.ndarray) -> None:
        """
        Compute dense optical flow (Farneback) between current and previous
        frame to estimate global traffic movement speed.
        """
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        if self._prev_gray is not None:
            flow = cv2.calcOpticalFlowFarneback(
                self._prev_gray, gray,
                None,  # type: ignore[arg-type]
                pyr_scale=0.5, levels=3, winsize=15,
                iterations=3, poly_n=5, poly_sigma=1.2,
                flags=0,
            )
            # Compute magnitude of flow vectors
            mag, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
            self._global_flow_speed = float(np.median(mag))

        self._prev_gray = gray

    # ------------------------------------------------------------------
    # Public aggregation helpers
    # ------------------------------------------------------------------

    def get_active_count(self) -> int:
        """Number of currently active tracks."""
        return len(self._tracks)

    def get_average_flow_velocity(self) -> float:
        """
        Average speed (km/h) across all tracked vehicles.
        Falls back to optical flow estimate if no individual tracks are available.
        """
        active = [t for t in self._tracks.values() if t.frames_since_seen == 0]
        if active:
            speeds = [t.estimated_speed_kmh for t in active]
            return round(sum(speeds) / len(speeds), 1)

        # Fallback to optical flow global estimate
        if self.use_optical_flow and self._global_flow_speed > 0:
            return round((self._global_flow_speed / self.pixels_per_meter) * self.fps * 3.6, 1)

        return 0.0

    def reset(self) -> None:
        """Clear all tracks and reset state."""
        self._tracks.clear()
        self._next_id = 1
        self._prev_gray = None
        self._global_flow_speed = 0.0
