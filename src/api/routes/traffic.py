import uuid
import logging
import statistics
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query, Response, status
from src.models.schemas import TrafficSignalUpdate, BatchTrafficUpdate, IncidentReport, IncidentCandidateInput, FloodReportInput
from src.services.graph_service import graph_service
from src.services.incident_intelligence import incident_intelligence
from src.services.flood_intelligence import flood_intelligence
from src.api.websockets.connection_manager import manager
from src.models.telemetry import WebSocketMessage, TelemetryEventType, MissionAlertEvent

logger = logging.getLogger("flowsense.api.traffic")
router = APIRouter(prefix="/traffic", tags=["Traffic Perception Ingestion"])

@router.get("/flood-reports")
async def list_flood_reports():
    """List operator-observed water depth reports for this city profile."""
    return [item.model_dump() for item in flood_intelligence.list()]

@router.post("/flood-reports")
async def create_flood_report(report: FloodReportInput):
    """Add an unverified water-depth observation; pending observations do not change routes."""
    return flood_intelligence.create(report).model_dump()

@router.post("/flood-reports/{report_id}/confirm")
async def confirm_flood_report(report_id: str):
    try:
        report = flood_intelligence.update_status(report_id, "confirmed")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if report is None:
        raise HTTPException(status_code=404, detail="Flood report not found.")
    await manager.broadcast(WebSocketMessage(event=TelemetryEventType.MISSION_ALERT, data=MissionAlertEvent(
        message=f"Inundación confirmada · {report.depth_cm:.0f} cm · expira {report.expires_at}", severity="warning"
    ).model_dump()))
    return report.model_dump()

@router.post("/flood-reports/{report_id}/dismiss")
async def dismiss_flood_report(report_id: str):
    try:
        report = flood_intelligence.update_status(report_id, "false_alarm")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if report is None:
        raise HTTPException(status_code=404, detail="Flood report not found.")
    return report.model_dump()

@router.post("/flood-reports/{report_id}/clear")
async def clear_flood_report(report_id: str):
    try:
        report = flood_intelligence.update_status(report_id, "cleared")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if report is None:
        raise HTTPException(status_code=404, detail="Flood report not found.")
    return report.model_dump()

@router.get("/detections")
async def list_incident_candidates():
    """List camera event candidates and their operator-review state."""
    return [candidate.model_dump() for candidate in incident_intelligence.list()]

@router.post("/detections")
async def analyze_incident_candidate(evidence: IncidentCandidateInput):
    """Triage camera evidence; this does not alter routing until an operator validates it."""
    candidate = incident_intelligence.analyze(evidence)
    return candidate.model_dump()

