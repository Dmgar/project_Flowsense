import asyncio
import logging
from typing import List
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, status
from src.models.schemas import (
    DispatchRequest,
    RouteResponse,
    AlternativeRoutesResponse,
    FleetDispatchRequest,
    RerouteRequest,
    ClearanceCorridorRequest,
)
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

@router.post("/alternatives", response_model=AlternativeRoutesResponse, status_code=status.HTTP_200_OK)
async def compute_alternative_routes(
    request: DispatchRequest,
    k: int = Query(default=3, ge=1, le=5, description="Total number of routes to return (1 primary + k-1 alternatives)")
):
    """
    Computes primary route alongside K-1 contingency alternative corridors
    with overlap percentage calculations.
    """
    try:
        return routing_engine.calculate_alternative_routes(request, k=k)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Alternative routes computation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Alternative routing failed.")

@router.post("/fleet", response_model=List[RouteResponse], status_code=status.HTTP_200_OK)
async def compute_fleet_dispatch(
    fleet_request: FleetDispatchRequest
):
    """
    Computes coordinated multi-vehicle dispatch routes for emergency fleets.
    """
    try:
        return routing_engine.optimize_fleet_routes(fleet_request)
    except Exception as e:
        logger.error(f"Fleet dispatch calculation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Fleet dispatch failed.")

@router.post("/reroute", response_model=RouteResponse, status_code=status.HTTP_200_OK)
async def reroute_in_transit(
    request: RerouteRequest
):
    """
    Dynamically recalculates the optimal corridor for an active emergency vehicle
    from its current intermediate GPS position to the final destination.
    Broadcasts ROUTE_RECALCULATED to Leaflet dashboard.
    """
    dispatch_req = DispatchRequest(
        origin=request.current_position,
        destination=request.destination,
        vehicle_type=request.vehicle_type,
        priority=request.priority
    )
    try:
        new_route = routing_engine.calculate_emergency_route(dispatch_req)
        new_route.route_id = request.route_id
        new_route.recalculated = True
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Broadcast updated route to dashboard clients
    await manager.broadcast(
        WebSocketMessage(
            event=TelemetryEventType.ROUTE_RECALCULATED,
            data=new_route.model_dump()
        )
    )

    return new_route

# Store active corridor backups in memory
_active_corridor_backups: dict[str, list] = {}

@router.post("/corridor/preempt", status_code=status.HTTP_200_OK)
async def apply_clearance_corridor(request: ClearanceCorridorRequest):
    """
    Applies pre-clearance impedance reductions along a sequence of corridor nodes.
    """
    backup = routing_engine.precompute_clearance_corridor(
        path_nodes=request.path_nodes,
        reduction_factor=request.reduction_factor
    )
    corridor_id = f"corridor_{len(_active_corridor_backups) + 1}"
    _active_corridor_backups[corridor_id] = backup
    return {
        "status": "applied",
        "corridor_id": corridor_id,
        "edges_cleared": len(backup),
        "reduction_pct": round(request.reduction_factor * 100, 1)
    }

@router.post("/corridor/restore", status_code=status.HTTP_200_OK)
async def restore_clearance_corridor(corridor_id: str = Query(...)):
    """
    Restores original weights of a previously cleared corridor.
    """
    backup = _active_corridor_backups.pop(corridor_id, None)
    if not backup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Corridor '{corridor_id}' not found.")
    restored = routing_engine.restore_corridor_weights(backup)
    return {"status": "restored", "corridor_id": corridor_id, "edges_restored": restored}

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
