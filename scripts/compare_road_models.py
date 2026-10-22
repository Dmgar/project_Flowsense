"""Compare detectors on identical unannotated video, zone and tracking rules.

Outputs describe predictions and timing, not ground-truth accuracy.
"""
import json
from pathlib import Path
import time
import cv2
from src.perception.detector import VehicleDetector
from src.perception.traffic_detector import TrafficDetector
from src.perception.road_tracking import RoadTracker, in_road_zone
from src.services.video_service import CLASSES


def main():
    root = Path("output/detection-audit")
    cap = cv2.VideoCapture(str(root / "approach-model-input.mp4"))
    frames = []
    index = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if index % 5 == 0:
            frames.append((index / 15, frame))
        index += 1
    cap.release()
    if not frames:
        raise RuntimeError("Record an unannotated camera segment first.")
    profile = json.loads(Path("data/camera_analysis_zones.json").read_text())["caltrans-d7-cctv-1031"]
    reports = []
    for name in ("yolov8s", "yolo11s", "yolo26s"):
        detector = TrafficDetector(VehicleDetector(f"models/{name}.onnx", confidence_threshold=.10, class_names=CLASSES))
        tracker = RoadTracker(fps=15)
        records, durations, seen, types = [], [], {}, {}
        for sample, (instant, frame) in enumerate(frames):
            start = time.perf_counter()
            raw = detector.detect(frame)
            durations.append(time.perf_counter() - start)
            tracked = tracker.update(raw, frame, instant, profile)
            for box in tracked:
                seen[box["id"]] = seen.get(box["id"], 0) + 1
                types[box["id"]] = box["class"]
            eligible = [d for d in raw if d.confidence >= .3 and in_road_zone(d.bbox, frame.shape, profile)]
            records.append({"time": instant,
                "raw": [{"class": d.class_name, "score": d.confidence, "bbox": d.bbox} for d in eligible],
                "tracks": [{key: box[key] for key in ("id", "class", "confidence", "bbox", "class_status")} for box in tracked]})
            if sample in (12, 24, 36):
                rendered = frame.copy()
                for d in eligible:
                    x, y, w, h = d.bbox
                    cv2.rectangle(rendered, (x, y), (x + w, y + h), (50, 255, 80), 2)
                    cv2.putText(rendered, f"{d.class_name} {d.confidence:.2f}", (x, max(15, y - 4)), 0, .5, (50, 255, 80), 1)
                cv2.imwrite(str(root / f"compare-road-{name}-{sample}.jpg"), rendered)
        report = {"model": name, "frames": len(frames), "mean_inference_seconds": sum(durations) / len(durations),
            "raw_in_zone_above_30_percent": sum(len(r["raw"]) for r in records),
            "tracked_observations": sum(seen.values()), "track_ids": len(seen),
            "track_final_classes": {c: sum(v == c for v in types.values()) for c in set(types.values())},
            "accuracy": "Not measured against independently annotated ground truth.", "records": records}
        reports.append(report)
        print(json.dumps({k: v for k, v in report.items() if k != "records"}), flush=True)
    (root / "paired-road-model-comparison.json").write_text(json.dumps(reports, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
