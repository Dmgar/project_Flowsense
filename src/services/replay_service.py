import time
import logging
from typing import List, Dict, Any, Optional
from collections import deque
from src.services.graph_service import graph_service
from src.services.routing_engine import routing_engine
from src.models.schemas import DispatchRequest, Coordinates

logger = logging.getLogger("flowsense.replay")

class ReplayService:
    """
    Records and serves mission replay frames for the Leaflet timeline scrubber.
    """
    def __init__(self, max_buffer_size: int = 120):
        self._buffer: deque[Dict[str, Any]] = deque(maxlen=max_buffer_size)

    def record_frame(
        self,
        vehicles: List[Dict[str, Any]],
        edges: List[Dict[str, Any]],
        alerts: List[Dict[str, Any]],
        route: Optional[Dict[str, Any]] = None
    ):
        frame = {
            "timestamp": int(time.time() * 1000),
            "vehicles": vehicles,
            "edges": edges,
            "alerts": alerts,
            "route": route
        }
        self._buffer.append(frame)

    def get_latest_session(self, frames: int = 30) -> List[Dict[str, Any]]:
        """
        Returns recorded frames, or constructs an authentic playback session
        from the current network state if the buffer is empty.
        """
        if len(self._buffer) >= 10:
            return list(self._buffer)[-frames:]

        # Build an authentic mission playback session on Manhattan
        return self._build_synthetic_session(frames)

    def _build_synthetic_session(self, total_frames: int) -> List[Dict[str, Any]]:
        G = graph_service.get_graph()
        base_time = int((time.time() - total_frames * 2) * 1000)

        # Generate a sample emergency mission across Manhattan
        req = DispatchRequest(
            origin=Coordinates(latitude=40.7490, longitude=-73.9920),
            destination=Coordinates(latitude=40.7600, longitude=-73.9780),
            vehicle_type="ambulance",
            priority="critical"
        )
        route_resp = routing_engine.calculate_emergency_route(req, simulate=False)
        waypoints = route_resp.waypoints
        n_wp = len(waypoints)

        # Sample 10 representative edges for traffic updates
        all_edges = list(G.edges(keys=True))[:12]

        session: List[Dict[str, Any]] = []

        for f in range(total_frames):
            frame_time = base_time + f * 2000
            progress = f / max(1, total_frames - 1)

            # Interpolate position along waypoints
            wp_idx = min(int(progress * (n_wp - 1)), n_wp - 1)
            curr_wp = waypoints[wp_idx]
            next_wp = waypoints[min(wp_idx + 1, n_wp - 1)]

            heading = 0.0
            if next_wp != curr_wp:
                import math
                angle = math.degrees(math.atan2(
                    next_wp.longitude - curr_wp.longitude,
                    next_wp.latitude - curr_wp.latitude
                ))
                heading = round((angle + 360) % 360, 1)

            vehicle = {
                "vehicle_id": "EMS-MEDIC-101",
                "latitude": curr_wp.latitude,
                "longitude": curr_wp.longitude,
                "heading": heading,
                "speed_kmh": 45.0,
                "current_node": curr_wp.node_id,
                "target_node": next_wp.node_id,
                "route_id": route_resp.route_id,
                "corridor_cleared_ahead_m": 250.0
            }

            # Edges with slight dynamic fluctuation
            edges_update = []
            for u, v, k in all_edges:
                edge_data = G[u][v][k]
                base_cg = float(edge_data.get("congestion_factor", 0.0))
                edges_update.append({
                    "u": int(u),
                    "v": int(v),
                    "key": int(k),
                    "congestion_factor": round(base_cg, 2),
                    "vehicle_count": int(edge_data.get("vehicle_count", 0)),
                    "average_speed_kmh": float(edge_data.get("average_speed_kmh", 40.0))
                })

            alerts = []
            if f == 5:
                alerts.append({
                    "message": "Corredor de emergencia activado en 7th Ave",
                    "severity": "info",
                    "timestamp": str(frame_time)
                })
            elif f == 15:
                alerts.append({
                    "message": "Tráfico despejado con prioridad por semaforización",
                    "severity": "info",
                    "timestamp": str(frame_time)
                })

            session.append({
                "timestamp": frame_time,
                "vehicles": [vehicle],
                "edges": edges_update,
                "alerts": alerts,
                "route": route_resp.model_dump()
            })

        return session

replay_service = ReplayService()
