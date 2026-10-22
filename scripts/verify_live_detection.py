"""Check actual model + tracker + compositor on a public video source.

Writes a short annotated MP4 locally for QA; it does not enter production
evidence storage. This measures visible model output, not precision/recall
against annotated ground truth.
"""
import argparse
import asyncio
from collections import Counter
from fractions import Fraction
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import time

import av

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.services.mobility_service import mobility_service
from src.services.video_service import VideoService, VideoSession
from src.services.detection_store import DetectionStore
from src.perception.road_tracking import in_road_zone
from src.perception.audit import direction_audit_counts
from src.core.config import settings

ANNOTATED_VIDEO_FPS = 5


class AnnotatedVideoWriter:
    """Write a paced MP4 from the actual annotated session output frames."""
    def __init__(self, path, fps=ANNOTATED_VIDEO_FPS):
        self.path = Path(path)
        self.fps = fps
        self.container = None
        self.stream = None
        self.frames_written = 0

    def write(self, frame):
        if self.container is None:
            height, width = frame.shape[:2]
            self.container = av.open(str(self.path), "w", options={"movflags": "+faststart"})
            self.stream = self.container.add_stream("libx264", rate=self.fps)
            self.stream.width = width // 2 * 2
            self.stream.height = height // 2 * 2
            self.stream.pix_fmt = "yuv420p"
            self.stream.options = {"preset": "veryfast", "crf": "28"}
        video_frame = av.VideoFrame.from_ndarray(frame, format="bgr24")
        video_frame.pts = self.frames_written
        video_frame.time_base = Fraction(1, self.fps)
        for packet in self.stream.encode(video_frame):
            self.container.mux(packet)
        self.frames_written += 1

    def close(self):
        if self.container is None:
            return
        for packet in self.stream.encode():
            self.container.mux(packet)
        self.container.close()
        self.container = self.stream = None


def resolve_output_directory(output_directory=None, run_id=None):
    if output_directory is not None:
        return Path(output_directory)
    run_id = run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    return Path("output/detection-audit") / f"live-detection-{run_id}"


def summarize_class_evidence(readings):
    """Count sampled box labels and provisional hints without treating hints as labels."""
    labels, suggestions = Counter(), Counter()
    uncertain = 0
    for reading in readings:
        metrics = reading.get("metrics") or {}
        for box in metrics.get("detections") or []:
            labels[box.get("class", "unknown")] += 1
            uncertain += box.get("class_status") != "stable"
            candidate = box.get("candidate_class")
            if candidate:
                suggestions[candidate] += 1
    return {
        "class_box_observations": dict(sorted(labels.items())),
        "uncertain_box_observations": uncertain,
        "candidate_class_box_observations": dict(sorted(suggestions.items())),
    }


async def verify(camera_id, seconds, output_directory=None):
    camera = mobility_service.cameras[camera_id]
    output = resolve_output_directory(output_directory)
    output.mkdir(parents=True, exist_ok=True)
    engine = VideoService(DetectionStore(output / "directional-runtime", record_video=False))
    session = VideoSession(camera, engine.infer, inference_gate=engine.model_lock,
        observation_store=engine.observation_store, model_name=settings.VIDEO_MODEL_PATH.name, zone_aware_inference=True)
    readings, maximum = [], -1
    video_path = output / "live-detection-annotated.mp4"
    video_writer = AnnotatedVideoWriter(video_path)
    last_video_sequence = -1
    last_video_write = 0.0
    try:
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline and session.status()["counts"] is None:
            await asyncio.sleep(.1)
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            status = session.status()
            readings.append(status)
            count = sum((status["counts"] or {}).values())
            with session.lock:
                if session.output is not None and count > maximum:
                    maximum = count
                sample = session.output
                frame = None
                if (sample is not None and sample[0] != last_video_sequence
                        and time.monotonic() - last_video_write >= 1 / ANNOTATED_VIDEO_FPS):
                    last_video_sequence = sample[0]
                    last_video_write = time.monotonic()
                    frame = sample[2].copy()
            if frame is not None:
                video_writer.write(frame)
            await asyncio.sleep(.2)
        video_writer.close()
        measured = [item for item in readings if item["counts"] is not None]
        classes = sorted({name for item in measured for name, count in item["counts"].items() if count})
        class_evidence = summarize_class_evidence(measured)
        outside = sum(not in_road_zone(box["bbox"], (item["metrics"]["height"], item["metrics"]["width"]), session.zone)
            for item in measured for box in item["metrics"]["detections"])
        direction_counts = direction_audit_counts(
            box for item in measured for box in item["metrics"]["detections"]
        ) if session.zone.get("enabled") else {"approaching": 0, "checking": 0, "wrong_direction": 0}
        stable = {}
        class_flips = 0
        for item in measured:
            for box in item["metrics"]["detections"]:
                if box.get("class_status") != "stable":
                    continue
                key = (item["metrics"]["generation"], box["id"])
                if key in stable and stable[key] != box["class"]:
                    class_flips += 1
                stable[key] = box["class"]
        report = {"camera_id": camera_id, "seconds": seconds, "sample_count": len(readings),
                  "samples_with_analysis": len(measured),
                  "samples_with_visible_detections": sum(any(item["counts"].values()) for item in measured),
                  "classes_observed": classes, "max_simultaneous_objects": maximum,
                  **class_evidence,
                  "zone": session.zone, "outside_zone_boxes": outside,
                  "approaching_boxes": direction_counts["approaching"],
                  "direction_checking_boxes": direction_counts["checking"],
                  "wrong_direction_boxes": direction_counts["wrong_direction"],
                  "stable_class_flips": class_flips,
                  "annotated_video": str(video_path),
                  "annotated_video_frames": video_writer.frames_written,
                  "annotated_video_fps": ANNOTATED_VIDEO_FPS,
                  "accuracy_claim": "No ground-truth precision/recall measurement. Review the annotated video visually.",
                  "readings": readings}
        (output / "live-detection.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({key: value for key, value in report.items() if key != "readings"}, indent=2))
        if not classes:
            raise RuntimeError("No visible detections were produced during this video check.")
        if video_writer.frames_written < 2:
            raise RuntimeError("The camera check did not produce enough changing frames for an annotated video.")
        assert outside == direction_counts["wrong_direction"] == class_flips == 0
    finally:
        video_writer.close()
        await session.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera", default="caltrans-d7-cctv-1031")
    parser.add_argument("--seconds", type=int, default=30)
    parser.add_argument("--output", help="Output directory (defaults to a new timestamped folder).")
    args = parser.parse_args()
    asyncio.run(verify(args.camera, args.seconds, args.output))


if __name__ == "__main__":
    main()
