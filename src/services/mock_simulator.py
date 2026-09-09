import asyncio
import random
import logging
from typing import Optional
from src.services.graph_service import graph_service
from src.api.websockets.connection_manager import manager
from src.models.schemas import RouteResponse
from src.models.telemetry import (
    WebSocketMessage,
    TelemetryEventType,
    VehiclePositionEvent
)

logger = logging.getLogger("flowsense.simulator")

class MockSimulator:
    """
    Simulates dynamic urban traffic changes and emergency vehicle mission progress.
    Allows testing routing and WebSocket telemetry without needing live OpenCV camera streams.
    """
    def __init__(self):
        self._traffic_task: Optional[asyncio.Task] = None
        self._mission_task: Optional[asyncio.Task] = None
        self.is_simulating_traffic: bool = False

    async def start_traffic_simulation(self, interval_seconds: float = 4.0):
        """Periodically perturbs street congestion and broadcasts updates."""
        if self.is_simulating_traffic:
            return

        self.is_simulating_traffic = True
        logger.info("Started mock urban traffic background simulation.")

        while self.is_simulating_traffic:
            try:
                G = graph_service.get_graph()
                edges = list(G.edges(keys=True))
                if edges:
                    # Pick 2-4 random road segments to modify
                    sample_size = min(len(edges), random.randint(2, 4))
                    selected_edges = random.sample(edges, sample_size)
                    
                    updates = []
                    for u, v, k in selected_edges:
                        # 20% chance of sudden severe bottleneck, otherwise slight fluctuation
                        if random.random() < 0.2:
                            new_cg = round(random.uniform(0.75, 0.95), 2)
                        else:
                            new_cg = round(random.uniform(0.05, 0.40), 2)
                        
                        count = int(new_cg * 40)
                        speed = max(10.0, 50.0 * (1.0 - new_cg))
                        
                        graph_service.update_edge_congestion(
                            u=u, v=v, key=k,
                            congestion_factor=new_cg,
                            vehicle_count=count,
                            average_speed_kmh=speed
                        )
                        updates.append({
                            "u": u,
                            "v": v,
                            "key": k,
                            "congestion_factor": new_cg,
                            "vehicle_count": count
                        })

                    # Broadcast through WebSocket
                    msg = WebSocketMessage(
                        event=TelemetryEventType.TRAFFIC_UPDATE,
                        data={"updated_edges": updates}
                    )
                    await manager.broadcast(msg)

                await asyncio.sleep(interval_seconds)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in traffic simulation loop: {e}")
                await asyncio.sleep(interval_seconds)

    def stop_traffic_simulation(self):
        self.is_simulating_traffic = False
        if self._traffic_task and not self._traffic_task.done():
            self._traffic_task.cancel()
        logger.info("Stopped mock traffic simulation.")

    async def run_mission_simulation(self, route: RouteResponse, vehicle_id: str = "EMS-MEDIC-101"):
        """Simulates step-by-step vehicle movement along the calculated emergency corridor."""
        logger.info(f"Starting mission telemetry stream for {vehicle_id} on route {route.route_id}")
        waypoints = route.waypoints

        for idx in range(len(waypoints)):
            current_wp = waypoints[idx]
            next_wp = waypoints[idx + 1] if idx < len(waypoints) - 1 else None

            # Calculate heading towards next waypoint
            heading = 0.0
            if next_wp:
                delta_lon = next_wp.longitude - current_wp.longitude
                delta_lat = next_wp.latitude - current_wp.latitude
                # Approximate heading
                import math
                angle = math.degrees(math.atan2(delta_lon, delta_lat))
                heading = round((angle + 360) % 360, 1)

            telemetry = VehiclePositionEvent(
                vehicle_id=vehicle_id,
                latitude=current_wp.latitude,
                longitude=current_wp.longitude,
                heading=heading,
                speed_kmh=45.0,
                current_node=current_wp.node_id,
                target_node=next_wp.node_id if next_wp else current_wp.node_id,
                route_id=route.route_id,
                corridor_cleared_ahead_m=280.0
            )

            msg = WebSocketMessage(
                event=TelemetryEventType.VEHICLE_TELEMETRY,
                data=telemetry.model_dump()
            )
            await manager.broadcast(msg)
            await asyncio.sleep(1.5)  # 1.5s per intersection

        logger.info(f"Emergency vehicle {vehicle_id} reached destination.")

simulator = MockSimulator()
