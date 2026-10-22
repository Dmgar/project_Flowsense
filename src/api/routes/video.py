"""Video-only camera sessions. Camera sources are resolved server-side."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator
from typing import Literal

from src.services.mobility_service import mobility_service
from src.services.video_service import video_service

router = APIRouter(prefix="/mobility/video", tags=["Continuous camera video"])


@router.post("/prepare-restart")
async def prepare_restart():
    """Close active evidence clips cleanly before the local service restarts."""
    return await video_service.prepare_restart()


@router.post("/cancel-restart")
async def cancel_restart():
    """Resume normal clip recording when a planned restart is abandoned."""
    return await video_service.cancel_restart()


@router.post("/prune-evidence")
async def prune_evidence(force: bool = False):
    """Trigger video evidence retention cleanup while protecting active viewers and reviewed tracks."""
    import asyncio
    if not video_service.observation_store:
        raise HTTPException(503, "Observation store is unavailable.")
    return await asyncio.to_thread(video_service.observation_store.prune_unprotected_evidence, force=force)


@router.get("/road-observations")
async def observed_roads():
    import asyncio
    from src.services.camera_traffic import road_observations
    from src.services.graph_service import graph_service
    mobility_service.refresh_route_metadata()
    async with video_service.lock:
        active_camera_ids = tuple(camera_id for camera_id, session in video_service.sessions.items()
                                  if not session.stop_event.is_set()
                                  and session.state in {"Live", "Recorded playback"})
    return await asyncio.to_thread(road_observations, video_service.observation_store,
                                   mobility_service.cameras, None, active_camera_ids,
                                   graph_service.get_graph_for_camera,
                                   {camera_id: health for camera_id in mobility_service.cameras
                                    if (health := mobility_service._cached_video_health(camera_id))})


@router.get("/analysis-zones")
async def analysis_zone_coverage():
    """Report which continuous video sources have directional zone calibration."""
    import asyncio

    def collect():
        mobility_service.refresh_route_metadata()
        items = []
        for camera in mobility_service.cameras.values():
            if not camera.get("stream_url"):
                continue
            zone = video_service.observation_store.zone(camera["id"])
            enabled = bool(zone.get("enabled"))
            route_metadata_available = bool(camera.get("route") and camera.get("direction"))
            ready = enabled and route_metadata_available
            if ready:
                status = "ready"
            elif not enabled and not route_metadata_available:
                status = "zone_and_metadata_required"
            elif not enabled:
                status = "zone_required"
            else:
                status = "route_metadata_required"
            items.append({
                "camera_id": camera["id"],
                "name": camera.get("name", camera["id"]),
                "route": camera.get("route"),
                "direction": camera.get("direction"),
                "zone_enabled": enabled,
                "zone_revision": int(zone.get("revision", 0)),
                "route_metadata_available": route_metadata_available,
                "ready_for_road_analysis": ready,
                "status": status,
                "source_health": mobility_service._cached_video_health(camera["id"]),
            })
        # This is a point-in-time observation only. Never probe idle sources or
        # treat an old HLS response as proof that video is currently advancing.
        for item in items:
            capture = video_service.capture_status(item["camera_id"])
            sample_age = capture.get("sample_age_seconds")
            live = (capture.get("active") is True
                    and capture.get("session_state") in {"Live", "Recorded playback"}
                    and capture.get("frames_decoded", 0) > 0
                    and isinstance(sample_age, (int, float)) and sample_age <= 8)
            item["playback_verified"] = live
            item["playback_session_state"] = capture.get("session_state") if live else None
        items.sort(key=lambda item: (item["ready_for_road_analysis"], item["name"].casefold()))
        ready_count = sum(item["ready_for_road_analysis"] for item in items)
        zone_required = sum(not item["zone_enabled"] for item in items)
        metadata_required = sum(not item["route_metadata_available"] for item in items)
        return {"video_camera_count": len(items), "calibrated_count": ready_count,
                "calibration_required_count": len(items) - ready_count,
                "zone_required_count": zone_required,
                "route_metadata_required_count": metadata_required,
                "source_health_policy_version": 1,
                "cameras": items}

    return await asyncio.to_thread(collect)


@router.get("/cameras/{camera_id}/summary")
async def monitoring_summary(camera_id: str, since: str | None = None):
    mobility_service.refresh_route_metadata()
    if camera_id not in mobility_service.cameras:
        raise HTTPException(404, "Camera not found.")
    from datetime import datetime, timezone
    import asyncio
    from src.services.camera_traffic import road_context
    from src.services.graph_service import graph_service
    try:
        start = datetime.fromisoformat((since or video_service.started_at).replace("Z", "+00:00"))
        if start.tzinfo is None or start.timestamp() > datetime.now(timezone.utc).timestamp() + 10:
            raise ValueError()
    except ValueError:
        raise HTTPException(422, "Use an ISO timestamp with timezone that is not in the future.") from None
    result = await asyncio.to_thread(video_service.observation_store.summary, camera_id, start.astimezone(timezone.utc).isoformat())
    result["capture_status"] = video_service.capture_status(camera_id)
    camera = mobility_service.cameras[camera_id]
    result["road"] = await asyncio.to_thread(road_context, camera,
                                              graph_service.get_graph_for_camera(camera),
                                              video_service.observation_store)
    return result


@router.get("/cameras/{camera_id}/capture-status")
async def camera_capture_status(camera_id: str):
    """Return live decoder and inference health without scanning saved history."""
    if camera_id not in mobility_service.cameras:
        raise HTTPException(404, "Camera not found.")
    return video_service.capture_status(camera_id)


class MonitoringLease(BaseModel):
    client_id: str = Field(min_length=8, max_length=80, pattern=r"^[a-zA-Z0-9-]+$")


@router.post("/cameras/{camera_id}/monitoring")
async def start_monitoring(camera_id: str, payload: MonitoringLease):
    camera = mobility_service.cameras.get(camera_id)
    if not camera or not camera.get("stream_url"):
        raise HTTPException(404, "Video camera not found.")
    if camera.get("provider") == "Caltrans" and camera.get("provider_stream_available") is False:
        raise HTTPException(409, "Caltrans is not currently publishing a video stream for this camera.")
    try:
        return await video_service.monitor(camera, payload.client_id)
    except OverflowError as error:
        raise HTTPException(429, str(error)) from None


@router.delete("/cameras/{camera_id}/monitoring/{client_id}")
async def stop_monitoring(camera_id: str, client_id: str):
    return await video_service.stop_monitor(camera_id, client_id)


@router.get("/cameras/{camera_id}/history")
async def history(camera_id: str, limit: int = 100, include_legacy: bool = False):
    if camera_id not in mobility_service.cameras:
        raise HTTPException(404, "Camera not found.")
    if not 1 <= limit <= 500:
        raise HTTPException(422, "History limit must be between 1 and 500.")
    import asyncio
    return await asyncio.to_thread(video_service.observation_store.history, camera_id, limit, include_legacy)


@router.get("/cameras/{camera_id}/clips")
async def clip_history(camera_id: str, limit: int = 30, before_created_at: str | None = None,
                       before_id: str | None = None, include_earlier_zones: bool = False):
    if camera_id not in mobility_service.cameras:
        raise HTTPException(404, "Camera not found.")
    if not 1 <= limit <= 100:
        raise HTTPException(422, "Clip page size must be between 1 and 100.")
    if bool(before_created_at) != bool(before_id):
        raise HTTPException(422, "Both clip cursor fields are required.")
    if before_created_at:
        from datetime import datetime
        try:
            datetime.fromisoformat(before_created_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(422, "Clip cursor must contain an ISO timestamp.") from None
        if len(before_id) != 32 or any(character not in "0123456789abcdef" for character in before_id):
            raise HTTPException(422, "Clip cursor ID is invalid.")
    import asyncio
    cursor = {"created_at": before_created_at, "id": before_id} if before_created_at else None
    return await asyncio.to_thread(video_service.observation_store.clip_history, camera_id, limit,
                                   cursor, include_earlier_zones)


class TrackFeedback(BaseModel):
    reviewed_class: Literal["car", "truck", "bus", "motorcycle", "bicycle", "pedestrian", "rider", "vehicle", "false_positive"]


@router.put("/cameras/{camera_id}/tracks/{session_id}/{generation}/{track_id}/feedback")
async def review_track(camera_id: str, session_id: str, generation: int, track_id: int, payload: TrackFeedback):
    if camera_id not in mobility_service.cameras:
        raise HTTPException(404, "Camera not found.")
    if generation < 1 or track_id < 1:
        raise HTTPException(422, "Generation and track IDs must be positive.")
    import asyncio
    result = await asyncio.to_thread(video_service.observation_store.review_track, camera_id,
                                     session_id, generation, track_id, payload.reviewed_class)
    if result is None:
        raise HTTPException(404, "Saved detection not found.")
    return result


class AnalysisZone(BaseModel):
    enabled: bool = True
    name: str = Field(default="Approaching carriageway", min_length=1, max_length=70)
    polygon: list[tuple[float, float]] = Field(min_length=3, max_length=12)
    direction: tuple[float, float]
    minimum_motion: float = Field(default=.008, ge=.003, le=.1)
    counting_line_y: float = Field(default=.64, ge=.15, le=.9)
    counting_line: tuple[tuple[float, float], tuple[float, float]] | None = None

    @model_validator(mode="after")
    def validate_geometry(self):
        import cv2
        import numpy as np
        polygon = np.asarray(self.polygon, np.float32)
        if not np.isfinite(polygon).all() or np.any(polygon < 0) or np.any(polygon > 1):
            raise ValueError("Zone points must be finite normalized coordinates between zero and one.")
        if not cv2.isContourConvex(polygon) or cv2.contourArea(polygon) < .005:
            raise ValueError("Use a convex, non-crossing road polygon with meaningful area.")
        if self.counting_line is not None:
            gate = np.asarray(self.counting_line, np.float32)
            if (not np.isfinite(gate).all() or np.any(gate < 0) or np.any(gate > 1)
                    or np.linalg.norm(gate[1] - gate[0]) < .03):
                raise ValueError("Counting-line endpoints must be distinct normalized frame coordinates.")
        direction = np.asarray(self.direction)
        if not np.isfinite(direction).all() or np.linalg.norm(direction) < .1 or np.linalg.norm(direction) > 2:
            raise ValueError("Select a meaningful direction vector.")
        return self


@router.get("/cameras/{camera_id}/analysis-zone")
async def analysis_zone(camera_id: str):
    if camera_id not in mobility_service.cameras:
        raise HTTPException(404, "Camera not found.")
    return video_service.observation_store.zone(camera_id)


@router.put("/cameras/{camera_id}/analysis-zone")
async def set_analysis_zone(camera_id: str, payload: AnalysisZone):
    if camera_id not in mobility_service.cameras:
        raise HTTPException(404, "Camera not found.")
    import asyncio
    profile = await asyncio.to_thread(video_service.observation_store.set_zone, camera_id, payload.model_dump())
    session = video_service.sessions.get(camera_id)
    if session:
        with session.lock:
            session.zone = profile
            session.generation += 1
            session.latest = session.analysis = None
            session.analysis_history.clear()
    return profile


@router.get("/clips/{clip_id}")
async def evidence_clip(clip_id: str):
    if len(clip_id) != 32 or any(character not in "0123456789abcdef" for character in clip_id):
        raise HTTPException(404, "Video evidence not found.")
    path = video_service.observation_store.clip_path(clip_id)
    if path is None:
        raise HTTPException(404, "Video evidence is not ready or unavailable.")
    return FileResponse(path, media_type="video/mp4", filename=f"flowsense-{clip_id}.mp4", content_disposition_type="inline")


class Offer(BaseModel):
    sdp: str = Field(min_length=10, max_length=65536)
    type: Literal["offer"]


class Filters(BaseModel):
    confidence: float = Field(ge=.10, le=.95)
    classes: list[Literal["car", "motorcycle", "bus", "truck", "bicycle", "pedestrian", "rider", "vehicle"]] = Field(max_length=8)
    show_candidates: bool = True


@router.post("/cameras/{camera_id}/offer")
async def offer(camera_id: str, payload: Offer):
    camera = mobility_service.cameras.get(camera_id)
    if not camera:
        raise HTTPException(404, "Camera not found.")
    try:
        return await video_service.offer(camera, payload.sdp, payload.type)
    except OverflowError as error:
        raise HTTPException(429, str(error)) from None
    except ValueError as error:
        raise HTTPException(400, str(error)) from None
    except Exception:
        raise HTTPException(503, "Could not establish the video session.") from None


@router.get("/viewers/{viewer_id}")
async def reading(viewer_id: str):
    try:
        return video_service.reading(viewer_id)
    except KeyError:
        raise HTTPException(404, "Video session expired. Reconnect to continue.") from None


@router.patch("/viewers/{viewer_id}/settings")
async def filters(viewer_id: str, payload: Filters):
    entry = video_service.peers.get(viewer_id)
    if not entry:
        raise HTTPException(404, "Video session expired. Reconnect to continue.")
    session = entry[1]
    with session.lock:
        session.filters_customized = True
        session.settings = {"confidence": payload.confidence, "classes": list(dict.fromkeys(payload.classes))}
    return video_service.reading(viewer_id)


@router.delete("/viewers/{viewer_id}")
async def leave(viewer_id: str):
    await video_service.leave(viewer_id)
    return {"status": "closed"}
