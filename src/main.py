import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from src.core.config import settings
from src.services.graph_service import graph_service
from src.services.mock_simulator import simulator
from src.api.websockets.connection_manager import manager
from src.api.routes import (
    traffic_router,
    dispatch_router,
    graph_router,
    benchmark_router,
    replay_router,
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
    status = graph_service.get_status()
    logger.info(f"Graph initialized: {status.node_count} nodes, {status.edge_count} edges for {status.city}.")
    yield
    logger.info("Shutting down FlowSense services...")
    simulator.stop_traffic_simulation()

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Priority Routing & Perception Backend for Emergency Response Vehicles (Ambulances & Fire Trucks).",
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

# Real-Time WebSocket Telemetry Channel
@app.websocket("/ws/telemetry")
async def telemetry_websocket(websocket: WebSocket):
    """
    WebSocket channel for the Leaflet.js dashboard.
    Streams real-time road congestion states and emergency vehicle mission telemetry.
    """
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive, listen for client messages / pings
            data = await websocket.receive_text()
            logger.debug(f"Received from WebSocket client: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"WebSocket client terminated with error: {e}")
        manager.disconnect(websocket)

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
