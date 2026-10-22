"""Compare full-frame and inbound-crop inference on the same night video.

This reports model predictions and tracker continuity, not ground-truth accuracy.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import time

import cv2

from src.core.config import settings
from src.perception.detector import VehicleDetector
from src.perception.road_tracking import RoadTracker, in_road_zone
from src.perception.traffic_detector import TrafficDetector, reject_headlight_fragments
from src.services.video_service import BDD_CLASSES


def compare(video, zone_file, output, camera_id, stride):
    video, zone_file, output = Path(video), Path(zone_file), Path(output)
    profile = json.loads(zone_file.read_text(encoding="utf-8"))[camera_id]
    capture = cv2.VideoCapture(str(video))
    fps = capture.get(cv2.CAP_PROP_FPS) or 15
    frames, frame_index = [], 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if frame_index % stride == 0:
            frames.append((frame_index / fps, frame))
        frame_index += 1
    capture.release()
    if not frames:
        raise RuntimeError(f"No readable video frames found in {video}.")

    model = VehicleDetector(
        str(settings.VIDEO_LOW_LIGHT_MODEL_PATH), confidence_threshold=0.10,
        backend=settings.PERCEPTION_BACKEND, class_names=BDD_CLASSES,
        num_classes=10, input_size=settings.VIDEO_LOW_LIGHT_INPUT_SIZE)
    road_detector = TrafficDetector(model)
    paths = {
        "full_frame": lambda frame: reject_headlight_fragments(model.detect(frame)),
        "inbound_crop": lambda frame: reject_headlight_fragments(road_detector.detect(frame, profile)),
    }
    results = {}
    for name, infer in paths.items():
        tracker = RoadTracker(fps=fps)
        durations, candidates, zone_candidates = [], [], []
        inbound_observations, eligible_observations = [], []
        candidate_classes, track_classes = Counter(), Counter()
        for instant, frame in frames:
            started = time.perf_counter()
            detections = infer(frame)
            durations.append(time.perf_counter() - started)
            inside = [item for item in detections if in_road_zone(item.bbox, frame.shape, profile)]
            tracked = tracker.update(detections, frame, instant, {**profile, "low_light": True})
            eligible = [item for item in tracked if item["track_confidence"] >= 0.20]
            candidates.append(len(detections))
            zone_candidates.append(len(inside))
            inbound_observations.append(len(tracked))
            eligible_observations.append(len(eligible))
            candidate_classes.update(item.class_name for item in inside)
            track_classes.update(item["class"] for item in eligible)
        results[name] = {
            "model_candidate_count": sum(candidates),
            "road_zone_candidate_count": sum(zone_candidates),
            "frames_with_road_zone_candidates": sum(count > 0 for count in zone_candidates),
            "inbound_track_observations": sum(inbound_observations),
            "frames_with_inbound_tracks": sum(count > 0 for count in inbound_observations),
            "track_observations_at_low_light_threshold": sum(eligible_observations),
            "frames_with_tracks_at_low_light_threshold": sum(count > 0 for count in eligible_observations),
            "maximum_simultaneous_tracks": max(eligible_observations, default=0),
            "road_zone_candidate_classes": dict(candidate_classes),
            "track_classes": dict(track_classes),
            "mean_inference_seconds": round(sum(durations) / len(durations), 4),
        }
    report = {
        "video": str(video), "decoded_frames": frame_index, "sampled_frames": len(frames),
        "sample_stride": stride, "sample_interval_seconds": round(stride / fps, 3),
        "camera_id": camera_id, "zone_revision": profile.get("revision"),
        "comparison": results,
        "ground_truth": "No independently labeled boxes; this measures model output and track continuity only.",
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", default="output/detection-audit/night-source.mp4")
    parser.add_argument("--zone-file", default="data/camera_analysis_zones.json")
    parser.add_argument("--camera", default="caltrans-d7-cctv-1031")
    parser.add_argument("--stride", type=int, default=6)
    parser.add_argument("--output", default="output/detection-audit/night-road-crop-comparison.json")
    args = parser.parse_args()
    compare(args.video, args.zone_file, args.output, args.camera, args.stride)


if __name__ == "__main__":
    main()
