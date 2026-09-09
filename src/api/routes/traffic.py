import logging
from fastapi import APIRouter, HTTPException, status
from src.models.schemas import TrafficSignalUpdate, BatchTrafficUpdate
from src.services.graph_service import graph_service
from src.api.websockets.connection_manager import manager
from src.models.telemetry import WebSocketMessage, TelemetryEventType

logger = logging.getLogger("flowsense.api.traffic")
router = APIRouter(prefix="/traffic", tags=["Traffic Perception Ingestion"])

@router.post("/update", status_code=status.HTTP_200_OK)
async def update_traffic_signal(signal: TrafficSignalUpdate):
    """
    Ingests real-time perception signal from OpenCV engine for a specific road segment.
    Recalculates dynamic impedance W_e immediately.
    """
    updated = graph_service.update_edge_congestion(
        u=signal.u,
        v=signal.v,
        key=signal.key,
        congestion_factor=signal.congestion_factor,
        vehicle_count=signal.vehicle_count,
        average_speed_kmh=signal.average_speed_kmh
    )

    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Edge ({signal.u}, {signal.v}, key={signal.key}) not found in the urban network."
        )

    # Broadcast update to connected dashboard clients
    await manager.broadcast(
        WebSocketMessage(
            event=TelemetryEventType.TRAFFIC_UPDATE,
            data={"updated_edges": [signal.model_dump()]}
        )
    )

    return {
        "status": "success",
        "message": f"Congestion factor on segment ({signal.u}->{signal.v}) updated to {signal.congestion_factor}",
        "edge": {"u": signal.u, "v": signal.v, "congestion": signal.congestion_factor}
    }

@router.post("/batch", status_code=status.HTTP_200_OK)
async def batch_update_traffic(batch: BatchTrafficUpdate):
    """
    Ingests batch of road segment metrics from multiple traffic cameras or aggregate frame processing.
    """
    applied = 0
    not_found = []

    for signal in batch.updates:
        success = graph_service.update_edge_congestion(
            u=signal.u,
            v=signal.v,
            key=signal.key,
            congestion_factor=signal.congestion_factor,
            vehicle_count=signal.vehicle_count,
            average_speed_kmh=signal.average_speed_kmh
        )
        if success:
            applied += 1
        else:
            not_found.append((signal.u, signal.v))

    # Broadcast batch update
    if applied > 0:
        await manager.broadcast(
            WebSocketMessage(
                event=TelemetryEventType.TRAFFIC_UPDATE,
                data={"updated_edges": [s.model_dump() for s in batch.updates]}
            )
        )

    return {
        "status": "success",
        "processed_count": len(batch.updates),
        "applied_count": applied,
        "failed_edges": not_found
    }
