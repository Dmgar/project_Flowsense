import uuid
import logging
from fastapi import APIRouter, HTTPException, status
from src.models.schemas import TrafficSignalUpdate, BatchTrafficUpdate, IncidentReport
from src.services.graph_service import graph_service
from src.api.websockets.connection_manager import manager
from src.models.telemetry import WebSocketMessage, TelemetryEventType, MissionAlertEvent

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

@router.post("/incident", response_model=dict, status_code=status.HTTP_200_OK)
async def report_incident(incident: IncidentReport):
    """
    Injects a real-time localized road blockage or accident.
    Broadcasts high-priority mission_alert and traffic_update over WebSockets.
    """
    incident_id = f"inc_{uuid.uuid4().hex[:6]}"
    affected_nodes, affected_edges = graph_service.report_incident(
        incident_id=incident_id,
        lat=incident.latitude,
        lon=incident.longitude,
        radius_m=incident.radius_m,
        block_traffic=incident.block_traffic
    )

    alert = MissionAlertEvent(
        message=f"{incident.description} (Radio {int(incident.radius_m)}m - {affected_edges} vías afectadas)",
        severity=incident.severity
    )

    # Broadcast mission_alert to dashboard AlertsFeed
    await manager.broadcast(
        WebSocketMessage(
            event=TelemetryEventType.MISSION_ALERT,
            data=alert.model_dump()
        )
    )

    # Broadcast updated street network state
    await manager.broadcast(
        WebSocketMessage(
            event=TelemetryEventType.TRAFFIC_UPDATE,
            data={"incident_id": incident_id, "nodes": affected_nodes, "status": "blocked"}
        )
    )

    return {
        "incident_id": incident_id,
        "affected_nodes": affected_nodes,
        "affected_edges_count": affected_edges,
        "message": alert.message,
        "alert_broadcasted": True
    }

@router.post("/incident/{incident_id}/clear", status_code=status.HTTP_200_OK)
async def clear_incident(incident_id: str):
    """
    Clears an active incident and restores original corridor impedance.
    """
    cleared = graph_service.clear_incident(incident_id)
    if not cleared:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Active incident '{incident_id}' not found."
        )

    alert = MissionAlertEvent(
        message=f"Incidente {incident_id} despejado. Vía rehabilitada para tránsito prioritario.",
        severity="info"
    )

    await manager.broadcast(
        WebSocketMessage(
            event=TelemetryEventType.MISSION_ALERT,
            data=alert.model_dump()
        )
    )

    return {"status": "cleared", "incident_id": incident_id}
