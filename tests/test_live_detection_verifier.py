from pathlib import Path

import cv2
import numpy as np

from scripts.verify_live_detection import AnnotatedVideoWriter, resolve_output_directory, summarize_class_evidence


def test_live_detection_runs_default_to_separate_evidence_folders():
    first = resolve_output_directory(None, "run-a")
    second = resolve_output_directory(None, "run-b")

    assert first == Path("output/detection-audit/live-detection-run-a")
    assert second == Path("output/detection-audit/live-detection-run-b")
    assert first != second


def test_live_detection_verifier_respects_an_explicit_output_directory():
    assert resolve_output_directory("output/custom-review") == Path("output/custom-review")


def test_live_detection_class_report_keeps_provisional_hints_separate_from_labels():
    result = summarize_class_evidence([
        {"metrics": {"detections": [
            {"class": "car", "class_status": "stable"},
            {"class": "vehicle", "class_status": "uncertain", "candidate_class": "truck"},
            {"class": "vehicle", "class_status": "uncertain", "candidate_class": "bus"},
        ]}},
        {"metrics": {"detections": [{"class": "vehicle", "class_status": "uncertain", "candidate_class": "truck"}]}},
    ])

    assert result == {
        "class_box_observations": {"car": 1, "vehicle": 3},
        "uncertain_box_observations": 3,
        "candidate_class_box_observations": {"bus": 1, "truck": 2},
    }


def test_live_detection_evidence_is_a_decodable_multiframe_video(tmp_path):
    path = tmp_path / "live-detection-annotated.mp4"
    writer = AnnotatedVideoWriter(path, fps=5)
    try:
        writer.write(np.zeros((48, 64, 3), dtype=np.uint8))
        writer.write(np.full((48, 64, 3), 180, dtype=np.uint8))
        writer.write(np.full((48, 64, 3), 40, dtype=np.uint8))
    finally:
        writer.close()

    capture = cv2.VideoCapture(str(path))
    assert capture.isOpened()
    assert round(capture.get(cv2.CAP_PROP_FPS)) == 5
    frames = 0
    while True:
        ok, _ = capture.read()
        if not ok:
            break
        frames += 1
    capture.release()
    assert frames == 3
