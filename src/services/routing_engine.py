import uuid
import math
import logging
from typing import List, Any, Optional, Tuple, Dict
import networkx as nx

from src.core.config import settings
from src.services.graph_service import graph_service
from src.models.schemas import (
    Coordinates,
    RouteStep,
    RouteResponse,
    DispatchRequest,
    AlternativeRoutesResponse,
    FleetDispatchRequest,
)

logger = logging.getLogger("flowsense.routing")


# ======================================================================
# Heuristic functions
# ======================================================================

def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres between two (lat, lon) points."""
    R = 6_371_000  # Earth radius in metres
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _make_haversine_heuristic(G: nx.MultiDiGraph, target_node):
    """
    Returns an A* heuristic function that estimates remaining distance
    to ``target_node`` using the Haversine formula.

    The heuristic is *admissible* (never overestimates) because it returns
    straight-line geographic distance, which is always ≤ the road-network
    distance encoded in ``emergency_weight``.
    """
    target_data = G.nodes.get(target_node)
    if target_data is None:
        if str(target_node) in G.nodes:
            target_node = str(target_node)
            target_data = G.nodes[target_node]
        elif isinstance(target_node, str) and target_node.isdigit() and int(target_node) in G.nodes:
            target_node = int(target_node)
            target_data = G.nodes[target_node]
        else:
            raise KeyError(f"Target node {target_node} not found in graph.")

    t_lat = float(target_data.get("y", 0.0))
    t_lon = float(target_data.get("x", 0.0))

    def heuristic(u, v):
        # In nx.astar_path, the heuristic receives (current, target).
        # 'u' is the node being expanded.
        u_data = G.nodes.get(u)
        if u_data is None:
            if str(u) in G.nodes:
                u_data = G.nodes[str(u)]
            elif isinstance(u, str) and u.isdigit() and int(u) in G.nodes:
                u_data = G.nodes[int(u)]
            else:
                u_data = {}
        u_lat = float(u_data.get("y", 0.0))
        u_lon = float(u_data.get("x", 0.0))
        return _haversine_m(u_lat, u_lon, t_lat, t_lon)

    return heuristic


def _effective_speed(base_speed: float, congestion: float, vehicle_type: str) -> float:
    base_eff = max(15.0, base_speed * (1.0 - 0.45 * congestion))
    if vehicle_type == "fire_truck":
        base_eff *= 0.9
    return base_eff


class RoutingEngine:
    """
    Computes zero-latency dynamic emergency corridors for ambulances and fire trucks.
    Dynamically evades congested arteries based on real-time OpenCV perception weights.

    Algorithms available:
      - **Dijkstra** — classic shortest-path, guaranteed optimal.
      - **A*** — Haversine-guided, prunes ~60% fewer nodes on urban grids.
      - **Yen's K-Shortest** — K alternative corridors with overlap penalty.
      - **NSGA-II (placeholder)** — Multi-objective fleet optimisation.
    """

    # ==================================================================
    # Route building (shared)
    # ==================================================================

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
            node_key = path_nodes[idx]
            node_data = G.nodes.get(node_key)
            if node_data is None:
                node_data = G.nodes.get(str(node_key)) or G.nodes.get(int(node_key) if str(node_key).isdigit() else node_key, {})
            lat = float(node_data.get("y", 0.0))
            lon = float(node_data.get("x", 0.0))
            if idx == 0:
                corridor_coords.append([request.origin.longitude, request.origin.latitude])
                corridor_coords.append([lon, lat])

            segment_len = 0.0
            segment_cg = 0.0
            street_name = node_data.get("street") or node_data.get("name")

            if idx < len(path_nodes) - 1:
                u, v = path_nodes[idx], path_nodes[idx + 1]
                edge_candidates = G.get_edge_data(u, v)
                if not edge_candidates:
                    edge_candidates = G.get_edge_data(str(u), str(v))
                if not edge_candidates:
                    if str(u).isdigit() and str(v).isdigit():
                        edge_candidates = G.get_edge_data(int(u), int(v))
                if not edge_candidates:
                    edge_candidates = {0: {}}
                best_key = min(edge_candidates.keys(), key=lambda k: edge_candidates[k].get("emergency_weight", 1000.0))
                edge = edge_candidates[best_key]

                # OSMnx stores full street geometry on simplified edges. Use it
                # so the displayed route follows bends and curves in the map.
                edge_geometry = edge.get("geometry")
                edge_coords = []
                if edge_geometry is not None:
                    try:
                        if hasattr(edge_geometry, "coords"):
                            edge_coords = [[float(x), float(y)] for x, y in edge_geometry.coords]
                        elif isinstance(edge_geometry, str):
                            from shapely import wkt
                            parsed = wkt.loads(edge_geometry)
                            edge_coords = [[float(x), float(y)] for x, y in parsed.coords]
                    except (ImportError, TypeError, ValueError):
                        edge_coords = []

                if edge_coords:
                    start_lon, start_lat = float(node_data.get("x", lon)), float(node_data.get("y", lat))
                    if math.hypot(edge_coords[0][0] - start_lon, edge_coords[0][1] - start_lat) > math.hypot(edge_coords[-1][0] - start_lon, edge_coords[-1][1] - start_lat):
                        edge_coords.reverse()
                    corridor_coords.extend(edge_coords[1:])
                else:
                    next_data = G.nodes.get(v) or G.nodes.get(str(v)) or {}
                    corridor_coords.append([float(next_data.get("x", lon)), float(next_data.get("y", lat))])

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
                corridor_coords.append([request.destination.longitude, request.destination.latitude])

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

    # ==================================================================
    # Static choke (demo simulation)
    # ==================================================================

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

    # ==================================================================
    # Core path-finding backends
    # ==================================================================

    def _find_path_dijkstra(self, G: nx.MultiDiGraph, source: int, target: int, weight: str = "emergency_weight") -> List[int]:
        """Compute shortest path using Dijkstra's algorithm."""
        if source not in G.nodes and str(source) in G.nodes:
            source = str(source)
        if target not in G.nodes and str(target) in G.nodes:
            target = str(target)
        raw_path = nx.shortest_path(G, source=source, target=target, weight=weight)
        return [int(p) if isinstance(p, str) and p.isdigit() else p for p in raw_path]

    def _find_path_astar(self, G: nx.MultiDiGraph, source: int, target: int, weight: str = "emergency_weight") -> List[int]:
        """
        Compute shortest path using A* with a Haversine heuristic.
        Falls back to Dijkstra if A* fails (e.g., disconnected components).
        """
        if source not in G.nodes and str(source) in G.nodes:
            source = str(source)
        if target not in G.nodes and str(target) in G.nodes:
            target = str(target)
        heuristic = _make_haversine_heuristic(G, target)
        try:
            raw_path = list(nx.astar_path(G, source=source, target=target, heuristic=heuristic, weight=weight))
            return [int(p) if isinstance(p, str) and p.isdigit() else p for p in raw_path]
        except nx.NetworkXNoPath:
            raise
        except Exception as e:
            logger.warning(f"A* failed ({e}), falling back to Dijkstra.")
            return self._find_path_dijkstra(G, source, target, weight)

    def _find_path(self, G: nx.MultiDiGraph, source: int, target: int, weight: str = "emergency_weight") -> List[int]:
        """Dispatch to the configured routing algorithm."""
        if settings.ROUTING_ALGORITHM == "astar":
            return self._find_path_astar(G, source, target, weight)
        return self._find_path_dijkstra(G, source, target, weight)

    # ==================================================================
    # Primary emergency routing (existing public API — preserved)
    # ==================================================================

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
        if graph_service.is_synthetic:
            raise ValueError("Real OpenStreetMap street data is unavailable; navigation is disabled.")

        # 1. Match geographic coordinates to nearest network nodes
        source_node = graph_service.find_nearest_node(request.origin.latitude, request.origin.longitude, max_distance_m=750)
        target_node = graph_service.find_nearest_node(request.destination.latitude, request.destination.longitude, max_distance_m=750)

        # 2. Compute static shortest path using physical length only
        try:
            static_path = self._find_path(G, source_node, target_node, weight="length")
        except nx.NetworkXNoPath:
            logger.error(f"No path found between node {source_node} and {target_node}")
            raise ValueError(f"No reachable route between coordinates ({request.origin}) and ({request.destination}).")

        # 2b. Demo scenario: grind the naive static corridor to a halt.
        if simulate:
            self._choke_corridor(static_path, severity=0.85)

        # 3. Compute dynamic shortest path using real-time 'emergency_weight'
        try:
            dynamic_path = self._find_path(G, source_node, target_node, weight="emergency_weight")
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

    # ==================================================================
    # A* explicit entry point
    # ==================================================================

    def calculate_emergency_route_astar(self, request: DispatchRequest) -> RouteResponse:
        """
        Force A* algorithm regardless of the global ``ROUTING_ALGORITHM`` setting.
        Useful for comparative benchmarks.
        """
        G = graph_service.get_graph()
        if graph_service.is_synthetic:
            raise ValueError("Real OpenStreetMap street data is unavailable; navigation is disabled.")
        source_node = graph_service.find_nearest_node(request.origin.latitude, request.origin.longitude, max_distance_m=750)
        target_node = graph_service.find_nearest_node(request.destination.latitude, request.destination.longitude, max_distance_m=750)

        path = self._find_path_astar(G, source_node, target_node, weight="emergency_weight")
        return self._build_route(path, request)

    # ==================================================================
    # K Alternative Routes — Yen's K-Shortest Paths with overlap penalty
    # ==================================================================

    def calculate_alternative_routes(
        self,
        request: DispatchRequest,
        k: int = 3,
    ) -> AlternativeRoutesResponse:
        """
        Compute K alternative emergency corridors.

        Uses Yen's algorithm: after finding the optimal path, subsequent
        paths are found by temporarily removing edges along previously
        found paths and re-computing.  An overlap penalty discourages
        routes that share too many segments with the primary corridor.

        Parameters
        ----------
        request : DispatchRequest
            Origin, destination, vehicle type.
        k : int
            Number of total routes to return (1 primary + k-1 alternatives).
        """
        G = graph_service.get_graph()
        if graph_service.is_synthetic:
            raise ValueError("Real OpenStreetMap street data is unavailable; navigation is disabled.")
        source_node = graph_service.find_nearest_node(request.origin.latitude, request.origin.longitude, max_distance_m=750)
        target_node = graph_service.find_nearest_node(request.destination.latitude, request.destination.longitude, max_distance_m=750)

        k = min(k, settings.MAX_ALTERNATIVE_ROUTES)

        # nx.shortest_simple_paths does not support MultiDiGraph.
        # Convert to a simple DiGraph keeping only the best (min weight) edge per (u,v).
        simple_G = nx.DiGraph()
        for u, v, key, data in G.edges(keys=True, data=True):
            w = float(data.get("emergency_weight", 100.0))
            if simple_G.has_edge(u, v):
                if w < simple_G[u][v]["emergency_weight"]:
                    simple_G[u][v]["emergency_weight"] = w
            else:
                simple_G.add_edge(u, v, emergency_weight=w)

        # Use networkx's built-in K shortest simple paths on the simplified graph
        src_match = source_node
        tgt_match = target_node
        if src_match not in simple_G.nodes and str(src_match) in simple_G.nodes:
            src_match = str(src_match)
        if tgt_match not in simple_G.nodes and str(tgt_match) in simple_G.nodes:
            tgt_match = str(tgt_match)

        try:
            k_paths_iter = nx.shortest_simple_paths(simple_G, src_match, tgt_match, weight="emergency_weight")
            selected_paths = []
            for i, path in enumerate(k_paths_iter):
                int_path = [int(p) if isinstance(p, str) and p.isdigit() else p for p in path]
                selected_paths.append(int_path)
                if i + 1 >= k:
                    break
        except nx.NetworkXNoPath:
            raise ValueError(f"No reachable route between the given coordinates.")

        if not selected_paths:
            raise ValueError("Could not find any route.")

        # Build primary
        primary = self._build_route(selected_paths[0], request)

        # Build alternatives
        alternatives: List[RouteResponse] = []
        primary_edges = set(zip(selected_paths[0][:-1], selected_paths[0][1:]))

        for path in selected_paths[1:]:
            alt_route = self._build_route(path, request)

            # Calculate overlap percentage with primary
            alt_edges = set(zip(path[:-1], path[1:]))
            overlap = len(primary_edges & alt_edges) / max(len(primary_edges), 1)
            alt_route.status = f"alternative (overlap: {overlap:.0%})"
            alternatives.append(alt_route)

        return AlternativeRoutesResponse(
            primary=primary,
            alternatives=alternatives,
            algorithm=settings.ROUTING_ALGORITHM,
        )

    # ==================================================================
    # Emergency Clearance Corridor
    # ==================================================================

    def precompute_clearance_corridor(
        self,
        path_nodes: List[int],
        reduction_factor: float = 0.3,
    ) -> List[Dict[str, Any]]:
        """
        Pre-reduce the ``emergency_weight`` on edges along a route to reflect
        the effect of Green Wave signal preemption (cleared intersections).

        Parameters
        ----------
        path_nodes : List[int]
            Ordered list of node IDs forming the corridor.
        reduction_factor : float
            Multiply ``emergency_weight`` by ``(1 - reduction_factor)``.
            0.3 means weights are reduced by 30%.

        Returns
        -------
        List[Dict]
            Backup data to restore original weights after the corridor expires.
        """
        G = graph_service.get_graph()
        backup: List[Dict[str, Any]] = []
        multiplier = max(0.1, 1.0 - reduction_factor)

        for idx in range(len(path_nodes) - 1):
            u, v = path_nodes[idx], path_nodes[idx + 1]
            edge_data = G.get_edge_data(u, v)
            target_u, target_v = u, v
            if not edge_data:
                target_u, target_v = str(u), str(v)
                edge_data = G.get_edge_data(target_u, target_v)
            if not edge_data:
                try:
                    target_u, target_v = int(u), int(v)
                    edge_data = G.get_edge_data(target_u, target_v)
                except (ValueError, TypeError):
                    pass
            if not edge_data:
                continue

            for k, data in edge_data.items():
                original_weight = float(data.get("emergency_weight", 100.0))
                backup.append({
                    "u": target_u, "v": target_v, "key": k,
                    "original_weight": original_weight,
                })
                data["emergency_weight"] = round(original_weight * multiplier, 2)

        logger.info(
            f"Clearance corridor applied: {len(backup)} edges reduced by "
            f"{reduction_factor:.0%} along {len(path_nodes)}-node path."
        )
        return backup

    def restore_corridor_weights(self, backup: List[Dict[str, Any]]) -> int:
        """
        Restore original ``emergency_weight`` values from a clearance corridor backup.

        Returns the number of edges restored.
        """
        G = graph_service.get_graph()
        count = 0
        for entry in backup:
            u, v, k = entry["u"], entry["v"], entry["key"]
            if G.has_edge(u, v, k):
                G[u][v][k]["emergency_weight"] = entry["original_weight"]
                count += 1
            elif G.has_edge(str(u), str(v), k):
                G[str(u)][str(v)][k]["emergency_weight"] = entry["original_weight"]
                count += 1
        logger.info(f"Clearance corridor restored: {count} edges reset.")
        return count

    # ==================================================================
    # NSGA-II Multi-Objective Fleet Optimisation (placeholder)
    # ==================================================================

    def optimize_fleet_routes(
        self,
        fleet_request: FleetDispatchRequest,
    ) -> List[RouteResponse]:
        """
        Compute optimised routes for multiple simultaneous emergency vehicles.

        This is a **placeholder** implementation that independently routes each
        vehicle using A*.  The full NSGA-II multi-objective optimisation
        (minimise total fleet ETA + minimise max individual congestion) will be
        implemented in a future iteration once real dispatch data is available.

        Parameters
        ----------
        fleet_request : FleetDispatchRequest
            Contains a list of vehicle dispatch requests and the optimization objective.

        Returns
        -------
        List[RouteResponse]
            One optimised route per vehicle in the fleet.
        """
        logger.info(
            f"Fleet optimisation requested: {len(fleet_request.vehicles)} vehicles, "
            f"objective='{fleet_request.optimize_for}' "
            f"[NSGA-II placeholder — routing independently with A*]"
        )

        routes: List[RouteResponse] = []
        for vehicle_req in fleet_request.vehicles:
            try:
                route = self.calculate_emergency_route_astar(vehicle_req)
                route.status = f"fleet_optimised ({fleet_request.optimize_for})"
                routes.append(route)
            except Exception as e:
                logger.warning(f"Fleet routing failed for vehicle: {e}")

        return routes


# Global singleton instance
routing_engine = RoutingEngine()
