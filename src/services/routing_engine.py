import uuid
import logging
from typing import List, Any
import networkx as nx

from src.core.config import settings
from src.services.graph_service import graph_service
from src.models.schemas import (
    Coordinates,
    RouteStep,
    RouteResponse,
    DispatchRequest,
)

logger = logging.getLogger("flowsense.routing")

def _effective_speed(base_speed: float, congestion: float, vehicle_type: str) -> float:
    base_eff = max(15.0, base_speed * (1.0 - 0.45 * congestion))
    if vehicle_type == "fire_truck":
        base_eff *= 0.9
    return base_eff

class RoutingEngine:
    """
    Computes zero-latency dynamic emergency corridors for ambulances and fire trucks.
    Dynamically evades congested arteries based on real-time OpenCV perception weights.
    """

    def _build_route(self, path_nodes: List[int], request: DispatchRequest) -> RouteResponse:
        """
        Builds a RouteResponse for a given node path (used for both static & dynamic).
        """
        G = graph_service.get_graph()
        route_id = f"route_{uuid.uuid4().hex[:8]}"
        waypoints: List[RouteStep] = []
        corridor_coords: List[List[float]] = []
        total_distance = 0.0
        total_time_seconds = 0.0

        for idx in range(len(path_nodes)):
            node_data = G.nodes[path_nodes[idx]]
            lat = float(node_data.get("y", 0.0))
            lon = float(node_data.get("x", 0.0))
            corridor_coords.append([lon, lat])

            segment_len = 0.0
            segment_cg = 0.0
            street_name = node_data.get("street") or node_data.get("name")

            if idx < len(path_nodes) - 1:
                edge_candidates = G[path_nodes[idx]][path_nodes[idx + 1]]
                best_key = min(edge_candidates.keys(), key=lambda k: edge_candidates[k].get("emergency_weight", 1000.0))
                edge = edge_candidates[best_key]

                segment_len = float(edge.get("length", 100.0))
                segment_cg = float(edge.get("congestion_factor", 0.0))
                street_name = edge.get("name", street_name)

                base_speed = float(edge.get("average_speed_kmh", settings.DEFAULT_SPEED_KMH))
                effective_speed_kmh = _effective_speed(base_speed, segment_cg, request.vehicle_type)
                segment_duration = (segment_len / (effective_speed_kmh * 1000.0 / 3600.0))
                total_distance += segment_len
                total_time_seconds += segment_duration
            else:
                segment_duration = 0.0

            waypoints.append(
                RouteStep(
                    node_id=int(path_nodes[idx]),
                    latitude=lat,
                    longitude=lon,
                    street_name=street_name,
                    length_m=round(segment_len, 1),
                    congestion_factor=round(segment_cg, 2),
                    estimated_duration_s=round(segment_duration, 1)
                )
            )

        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": corridor_coords
                    },
                    "properties": {
                        "route_id": route_id,
                        "vehicle_type": request.vehicle_type,
                        "priority": request.priority,
                        "distance_m": round(total_distance, 1),
                        "duration_s": round(total_time_seconds, 1),
                        "color": "#00E5FF",
                        "stroke_width": 6,
                        "clearance_corridor": True
                    }
                }
            ]
        }

        return RouteResponse(
            route_id=route_id,
            vehicle_type=request.vehicle_type,
            total_distance_m=round(total_distance, 1),
            total_estimated_time_s=round(total_time_seconds, 1),
            path_node_ids=[int(n) for n in path_nodes],
            waypoints=waypoints,
            geojson=geojson,
            status="cleared",
            recalculated=False
        )

    def _choke_corridor(self, path: List[int], severity: float = 0.85):
        """Congests the edges along a node path, simulating a naive corridor grinding to a halt."""
        G = graph_service.get_graph()
        for idx in range(len(path) - 1):
            u, v = path[idx], path[idx + 1]
            edge_candidates = G.get_edge_data(u, v)
            if not edge_candidates:
                continue
            for k in edge_candidates.keys():
                graph_service.update_edge_congestion(
                    u=u, v=v, key=k,
                    congestion_factor=round(severity, 2),
                    vehicle_count=int(severity * 45),
                    average_speed_kmh=max(10.0, 50.0 * (1.0 - severity))
                )

    def calculate_emergency_route(self, request: DispatchRequest, simulate: bool = False) -> RouteResponse:
        """
        Calculates optimal emergency corridor between origin and destination coordinates.
        Additionally computes a static (baseline) route using only physical length so the
        dashboard can show % savings of the dynamic FlowSense corridor.

        In `simulate` mode the naive static corridor is choked with gridlock first, mirroring
        the "golden hour bottleneck": static GPS routing grinds to a halt while FlowSense
        dynamically re-routes through the cleared corridors.
        """
        G = graph_service.get_graph()

        # 1. Match geographic coordinates to nearest network nodes
        source_node = graph_service.find_nearest_node(request.origin.latitude, request.origin.longitude)
        target_node = graph_service.find_nearest_node(request.destination.latitude, request.destination.longitude)

        # 2. Compute static shortest path using physical length only
        try:
            static_path = nx.shortest_path(
                G,
                source=source_node,
                target=target_node,
                weight="length"
            )
        except nx.NetworkXNoPath:
            logger.error(f"No path found between node {source_node} and {target_node}")
            raise ValueError(f"No reachable route between coordinates ({request.origin}) and ({request.destination}).")

        # 2b. Demo scenario: grind the naive static corridor to a halt.
        if simulate:
            self._choke_corridor(static_path, severity=0.85)

        # 3. Compute dynamic shortest path using real-time 'emergency_weight'
        try:
            dynamic_path = nx.shortest_path(
                G,
                source=source_node,
                target=target_node,
                weight="emergency_weight"
            )
        except nx.NetworkXNoPath:
            logger.error(f"No path found between node {source_node} and {target_node}")
            raise ValueError(f"No reachable route between coordinates ({request.origin}) and ({request.destination}).")

        route = self._build_route(dynamic_path, request)
        baseline = self._build_route(static_path, request)

        # 4. Compute baseline corridor (static routing) metrics for the comparison panel
        route.baseline_eta_seconds = baseline.total_estimated_time_s
        route.baseline_distance_m = baseline.total_distance_m
        savings = max(0.0, baseline.total_estimated_time_s - route.total_estimated_time_s)
        route.savings_pct = round(
            (savings / baseline.total_estimated_time_s * 100.0)
            if baseline.total_estimated_time_s > 0 else 0.0,
            1
        )

        route.static_geojson = baseline.geojson
        return route

# Global singleton instance
routing_engine = RoutingEngine()