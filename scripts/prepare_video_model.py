"""Export the official YOLO26 small detector for the OpenCV video runtime.

Run with the isolated model-tools environment; Torch is not a runtime dependency.
"""
import hashlib
import json
from pathlib import Path


def main():
    import argparse
    from ultralytics import YOLO, __version__
    parser = argparse.ArgumentParser(description='Export an official Ultralytics model for local OpenCV inference.')
    parser.add_argument('--model', choices=['yolo26s', 'yolo11s'], default='yolo26s')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    target = root / "models"
    target.mkdir(exist_ok=True)
    model = YOLO(str(target / f"{args.model}.pt"))
    exported = Path(model.export(format="onnx", imgsz=640, opset=17, simplify=False, end2end=False))
    manifest = {"model": args.model, "input_size": 640, "output": "1x84x8400",
                "source": "https://github.com/ultralytics/assets",
                "ultralytics_version": __version__, "sha256": hashlib.sha256(exported.read_bytes()).hexdigest(),
                "license": "AGPL-3.0 (Ultralytics pretrained model)"}
    (target / f"video-model-{args.model}.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
