import logging
from typing import List
from fastapi import APIRouter, HTTPException, Query, status

from src.models.schemas import TrafficLightState
from src.services.signal_service import signal_service

logger = logging.getLogger("flowsense.api.signals")
router = APIRouter(prefix="/signals", tags=["Smart Traffic Lights & Green Wave"])

@router.get("", response_model=List[TrafficLightState], status_code=status.HTTP_200_OK)
async def list_all_traffic_signals():
    """
    Returns all urban traffic signal controllers and their current state (normal, preempted).
    """
    return signal_service.get_all_signals()

@router.get("/active", response_model=List[TrafficLightState], status_code=status.HTTP_200_OK)
async def list_active_green_wave_signals():
    """
    Returns only the intersections currently actively held on Green Wave preemption.
    """
    return signal_service.get_active_signals()

@router.post("/{node_id}/preempt", response_model=TrafficLightState, status_code=status.HTTP_200_OK)
async def preempt_traffic_signal(
    node_id: int,
    vehicle_id: str = Query(default="EMS-MEDIC-101", description="Vehicle identifier"),
    duration_seconds: float = Query(default=20.0, ge=5.0, le=120.0, description="Preemption hold duration")
):
    """
    Forces preemption on a specific intersection, turning conflicting approaches red
    and corridor approaches green.
    """
    sig = await signal_service.preempt_intersection(
        node_id=node_id,
        vehicle_id=vehicle_id,
        duration_s=duration_seconds
    )
    if not sig:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Traffic signal controller at node {node_id} not found."
        )
    return sig

@router.post("/{node_id}/release", response_model=TrafficLightState, status_code=status.HTTP_200_OK)
async def release_traffic_signal(node_id: int):
    """
    Releases preemption on an intersection, restoring normal cycle.
    """
    sig = await signal_service.release_intersection(node_id=node_id)
    if not sig:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Traffic signal controller at node {node_id} not found."
        )
    return sig
