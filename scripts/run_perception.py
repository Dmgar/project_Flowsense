"""
Run the FlowSense perception pipeline on a video file or camera stream.

Usage:
    python scripts/run_perception.py \\
        --video data/sample_videos/traffic_clip.mp4 \\
        --model models/yolov8n.onnx \\
        --camera-id CAM-NYC-MID-01 \\
        --api-url http://localhost:8000 \\
        --visualize

    # Webcam:
    python scripts/run_perception.py --video 0 --model models/yolov8n.onnx --visualize
"""
import argparse
import asyncio
import logging
import sys
from pathlib import Path

# Ensure project root is on sys.path for imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.perception.detector import VehicleDetector
from src.perception.tracker import VehicleTracker
from src.perception.congestion_estimator import CongestionEstimator
from src.perception.pipeline import PerceptionPipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("flowsense.run_perception")


def main():
    parser = argparse.ArgumentParser(
        description="FlowSense Perception Pipeline — process traffic video and extract congestion signals"
    )
    parser.add_argument(
        "--video", "-v",
        required=True,
        help="Path to video file, RTSP URL, or webcam index (e.g., '0')",
    )
    parser.add_argument(
        "--model", "-m",
        default="models/yolov8n.onnx",
        help="Path to ONNX model file (default: models/yolov8n.onnx)",
    )
    parser.add_argument(
        "--camera-id", "-c",
        default="CAM-NYC-MID-01",
        help="Camera ID to report telemetry as (default: CAM-NYC-MID-01)",
    )
    parser.add_argument(
        "--api-url", "-u",
        default="http://localhost:8000",
        help="FlowSense backend URL (default: http://localhost:8000)",
    )
    parser.add_argument(
        "--confidence",
        type=float,
        default=0.45,
        help="Detection confidence threshold (default: 0.45)",
    )
    parser.add_argument(
        "--skip-frames",
        type=int,
        default=3,
        help="Process detection every N frames (default: 3)",
    )
    parser.add_argument(
        "--backend",
        choices=["opencv_dnn", "onnxruntime"],
        default="opencv_dnn",
        help="Inference backend (default: opencv_dnn)",
    )
    parser.add_argument(
        "--max-frames",
        type=int,
        default=None,
        help="Stop after N frames (default: process entire video)",
    )
    parser.add_argument(
        "--telemetry-interval",
        type=int,
        default=10,
        help="Send telemetry every N detection cycles (default: 10)",
    )
    parser.add_argument(
        "--visualize",
        action="store_true",
        help="Show annotated video window with bounding boxes and IDs",
    )
    parser.add_argument(
        "--optical-flow",
        action="store_true",
        help="Enable Farneback optical flow for global velocity estimation",
    )

    args = parser.parse_args()

    # Validate model exists
    model_path = Path(args.model)
    if not model_path.exists():
        logger.error(
            f"Model file not found: {model_path}\n"
            f"Run 'python scripts/download_model.py' to download it."
        )
        sys.exit(1)

    # Validate video source (if it's a file path)
    if not args.video.isdigit() and not args.video.startswith(("rtsp://", "http://", "https://")):
        if not Path(args.video).exists():
            logger.error(f"Video file not found: {args.video}")
            sys.exit(1)

    # Build pipeline components
    logger.info("Initializing perception pipeline components...")

    detector = VehicleDetector(
        model_path=str(model_path),
        confidence_threshold=args.confidence,
        nms_threshold=0.5,
        backend=args.backend,
    )

    tracker = VehicleTracker(
        max_age=15,
        iou_threshold=0.3,
        pixels_per_meter=12.0,
        use_optical_flow=args.optical_flow,
    )

    estimator = CongestionEstimator(
        max_density=50,
        free_flow_speed=45.0,
    )

    pipeline = PerceptionPipeline(
        detector=detector,
        tracker=tracker,
        estimator=estimator,
        camera_id=args.camera_id,
        api_url=args.api_url,
    )

    # Run pipeline
    logger.info(f"Starting perception on: {args.video}")
    logger.info(f"Camera ID: {args.camera_id} | Backend: {args.backend} | Skip: {args.skip_frames}")

    summary = asyncio.run(
        pipeline.process_video(
            source=args.video,
            skip_frames=args.skip_frames,
            max_frames=args.max_frames,
            visualize=args.visualize,
            telemetry_interval=args.telemetry_interval,
        )
    )

    # Print summary
    print("\n" + "=" * 60)
    print("  FlowSense Perception Pipeline — Run Summary")
    print("=" * 60)
    for k, v in summary.items():
        print(f"  {k:.<35} {v}")
    print("=" * 60)


if __name__ == "__main__":
    main()
