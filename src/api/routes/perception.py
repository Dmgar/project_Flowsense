"""
API routes for the FlowSense Perception Engine and advanced dispatch operations.
"""
import logging
from typing import List

from fastapi import APIRouter, HTTPException, Query, status

from src.models.schemas import (
    DispatchRequest,
    RouteResponse,
    AlternativeRoutesResponse,
    FleetDispatchRequest,
    PerceptionStatus,
)
from src.services.routing_engine import routing_engine

logger = logging.getLogger("flowsense.api.perception")

router = APIRouter(tags=["Perception & Advanced Routing"])


# ======================================================================
# Perception pipeline endpoints
# ======================================================================

# In-memory pipeline registry (populated when a pipeline is started)
_active_pipelines: dict = {}


@router.get(
    "/perception/status",
    response_model=List[PerceptionStatus],
    summary="Get status of all active perception pipelines",
)
async def get_perception_status():
    """Returns the current status of all running perception pipelines."""
    statuses: List[PerceptionStatus] = []
    for camera_id, pipeline in _active_pipelines.items():
        st = pipeline.get_status()
        statuses.append(PerceptionStatus(**st))
    return statuses


@router.post(
    "/perception/start",
    summary="Start a perception pipeline for a camera",
    status_code=status.HTTP_200_OK,
)
async def start_perception_pipeline(
    camera_id: str = Query(default="CAM-NYC-MID-01", description="Camera ID to bind the pipeline to"),
    video_source: str = Query(default="0", description="Video file path, RTSP URL, or webcam index"),
    skip_frames: int = Query(default=3, ge=0, le=30, description="Detection every N frames"),
    backend: str = Query(default="opencv_dnn", description="Inference backend: opencv_dnn | onnxruntime"),
):
    """
    Start an OpenCV perception pipeline for a specified camera.

    .. note::
        This endpoint initialises the pipeline but does **not** block.
        The actual frame processing runs asynchronously and pushes telemetry
        to ``/api/v1/cameras/{camera_id}/telemetry`` automatically.
    """
    if camera_id in _active_pipelines:
        return {
            "status": "already_running",
            "camera_id": camera_id,
            "message": f"Pipeline for {camera_id} is already active.",
        }

    try:
        from src.core.config import settings
        from src.perception.detector import VehicleDetector
        from src.perception.tracker import VehicleTracker
        from src.perception.congestion_estimator import CongestionEstimator
        from src.perception.pipeline import PerceptionPipeline

        model_path = str(settings.PERCEPTION_MODEL_PATH)

        detector = VehicleDetector(
            model_path=model_path,
            confidence_threshold=settings.PERCEPTION_CONFIDENCE,
            nms_threshold=settings.PERCEPTION_NMS_THRESHOLD,
            backend=backend,
        )
        tracker = VehicleTracker(
            pixels_per_meter=settings.PERCEPTION_PIXELS_PER_METER,
        )
        estimator = CongestionEstimator()

        pipeline = PerceptionPipeline(
            detector=detector,
            tracker=tracker,
            estimator=estimator,
            camera_id=camera_id,
            api_url="http://localhost:8000",
        )

        _active_pipelines[camera_id] = pipeline

        # Note: The actual video processing should be launched via asyncio.create_task
        # in a production system.  For now we register the pipeline as ready.
        return {
            "status": "initialized",
            "camera_id": camera_id,
            "video_source": video_source,
            "message": f"Pipeline registered for {camera_id}. Use scripts/run_perception.py for full video processing.",
        }

    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ONNX model file not found. Run 'python scripts/download_model.py' first.",
        )
    except Exception as e:
        logger.error(f"Failed to start perception pipeline: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Pipeline initialization failed: {str(e)}",
        )


@router.post(
    "/perception/stop",
    summary="Stop an active perception pipeline",
)
async def stop_perception_pipeline(
    camera_id: str = Query(default="CAM-NYC-MID-01", description="Camera ID of the pipeline to stop"),
):
    """Stop the perception pipeline for a given camera."""
    if camera_id not in _active_pipelines:
        return {"status": "not_running", "camera_id": camera_id}

    pipeline = _active_pipelines.pop(camera_id)
    pipeline.stop()
    return {"status": "stopped", "camera_id": camera_id}


# ======================================================================
# Advanced dispatch endpoints
# ======================================================================

@router.get(
    "/dispatch/alternatives",
    response_model=AlternativeRoutesResponse,
    summary="Compute K alternative emergency corridors",
)
async def compute_alternative_routes(
    origin_lat: float = Query(..., description="Origin latitude"),
    origin_lon: float = Query(..., description="Origin longitude"),
    dest_lat: float = Query(..., description="Destination latitude"),
    dest_lon: float = Query(..., description="Destination longitude"),
    vehicle_type: str = Query(default="ambulance"),
    k: int = Query(default=3, ge=1, le=5, description="Number of routes to return"),
):
    """
    Returns the primary optimal corridor plus up to K-1 alternative routes,
    each with an overlap percentage against the primary.
    """
    from src.models.schemas import Coordinates

    request = DispatchRequest(
        origin=Coordinates(latitude=origin_lat, longitude=origin_lon),
        destination=Coordinates(latitude=dest_lat, longitude=dest_lon),
        vehicle_type=vehicle_type,
    )
    try:
        return routing_engine.calculate_alternative_routes(request, k=k)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Alternative routing failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Routing failed.")


@router.post(
    "/dispatch/fleet",
    response_model=List[RouteResponse],
    summary="Multi-vehicle fleet optimisation (NSGA-II placeholder)",
)
async def dispatch_fleet(fleet_request: FleetDispatchRequest):
    """
    Compute optimised routes for multiple simultaneous emergency vehicles.

    .. note::
        Currently uses independent A* routing per vehicle.
        Full NSGA-II multi-objective optimisation is planned for a future iteration.
    """
    try:
        return routing_engine.optimize_fleet_routes(fleet_request)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Fleet dispatch failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Fleet dispatch failed.")
