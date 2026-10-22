"""Verify the six road-user classes against labeled, real COCO128 examples.

Requires the public Ultralytics coco128.zip in output/detection-audit/. This is
a class smoke check, not a held-out accuracy benchmark or live-camera test.
"""
from collections import defaultdict
import json
from pathlib import Path
import zipfile

import cv2
import numpy as np

from src.core.config import settings
from src.perception.detector import VehicleDetector
from src.perception.traffic_detector import TrafficDetector
from src.perception.tracker import _iou
from src.services.video_service import CLASSES, COLORS


def main():
    root = Path("output/detection-audit")
    dataset = root / "coco128.zip"
    candidates = defaultdict(list)
    detector = TrafficDetector(VehicleDetector(str(settings.PERCEPTION_MODEL_PATH), confidence_threshold=.15,
                                               backend=settings.PERCEPTION_BACKEND, class_names=CLASSES))
    results = []
    with zipfile.ZipFile(dataset) as archive:
        names = set(archive.namelist())
        for name in sorted(names):
            if "/labels/" not in name or not name.endswith(".txt"):
                continue
            image_name = name.replace("/labels/", "/images/").removesuffix(".txt") + ".jpg"
            if image_name not in names:
                continue
            for row in archive.read(name).decode().splitlines():
                values = row.split()
                if len(values) != 5 or int(values[0]) not in CLASSES:
                    continue
                cx, cy, width, height = map(float, values[1:])
                candidates[int(values[0])].append((width * height, image_name, (cx, cy, width, height)))
        for class_id, label in CLASSES.items():
            matched = None
            for _, image_name, ground_truth in sorted(candidates[class_id], reverse=True)[:5]:
                frame = cv2.imdecode(np.frombuffer(archive.read(image_name), np.uint8), cv2.IMREAD_COLOR)
                height, width = frame.shape[:2]
                cx, cy, bw, bh = ground_truth
                expected = ((cx - bw / 2) * width, (cy - bh / 2) * height, bw * width, bh * height)
                detections = detector.detect(frame)
                matches = [item for item in detections if item.class_id == class_id and item.confidence >= .2 and _iou(item.bbox, expected) >= .35]
                if not matches:
                    continue
                best = max(matches, key=lambda item: item.confidence)
                matched = {"class": label, "image": image_name, "confidence": best.confidence,
                           "ground_truth_iou": round(_iou(best.bbox, expected), 3)}
                for item in detections:
                    if item.confidence < .2:
                        continue
                    x, y, w, h = item.bbox
                    color = COLORS[item.class_name]
                    cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
                    cv2.putText(frame, f"{item.class_name} {item.confidence:.0%}", (max(0, x), max(20, y - 5)), 0, .6, color, 2)
                cv2.imwrite(str(root / f"class-{label}.jpg"), frame)
                break
            results.append(matched or {"class": label, "error": "No matching labeled example detected."})
    report = {"dataset": "Ultralytics COCO128 real labeled images", "confidence_threshold": .2,
              "minimum_ground_truth_iou": .35, "results": results,
              "scope": "Class smoke check only; COCO training examples are not a held-out accuracy benchmark."}
    (root / "class-verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if any("error" in item for item in results):
        raise RuntimeError("One or more supported classes failed the real-image smoke check.")


if __name__ == "__main__":
    main()