@router.post("/detections/{incident_id}/validate")
async def validate_incident_candidate(incident_id: str):
    """Human validation applies an incident's impact to the live road graph."""
    candidate = incident_intelligence.get(incident_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Incident candidate not found.")
    if candidate.status != "pending_review":
        raise HTTPException(status_code=409, detail=f"Candidate is already {candidate.status}.")
    severity = "critical" if candidate.urgency == "crítica" else "warning"
    affected_nodes, affected_edges = graph_service.report_incident(
        incident_id=incident_id, lat=candidate.latitude, lon=candidate.longitude,
        radius_m=candidate.radius_m, block_traffic=True,
    )
    candidate.status = "validated"
    candidate.validated_at = datetime.now(timezone.utc).isoformat()
    candidate.affected_edges_count = affected_edges
    incident_intelligence.save(candidate)
    alert = MissionAlertEvent(
        message=f"{candidate.label} validado · {candidate.confidence:.0%} de score de evidencia · {affected_edges} vías afectadas",
        severity=severity,
    )
    await manager.broadcast(WebSocketMessage(event=TelemetryEventType.MISSION_ALERT, data=alert.model_dump()))
    await manager.broadcast(WebSocketMessage(event=TelemetryEventType.TRAFFIC_UPDATE, data={
        "incident_id": incident_id, "nodes": affected_nodes, "status": "blocked",
    }))
    return {**candidate.model_dump(), "alert_broadcasted": True}

@router.post("/detections/{incident_id}/dismiss")
async def dismiss_incident_candidate(incident_id: str):
    """Mark a candidate as a false alarm without changing the road graph."""
    candidate = incident_intelligence.get(incident_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Incident candidate not found.")
    if candidate.status != "pending_review":
        raise HTTPException(status_code=409, detail=f"Candidate is already {candidate.status}.")
    candidate.status = "false_alarm"
    incident_intelligence.save(candidate)
    return candidate.model_dump()

@router.get("/metrics/response")
async def incident_response_metrics():
    """Return operational KPIs that agencies can use to evaluate a pilot."""
    candidates = [c for c in incident_intelligence.list() if not c.demo]
    reviewed = [c for c in candidates if c.status in {"validated", "cleared", "false_alarm"}]
    verified = [c for c in candidates if c.validated_at]

    def elapsed(start: str, end: str) -> float:
        return max(0.0, (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds())

    verify_times = [elapsed(c.created_at, c.validated_at) for c in verified if c.validated_at]
    clear_times = [elapsed(c.validated_at, c.cleared_at) for c in candidates if c.validated_at and c.cleared_at]
    flood_reports = flood_intelligence.list()
    confirmed_floods = [r for r in flood_reports if r.status == "confirmed" and not r.demo]
    return {
        "period": "all_time",
        "candidate_count": len(candidates),
        "verified_count": len(verified),
        "false_alarm_count": sum(c.status == "false_alarm" for c in reviewed),
        "false_alarm_rate_pct": round(100 * sum(c.status == "false_alarm" for c in reviewed) / len(reviewed), 1) if reviewed else None,
        "median_verify_seconds": round(statistics.median(verify_times)) if verify_times else None,
        "average_clear_seconds": round(statistics.mean(clear_times)) if clear_times else None,
        "active_verified_count": sum(c.status == "validated" for c in candidates),
        "published_feed_count": sum(c.status == "validated" for c in candidates),
        "flood_reports_count": sum(not report.demo for report in flood_reports),
        "active_confirmed_flood_count": len(confirmed_floods),
        "demo_records_excluded": True,
    }

@router.get("/feeds/cifs")
async def export_cifs_feed(
    format: str = Query(default="json", pattern="^(json|xml)$"),
    include_demo: bool = Query(default=False, description="Include synthetic demo incidents for feed testing"),
):
    """Generate a Waze CIFS-compatible feed of validated, currently active incidents."""
    active = [c for c in incident_intelligence.list()
              if c.status == "validated" and (include_demo or not c.demo)]
    active_floods = [r for r in flood_intelligence.routing_reports() if include_demo or not r.demo]
    items = []
    for c in active:
        if c.event_type == "collision":
            kind, subtype = "ACCIDENT", "ACCIDENT_MAJOR" if c.urgency == "crítica" else "ACCIDENT_MINOR"
        elif c.event_type == "flooding":
            kind, subtype = "HAZARD", "HAZARD_WEATHER_FLOOD"
        elif c.event_type == "stopped_vehicle":
            kind, subtype = "HAZARD", "HAZARD_ON_ROAD_CAR_STOPPED"
        elif c.event_type == "road_obstruction":
            kind, subtype = "HAZARD", "HAZARD_ON_ROAD_OBJECT"
        elif c.event_type == "smoke_fire":
            kind, subtype = "HAZARD", "HAZARD_ON_ROAD"
        else:
            kind, subtype = "HAZARD", "HAZARD_ON_ROAD"
        point = f"{c.latitude:.6f} {c.longitude:.6f} {c.latitude:.6f} {c.longitude:.6f}"
        items.append({
            "id": c.incident_id, "type": kind, "subtype": subtype,
            "polyline": point, "description": f"{c.label} · incidente verificado por {c.camera_id}",
            "direction": "BOTH_DIRECTIONS", "creationtime": c.created_at,
            "starttime": c.validated_at or c.created_at,
        })
    for report in active_floods:
        point = f"{report.latitude:.6f} {report.longitude:.6f} {report.latitude:.6f} {report.longitude:.6f}"
        items.append({
            "id": report.report_id, "type": "HAZARD", "subtype": "HAZARD_WEATHER_FLOOD",
            "polyline": point,
            "description": f"Inundación confirmada por operador · {report.depth_cm:.0f} cm de profundidad",
            "direction": "BOTH_DIRECTIONS", "creationtime": report.created_at,
            "starttime": report.confirmed_at or report.created_at,
        })
    if format == "json":
        import json
        return Response(content=json.dumps({"incidents": items}, ensure_ascii=False), media_type="application/json",
                        headers={"Content-Disposition": "attachment; filename=flowsense-cifs.json"})
    root = ET.Element("incidents")
    for item in items:
        incident = ET.SubElement(root, "incident", {"id": item["id"]})
        for key in ("type", "subtype", "polyline", "description", "direction", "creationtime", "starttime"):
            ET.SubElement(incident, key).text = item[key]
    xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    return Response(content=xml, media_type="application/xml",
                    headers={"Content-Disposition": "attachment; filename=flowsense-cifs.xml"})

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

    candidate = incident_intelligence.get(incident_id)
    if candidate is not None:
        candidate.status = "cleared"
        candidate.cleared_at = datetime.now(timezone.utc).isoformat()
        incident_intelligence.save(candidate)

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
