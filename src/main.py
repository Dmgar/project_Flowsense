import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware

from src.core.config import settings
from src.api.routes.mobility import router as mobility_router
from src.services.graph_service import graph_service
from src.services.incident_intelligence import incident_intelligence
from src.services.mock_simulator import simulator
from src.api.websockets.connection_manager import manager
from src.api.routes import (
    traffic_router,
    dispatch_router,
    graph_router,
    benchmark_router,
    replay_router,
    signals_router,
    cameras_router,
    perception_router,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("flowsense.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing FlowSense Urban Graph Engine...")
    graph_service.initialize()
    # Restore active, human-verified incidents after a backend restart.
    for candidate in incident_intelligence.list():
        if candidate.status == "validated" and not candidate.demo:
            graph_service.report_incident(
                incident_id=candidate.incident_id,
                lat=candidate.latitude,
                lon=candidate.longitude,
                radius_m=candidate.radius_m,
                block_traffic=True,
            )
    status = graph_service.get_status()
    logger.info(f"Graph initialized: {status.node_count} nodes, {status.edge_count} edges for {status.city}.")
    yield
    logger.info("Shutting down FlowSense services...")
    simulator.stop_traffic_simulation()
    try:
        from src.api.routes.perception import _active_pipelines
        for pipe in _active_pipelines.values():
            pipe.stop()
    except Exception as e:
        logger.warning(f"Error stopping perception pipelines: {e}")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Public camera evidence, aggregate mobility intelligence, human-reviewed cases and emergency corridor decision support.",
    lifespan=lifespan
)

# Enable CORS for dashboard web access
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount REST API Routers
app.include_router(traffic_router, prefix=settings.API_V1_STR)
app.include_router(dispatch_router, prefix=settings.API_V1_STR)
app.include_router(graph_router, prefix=settings.API_V1_STR)
app.include_router(benchmark_router, prefix=settings.API_V1_STR)
app.include_router(replay_router, prefix=settings.API_V1_STR)
app.include_router(signals_router, prefix=settings.API_V1_STR)
app.include_router(cameras_router, prefix=settings.API_V1_STR)
app.include_router(perception_router, prefix=settings.API_V1_STR)
app.include_router(mobility_router, prefix=settings.API_V1_STR)

# Real-Time WebSocket Telemetry Channel
@app.websocket("/ws/telemetry")
async def telemetry_websocket(websocket: WebSocket):
    """
    WebSocket channel for the Leaflet.js dashboard.
    Streams real-time road congestion states and emergency vehicle mission telemetry.
    Protects against Cross-Site WebSocket Hijacking (CSWSH) and frame flooding.
    """
    origin = websocket.headers.get("origin")
    if origin:
        normalized_origin = origin.rstrip("/")
        allowed_origins = [o.rstrip("/") for o in settings.ALLOWED_ORIGINS if o != "*"]
        if allowed_origins and normalized_origin not in allowed_origins:
            logger.warning(f"Rejected unauthorized WebSocket origin: {origin}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    connected = await manager.connect(websocket)
    if not connected:
        return

    try:
        while True:
            # Keep connection alive, listen for client messages / pings with 8KB limit and 45s idle timeout
            data = await asyncio.wait_for(websocket.receive_text(), timeout=45.0)
            if len(data.encode("utf-8")) > 8192:
                logger.warning("WebSocket client exceeded 8KB frame limit. Terminating.")
                await websocket.close(code=status.WS_1009_MESSAGE_TOO_BIG)
                break
            if data.strip() == "ping":
                await websocket.send_text('{"type":"pong"}')
            logger.debug(f"Received from WebSocket client: {data}")
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    except Exception as e:
        logger.warning(f"WebSocket client terminated with error: {e}")
    finally:
        await manager.disconnect(websocket)

@app.get("/", tags=["Health Check"])
async def root():
    status = graph_service.get_status()
    return {
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "pilot_city": settings.PILOT_CITY,
        "status": "operational",
        "nodes": status.node_count,
        "edges": status.edge_count,
        "docs_url": "/docs"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)
