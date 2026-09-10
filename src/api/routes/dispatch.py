import asyncio
import logging
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, status
from src.models.schemas import DispatchRequest, RouteResponse
from src.services.routing_engine import routing_engine
from src.services.mock_simulator import simulator
from src.api.websockets.connection_manager import manager
from src.models.telemetry import WebSocketMessage, TelemetryEventType

logger = logging.getLogger("flowsense.api.dispatch")
router = APIRouter(prefix="/dispatch", tags=["Emergency Dispatch & Dynamic Routing"])

@router.post("/route", response_model=RouteResponse, status_code=status.HTTP_200_OK)
async def compute_emergency_route(
    request: DispatchRequest,
    background_tasks: BackgroundTasks,
    simulate: bool = Query(default=False, description="Simulate vehicle dispatch and live telemetry")
):
    """
    Computes an optimal dynamic corridor for an emergency vehicle, avoiding congestion in real time.
    """
    try:
        route = routing_engine.calculate_emergency_route(request, simulate=simulate)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Routing calculation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Routing failed.")

    # Broadcast new route to Leaflet dashboard
    await manager.broadcast(
        WebSocketMessage(
            event=TelemetryEventType.ROUTE_UPDATE,
            data=route.model_dump()
        )
    )

    # Optionally launch background simulation for live vehicle movement
    if simulate:
        background_tasks.add_task(simulator.run_mission_simulation, route, f"EMS-{request.vehicle_type.upper()}")

    return route

@router.post("/simulate/traffic/start")
async def start_simulated_traffic(interval_seconds: float = 3.0):
    """Starts background simulated traffic variations."""
    if not simulator.is_simulating_traffic:
        asyncio.create_task(simulator.start_traffic_simulation(interval_seconds=interval_seconds))
        return {"status": "started", "interval_seconds": interval_seconds}
    return {"status": "already_running"}

@router.post("/simulate/traffic/stop")
async def stop_simulated_traffic():
    """Stops background simulated traffic variations."""
    simulator.stop_traffic_simulation()
    return {"status": "stopped"}
