import time
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone

from src.services.graph_service import graph_service
from src.api.websockets.connection_manager import manager
from src.models.schemas import TrafficLightState, RouteStep
from src.models.telemetry import WebSocketMessage, TelemetryEventType

logger = logging.getLogger("flowsense.signals")

class SignalService:
    """
    Manages intelligent traffic signal preemption and Green Wave corridors
    for approaching emergency vehicles in Manhattan.
    """
    def __init__(self):
        self._signals: Dict[int, Dict[str, Any]] = {}
        self._active_preemptions: Dict[int, float] = {}  # node_id -> expiry_timestamp
        self._initialized = False

    def initialize(self):
        """Initializes signal controllers on all graph intersections."""
        if self._initialized:
            return

        G = graph_service.get_graph()
        for node, data in G.nodes(data=True):
            node_id = int(node)
            street = data.get("street", "Street")
            avenue = data.get("avenue", "Avenue")
            name = data.get("name", f"{street} & {avenue}")
            self._signals[node_id] = {
                "node_id": node_id,
                "intersection_name": name,
                "latitude": float(data.get("y", 40.75)),
                "longitude": float(data.get("x", -73.98)),
                "state": "normal",
                "cleared_direction_deg": None,
                "preempted_by_vehicle": None,
                "expires_at": None
            }
        self._initialized = True
        logger.info(f"Initialized {len(self._signals)} traffic signal controllers.")

    def get_all_signals(self) -> List[TrafficLightState]:
        self.initialize()
        self._cleanup_expired()
        return [
            TrafficLightState(
                node_id=s["node_id"],
                intersection_name=s["intersection_name"],
                state=s["state"],
                cleared_direction_deg=s["cleared_direction_deg"],
                preempted_by_vehicle=s["preempted_by_vehicle"],
                expires_at=s["expires_at"]
            )
            for s in self._signals.values()
        ]

    def get_active_signals(self) -> List[TrafficLightState]:
        all_signals = self.get_all_signals()
        return [s for s in all_signals if s.state == "preempted"]

    async def preempt_intersection(
        self,
        node_id: int,
        vehicle_id: str = "EMS-MEDIC-101",
        heading_deg: Optional[float] = None,
        duration_s: float = 20.0
    ) -> Optional[TrafficLightState]:
        """
        Forces all conflicting traffic lights to RED and sets emergency vehicle approach to GREEN.
        """
        self.initialize()
        if node_id not in self._signals:
            return None

        expiry = time.time() + duration_s
        self._active_preemptions[node_id] = expiry

        sig = self._signals[node_id]
        sig["state"] = "preempted"
        sig["preempted_by_vehicle"] = vehicle_id
        sig["cleared_direction_deg"] = heading_deg
        sig["expires_at"] = datetime.fromtimestamp(expiry, timezone.utc).isoformat()

        # Temporarily clear congestion factor on connecting edges to simulate cars pulling over
        G = graph_service.get_graph()
        for u, v, k, data in G.edges(keys=True, data=True):
            if u == node_id or v == node_id:
                # Lower congestion to free flow during active preemption
                data["congestion_factor"] = max(0.0, float(data.get("congestion_factor", 0.0)) * 0.3)
                data["average_speed_kmh"] = max(45.0, float(data.get("average_speed_kmh", 45.0)))

        state = TrafficLightState(**sig)
        await manager.broadcast(
            WebSocketMessage(
                event=TelemetryEventType.SIGNAL_PREEMPTION,
                data=state.model_dump()
            )
        )
        return state

    async def release_intersection(self, node_id: int) -> Optional[TrafficLightState]:
        """Releases preemption, returning intersection to normal cycle."""
        self.initialize()
        if node_id not in self._signals:
            return None

        self._active_preemptions.pop(node_id, None)
        sig = self._signals[node_id]
        sig["state"] = "normal"
        sig["preempted_by_vehicle"] = None
        sig["cleared_direction_deg"] = None
        sig["expires_at"] = None

        state = TrafficLightState(**sig)
        await manager.broadcast(
            WebSocketMessage(
                event=TelemetryEventType.SIGNAL_PREEMPTION,
                data=state.model_dump()
            )
        )
        return state

    async def update_green_wave_corridor(
        self,
        vehicle_id: str,
        current_wp_idx: int,
        waypoints: List[RouteStep],
        clearance_lookahead_count: int = 3
    ) -> List[int]:
        """
        Preempts the upcoming intersections ahead of the emergency vehicle
        and releases intersections it has already passed.
        """
        self.initialize()
        cleared_nodes: List[int] = []

        # 1. Lookahead upcoming nodes to clear
        upcoming_start = current_wp_idx
        upcoming_end = min(len(waypoints), current_wp_idx + clearance_lookahead_count + 1)

        for idx in range(upcoming_start, upcoming_end):
            wp = waypoints[idx]
            node_id = wp.node_id
            await self.preempt_intersection(
                node_id=node_id,
                vehicle_id=vehicle_id,
                duration_s=25.0
            )
            cleared_nodes.append(node_id)

        # 2. Release intersections already passed (2 nodes behind)
        if current_wp_idx >= 2:
            past_node = waypoints[current_wp_idx - 2].node_id
            await self.release_intersection(past_node)

        # 3. Broadcast GREEN_WAVE_ACTIVE summary event for Leaflet display
        if cleared_nodes:
            await manager.broadcast(
                WebSocketMessage(
                    event=TelemetryEventType.GREEN_WAVE_ACTIVE,
                    data={
                        "vehicle_id": vehicle_id,
                        "cleared_nodes": cleared_nodes,
                        "corridor_length_m": sum(waypoints[i].length_m for i in range(upcoming_start, upcoming_end))
                    }
                )
            )

        return cleared_nodes

    def _cleanup_expired(self):
        now = time.time()
        expired = [nid for nid, exp in self._active_preemptions.items() if now > exp]
        for nid in expired:
            self._active_preemptions.pop(nid, None)
            if nid in self._signals:
                sig = self._signals[nid]
                sig["state"] = "normal"
                sig["preempted_by_vehicle"] = None
                sig["expires_at"] = None

signal_service = SignalService()
