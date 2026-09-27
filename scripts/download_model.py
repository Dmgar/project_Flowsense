"""
Download and cache the YOLOv8n ONNX model for FlowSense perception.

Usage:
    python scripts/download_model.py
    python scripts/download_model.py --model yolov8s  # small variant
    python scripts/download_model.py --output models/custom_name.onnx
"""
import argparse
import logging
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("flowsense.download_model")

# ONNX Model mirrors (Hugging Face community repository mirrors)
MODEL_URLS = {
    "yolov8n": [
        "https://huggingface.co/Kalray/yolov8/resolve/main/yolov8n.onnx",
    ],
    "yolov8s": [
        "https://huggingface.co/Kalray/yolov8/resolve/main/yolov8s.onnx",
    ],
}


def download_file(url: str, dest: Path) -> None:
    """Download a file with a progress indicator using urllib (stdlib)."""
    import urllib.request

    dest.parent.mkdir(parents=True, exist_ok=True)
    temp_dest = dest.with_suffix(".tmp")

    logger.info(f"Downloading {url}")
    logger.info(f"Destination: {dest}")

    req = urllib.request.Request(url, headers={"User-Agent": "FlowSense/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            total = int(response.headers.get("Content-Length", 0))
            downloaded = 0

            with open(temp_dest, "wb") as f:
                while True:
                    chunk = response.read(8192)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total > 0:
                        pct = downloaded / total * 100
                        bar_len = 40
                        filled = int(bar_len * downloaded / total)
                        bar = "=" * filled + "-" * (bar_len - filled)
                        print(f"\r  [{bar}] {pct:5.1f}%  ({downloaded / 1e6:.1f}/{total / 1e6:.1f} MB)", end="", flush=True)

        print()  # newline after progress bar
        temp_dest.replace(dest)
        logger.info(f"Download complete: {dest}  ({dest.stat().st_size / 1e6:.1f} MB)")
    except Exception:
        if temp_dest.exists():
            temp_dest.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description="Download YOLOv8 ONNX model for FlowSense")
    parser.add_argument(
        "--model",
        choices=list(MODEL_URLS.keys()),
        default="yolov8n",
        help="Model variant to download (default: yolov8n)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output path (default: models/<model>.onnx)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download even if the file already exists",
    )

    args = parser.parse_args()

    output = Path(args.output) if args.output else Path(f"models/{args.model}.onnx")

    if output.exists() and output.stat().st_size > 1024 * 1024 and not args.force:
        logger.info(f"Model already exists at {output} ({output.stat().st_size / 1e6:.1f} MB). Use --force to re-download.")
        return

    urls = MODEL_URLS[args.model]
    download_success = False
    for url in urls:
        try:
            download_file(url, output)
            download_success = True
            break
        except Exception as e:
            logger.warning(f"Failed to download from {url}: {e}")

    if not download_success:
        logger.error(
            f"Could not download model from any mirror.\n"
            f"Alternatively, install ultralytics (`pip install ultralytics`) and export manually:\n"
            f"    yolo export model={args.model}.pt format=onnx"
        )
        sys.exit(1)

    # Quick validation: check file is a valid ONNX
    try:
        import onnxruntime as ort  # type: ignore
        session = ort.InferenceSession(str(output), providers=["CPUExecutionProvider"])
        inp = session.get_inputs()[0]
        logger.info(f"Model validated: input='{inp.name}', shape={inp.shape}, dtype={inp.type}")
    except ImportError:
        logger.info("onnxruntime not installed -- skipping model validation.")
    except Exception as e:
        logger.warning(f"Model validation failed: {e}")


if __name__ == "__main__":
    main()
