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
    parser.add_argument(
        "--no-telemetry",
        action="store_true",
        help="Disable sending telemetry to backend (recommended when backend is not running)",
    )
    parser.add_argument(
        "--demo-route",
        action="store_true",
        help="Simulate and display dynamic A* emergency routing avoiding the video-detected traffic",
    )
    parser.add_argument(
        "--html-map",
        type=str,
        default="data/processed/traffic_route_demo.html",
        help="Path to generate the interactive Leaflet HTML map (default: data/processed/traffic_route_demo.html)",
    )
    parser.add_argument(
        "--open-map",
        action="store_true",
        help="Automatically open the interactive HTML routing map in your default browser",
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

    camera_id = args.camera_id
    if not camera_id or camera_id.lower() == "auto":
        import time as _t
        camera_id = f"CAM-AUTO-{int(_t.time()) % 1000:03d}"

    api_url = None if args.no_telemetry else args.api_url
    pipeline = PerceptionPipeline(
        detector=detector,
        tracker=tracker,
        estimator=estimator,
        camera_id=camera_id,
        api_url=api_url,
    )

    # Run pipeline
    logger.info(f"Starting perception on: {args.video}")
    logger.info(f"Camera ID: {camera_id} | Backend: {args.backend} | Skip: {args.skip_frames}")

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

    # Run dynamic A* emergency routing demo if requested
    if args.demo_route or args.open_map:
        from src.perception.route_demo import run_route_simulation

        print("\n" + "=" * 60)
        print("  FlowSense Dynamic A* Routing — Emergency Simulation")
        print("=" * 60)
        route_res = run_route_simulation(
            camera_id=camera_id,
            congestion_factor=summary.get("last_congestion_factor", 0.4),
            vehicle_count=summary.get("last_vehicle_count", 15),
            output_html_path=args.html_map,
            open_browser=args.open_map,
        )
        print(f"  Camera Assigned.................... {route_res['camera_id']} ({route_res['camera_name']})")
        print(f"  Camera Coordinates................. {route_res['camera_coords']}")
        print(f"  Traffic Congestion Level........... {route_res['congestion_factor']*100:.0f}% ({route_res['vehicle_count']} vehicles)")
        print(f"  Naive Static Route ETA............. {route_res['baseline_eta_s']} s ({route_res['baseline_distance_m']} m)")
        print(f"  FlowSense Dynamic A* Route ETA..... {route_res['route_eta_s']} s ({route_res['route_distance_m']} m)")
        print(f"  Time Saved with FlowSense.......... {route_res['savings_pct']}% faster")
        print(f"  Route Status....................... {route_res['status']}")
        if "html_path" in route_res:
            print(f"  Interactive HTML Map Saved......... {route_res['html_path']}")
        print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
