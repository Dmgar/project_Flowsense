import uuid
import logging
from typing import List, Dict, Any, Optional
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

class RoutingEngine:
    """
    Computes zero-latency dynamic emergency corridors for ambulances and fire trucks.
    Dynamically evades congested arteries based on real-time OpenCV perception weights.
    """

    def calculate_emergency_route(self, request: DispatchRequest) -> RouteResponse:
        """
        Calculates optimal emergency corridor between origin and destination coordinates.
        """
        G = graph_service.get_graph()
        
        # 1. Match geographic coordinates to nearest network nodes
        source_node = graph_service.find_nearest_node(request.origin.latitude, request.origin.longitude)
        target_node = graph_service.find_nearest_node(request.destination.latitude, request.destination.longitude)

        # 2. Compute dynamic shortest path using 'emergency_weight'
        try:
            path_nodes = nx.shortest_path(
                G,
                source=source_node,
                target=target_node,
                weight="emergency_weight"
            )
        except nx.NetworkXNoPath:
            logger.error(f"No path found between node {source_node} and {target_node}")
            raise ValueError(f"No reachable route between coordinates ({request.origin}) and ({request.destination}).")

        # 3. Build route telemetry, waypoints and corridor GeoJSON
        route_id = f"route_{uuid.uuid4().hex[:8]}"
        waypoints: List[RouteStep] = []
        corridor_coords: List[List[float]] = []
        total_distance = 0.0
        total_time_seconds = 0.0

        for idx in range(len(path_nodes)):
            node = path_nodes[idx]
            node_data = G.nodes[node]
            lat = float(node_data.get("y", 0.0))
            lon = float(node_data.get("x", 0.0))
            corridor_coords.append([lon, lat])

            segment_len = 0.0
            segment_cg = 0.0
            street_name = node_data.get("street") or node_data.get("name")

            if idx < len(path_nodes) - 1:
                next_node = path_nodes[idx + 1]
                # Extract minimum weight edge between these two nodes
                edge_candidates = G[node][next_node]
                best_key = min(edge_candidates.keys(), key=lambda k: edge_candidates[k].get("emergency_weight", 1000.0))
                edge = edge_candidates[best_key]

                segment_len = float(edge.get("length", 100.0))
                segment_cg = float(edge.get("congestion_factor", 0.0))
                street_name = edge.get("name", street_name)
                
                # Dynamic speed estimate based on congestion and vehicle type
                base_speed = float(edge.get("average_speed_kmh", settings.DEFAULT_SPEED_KMH))
                # Emergency vehicles with sirens clear moderate traffic, but gridlock (cg > 0.8) causes slowdown
                effective_speed_kmh = max(15.0, base_speed * (1.0 - 0.45 * segment_cg))
                if request.vehicle_type == "fire_truck":
                    effective_speed_kmh *= 0.9  # Fire trucks navigate slightly slower on tight turns
                
                segment_duration = (segment_len / (effective_speed_kmh * 1000.0 / 3600.0))
                total_distance += segment_len
                total_time_seconds += segment_duration
            else:
                segment_duration = 0.0

            waypoints.append(
                RouteStep(
                    node_id=int(node),
                    latitude=lat,
                    longitude=lon,
                    street_name=street_name,
                    length_m=round(segment_len, 1),
                    congestion_factor=round(segment_cg, 2),
                    estimated_duration_s=round(segment_duration, 1)
                )
            )

        # 4. Generate GeoJSON Feature for the clearance corridor
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
                        "color": "#00E5FF",  # High-visibility emergency cyan
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

# Global singleton instance
routing_engine = RoutingEngine()
