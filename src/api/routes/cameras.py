import logging
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, status

from src.models.schemas import CameraDevice, CameraTelemetryReport
from src.services.camera_service import camera_service

logger = logging.getLogger("flowsense.api.cameras")
router = APIRouter(prefix="/cameras", tags=["OpenCV Traffic Cameras Inventory & Ingestion"])

@router.get("", response_model=List[CameraDevice], status_code=status.HTTP_200_OK)
async def list_cameras():
    """
    Returns the inventory of municipal CCTV traffic cameras deployed in Manhattan.
    """
    return camera_service.get_all_cameras()

@router.get("/geojson", response_model=Dict[str, Any], status_code=status.HTTP_200_OK)
async def get_cameras_geojson():
    """
    Returns traffic cameras as a GeoJSON FeatureCollection with coordinates and live metrics,
    ready for map layer toggle in Leaflet.js.
    """
    return camera_service.to_geojson()

@router.get("/{camera_id}", response_model=CameraDevice, status_code=status.HTTP_200_OK)
async def get_camera_by_id(camera_id: str):
    cam = camera_service.get_camera(camera_id)
    if not cam:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID '{camera_id}' not found."
        )
    return cam

@router.post("/{camera_id}/telemetry", response_model=CameraDevice, status_code=status.HTTP_200_OK)
async def ingest_camera_telemetry(camera_id: str, report: CameraTelemetryReport):
    """
    Lightweight ingestion endpoint for OpenCV 5 pipeline.
    Receives vehicle counts and velocity per processed video frame, updates graph weights,
    and streams updates to dashboard clients.
    """
    if report.camera_id != camera_id:
        report.camera_id = camera_id

    updated_cam = await camera_service.ingest_telemetry(report)
    if not updated_cam:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID '{camera_id}' not found in registry."
        )
    return updated_cam
