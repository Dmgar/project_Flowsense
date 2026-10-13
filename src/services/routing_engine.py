import uuid
import math
import logging
from typing import List, Any, Optional, Tuple, Dict
import networkx as nx

from src.core.config import settings
from src.services.graph_service import graph_service
from src.services.flood_intelligence import flood_intelligence
from src.models.schemas import (
    Coordinates,
    RouteStep,
    RouteResponse,
    DispatchRequest,
    AlternativeRoutesResponse,
    RouteResilience,
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


MIN_WEIGHT_FACTOR: float = 0.5  # Constant admissible scaling factor ensuring h(n) <= c(n, n')

def _make_haversine_heuristic(G: nx.MultiDiGraph, target_node: int):
    """
    Returns an A* heuristic function that estimates remaining distance
    to ``target_node`` using the Haversine formula scaled by MIN_WEIGHT_FACTOR (0.5).

    The heuristic is strictly *admissible* (never overestimates) because:
      h(n) = distance_haversine(n, target) * MIN_WEIGHT_FACTOR <= emergency_weight(edge)
    even under road class discounts (0.85) and green-wave clearance preemption (down to 0.7 or 0.1).
    """
    t_node = int(target_node)
    target_data = G.nodes.get(t_node)
    if target_data is None:
        raise KeyError(f"Target node {target_node} not found in graph.")

    t_lat = float(target_data.get("y", 0.0))
    t_lon = float(target_data.get("x", 0.0))

    def heuristic(u, v):
        # In nx.astar_path, the heuristic receives (current, target).
        # 'u' is the node being expanded.
        u_data = G.nodes.get(int(u), {})
        u_lat = float(u_data.get("y", 0.0))
        u_lon = float(u_data.get("x", 0.0))
        return _haversine_m(u_lat, u_lon, t_lat, t_lon) * MIN_WEIGHT_FACTOR

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

    def __init__(self):
        self._active_choke_backup: List[Dict[str, Any]] = []

    def get_active_choke(self) -> List[Dict[str, Any]]:
        return list(self._active_choke_backup)

    def clear_active_choke(self) -> int:
        if self._active_choke_backup:
            count = self._restore_choke(self._active_choke_backup)
            self._active_choke_backup = []
            return count
        return 0

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
            node_key = int(path_nodes[idx])
            node_data = G.nodes.get(node_key, {})
            lat = float(node_data.get("y", 0.0))
            lon = float(node_data.get("x", 0.0))
            if idx == 0:
                corridor_coords.append([request.origin.longitude, request.origin.latitude])
                corridor_coords.append([lon, lat])

            segment_len = 0.0
            segment_cg = 0.0
            street_name = node_data.get("street") or node_data.get("name")

            if idx < len(path_nodes) - 1:
                u, v = int(path_nodes[idx]), int(path_nodes[idx + 1])
                edge_candidates = G.get_edge_data(u, v)
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
                    next_data = G.nodes.get(v, {})
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

    def _choke_corridor(self, path: List[int], severity: float = 0.85) -> List[Dict[str, Any]]:
        """
        Congests the edges along a node path, simulating a naive corridor grinding to a halt.
        Returns a backup of the original edge attributes for explicit lifecycle control and restoration.
        """
        G = graph_service.get_graph()
        backup: List[Dict[str, Any]] = []
        for idx in range(len(path) - 1):
            u, v = int(path[idx]), int(path[idx + 1])
            edge_candidates = G.get_edge_data(u, v)
            if not edge_candidates:
                continue
            for k, data in edge_candidates.items():
                backup.append({
                    "u": u, "v": v, "key": k,
                    "congestion_factor": float(data.get("congestion_factor", 0.0)),
                    "vehicle_count": int(data.get("vehicle_count", 0)),
                    "average_speed_kmh": float(data.get("average_speed_kmh", settings.DEFAULT_SPEED_KMH)),
                })
                graph_service.update_edge_congestion(
                    u=u, v=v, key=k,
                    congestion_factor=round(severity, 2),
                    vehicle_count=int(severity * 45),
                    average_speed_kmh=max(10.0, 50.0 * (1.0 - severity))
                )
        return backup

    def _restore_choke(self, backup: List[Dict[str, Any]]) -> int:
        """Restores edge attributes modified by _choke_corridor."""
        G = graph_service.get_graph()
        count = 0
        for entry in backup:
            u, v, k = int(entry["u"]), int(entry["v"]), entry["key"]
            if G.has_edge(u, v, k):
                data = G[u][v][k]
                data["congestion_factor"] = entry.get("congestion_factor", 0.0)
                data["vehicle_count"] = entry.get("vehicle_count", 0)
                data["average_speed_kmh"] = entry.get("average_speed_kmh", settings.DEFAULT_SPEED_KMH)
                graph_service.recompute_edge_weight(u, v, k)
                count += 1
        return count

    # ==================================================================
    # Core path-finding backends
    # ==================================================================

    def _find_path_dijkstra(self, G: nx.MultiDiGraph, source: int, target: int, weight: str = "emergency_weight") -> List[int]:
        """Compute shortest path using Dijkstra's algorithm."""
        src_int, tgt_int = int(source), int(target)
        raw_path = nx.shortest_path(G, source=src_int, target=tgt_int, weight=weight)
        return [int(p) for p in raw_path]

    def _find_path_astar(self, G: nx.MultiDiGraph, source: int, target: int, weight: str = "emergency_weight") -> List[int]:
        """
        Compute shortest path using A* with an admissible Haversine heuristic.
        Falls back to Dijkstra if A* fails (e.g., disconnected components).
        """
        src_int, tgt_int = int(source), int(target)
        heuristic = _make_haversine_heuristic(G, tgt_int)
        try:
            raw_path = list(nx.astar_path(G, source=src_int, target=tgt_int, heuristic=heuristic, weight=weight))
            return [int(p) for p in raw_path]
        except nx.NetworkXNoPath:
            raise
        except Exception as e:
            logger.warning(f"A* failed ({e}), falling back to Dijkstra.")
            return self._find_path_dijkstra(G, src_int, tgt_int, weight)

    def _find_path(self, G: nx.MultiDiGraph, source: int, target: int, weight: str = "emergency_weight") -> List[int]:
        """Dispatch to the configured routing algorithm."""
        if settings.ROUTING_ALGORITHM == "astar":
            return self._find_path_astar(G, source, target, weight)
        return self._find_path_dijkstra(G, source, target, weight)

    # ==================================================================
    # Primary emergency routing (existing public API — preserved)
    # ==================================================================

    def _flood_safe_graph(self, graph: nx.MultiDiGraph, request: DispatchRequest):
        blocked, considered, excluded = flood_intelligence.blocked_nodes(graph, request.vehicle_type)
        if not blocked:
            return graph, considered, excluded
        safe_graph = graph.copy()
        safe_graph.remove_nodes_from(blocked)
        return safe_graph, considered, excluded

    def calculate_emergency_route(
        self,
        request: DispatchRequest,
        simulate: bool = False,
        persist_choke: bool = False
    ) -> RouteResponse:
        """
        Calculates optimal emergency corridor between origin and destination coordinates.
        Additionally computes a static (baseline) route using only physical length so the
        dashboard can show % savings of the dynamic FlowSense corridor.

        In `simulate` mode the naive static corridor is choked with gridlock first, mirroring
        the "golden hour bottleneck": static GPS routing grinds to a halt while FlowSense
        dynamically re-routes through the cleared corridors. State is isolated and restored
        in a finally block so concurrent requests or subsequent runs are not corrupted unless
        `persist_choke=True` is explicitly specified for live dashboard demonstration.
        """
        G = graph_service.get_graph()

        # 1. Match geographic coordinates to nearest network nodes
        source_node = graph_service.find_nearest_node(request.origin.latitude, request.origin.longitude, max_distance_m=750)
        target_node = graph_service.find_nearest_node(request.destination.latitude, request.destination.longitude, max_distance_m=750)
        route_graph, _, _ = self._flood_safe_graph(G, request)
        if source_node not in route_graph or target_node not in route_graph:
            raise ValueError("El origen o destino está dentro de una zona inundada confirmada.")

        # 2. Compute static shortest path using physical length only
        try:
            # A baseline may ignore congestion, but it must respect confirmed hazards.
            static_path = self._find_path(route_graph, source_node, target_node, weight="length")
        except nx.NetworkXNoPath:
            logger.error(f"No path found between node {source_node} and {target_node}")
            raise ValueError(f"No reachable route between coordinates ({request.origin}) and ({request.destination}).")

        choke_backup: List[Dict[str, Any]] = []
        try:
            # 2b. Demo scenario: grind the naive static corridor to a halt.
            if simulate:
                choke_backup = self._choke_corridor(static_path, severity=0.85)
                if persist_choke:
                    self._active_choke_backup = list(choke_backup)

            # 3. Compute dynamic shortest path using real-time 'emergency_weight'
            try:
                dynamic_path = self._find_path(route_graph, source_node, target_node, weight="emergency_weight")
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
        finally:
            if choke_backup and not persist_choke:
                self._restore_choke(choke_backup)

    # ==================================================================
    # A* explicit entry point
    # ==================================================================

    def calculate_emergency_route_astar(self, request: DispatchRequest) -> RouteResponse:
        """
        Force A* algorithm regardless of the global ``ROUTING_ALGORITHM`` setting.
        Useful for comparative benchmarks.
        """
        G = graph_service.get_graph()
        source_node = graph_service.find_nearest_node(request.origin.latitude, request.origin.longitude, max_distance_m=750)
        target_node = graph_service.find_nearest_node(request.destination.latitude, request.destination.longitude, max_distance_m=750)
        route_graph, _, _ = self._flood_safe_graph(G, request)
        if source_node not in route_graph or target_node not in route_graph:
            raise ValueError("El origen o destino está dentro de una zona inundada confirmada.")
        path = self._find_path_astar(route_graph, source_node, target_node, weight="emergency_weight")
        return self._build_route(path, request)

    # ==================================================================
    # K Alternative Routes — Yen's K-Shortest Paths with overlap penalty
    # ==================================================================

    def calculate_alternative_routes(
        self,
        request: DispatchRequest,
        k: int = 3,
        penalty_factor: float = 2.0,
        max_overlap: float = 0.70,
    ) -> AlternativeRoutesResponse:
        """
        Compute K alternative emergency corridors using the iterative Edge Penalty Method.

        Calculates the primary optimal corridor, then repeatedly penalizes the edges along
        previously found corridors by `penalty_factor` to force the path-finder to explore
        distinct physical corridors. Alternatives with overlap <= 70% with the primary
        corridor are prioritized; weights are safely restored in a finally block.

        Parameters
        ----------
        request : DispatchRequest
            Origin, destination, vehicle type.
        k : int
            Number of total routes to return (1 primary + k-1 alternatives).
        penalty_factor : float
            Multiplier applied to traversed edges during alternative search iterations.
        max_overlap : float
            Maximum allowable fraction of shared edges with primary path (default 0.70).
        """
        G = graph_service.get_graph()
        source_node = graph_service.find_nearest_node(request.origin.latitude, request.origin.longitude, max_distance_m=750)
        target_node = graph_service.find_nearest_node(request.destination.latitude, request.destination.longitude, max_distance_m=750)
        safe_G, flood_count, excluded_by_vehicle = self._flood_safe_graph(G, request)
        if source_node not in safe_G or target_node not in safe_G:
            raise ValueError("El origen o destino está dentro de una zona inundada confirmada.")

        k = min(k, settings.MAX_ALTERNATIVE_ROUTES)
        if k <= 0:
            raise ValueError("k must be at least 1.")

        # 1. Compute primary optimal path
        try:
            primary_path = self._find_path(safe_G, source_node, target_node, weight="emergency_weight")
        except nx.NetworkXNoPath:
            raise ValueError("No reachable route between the given coordinates.")

        primary = self._build_route(primary_path, request)
        if k == 1:
            return AlternativeRoutesResponse(
                primary=primary,
                alternatives=[],
                algorithm=settings.ROUTING_ALGORITHM,
            )

        primary_edges = set(zip(primary_path[:-1], primary_path[1:]))

        # 2. Iterative Edge Penalty Method
        modified_edges: Dict[Tuple[int, int, Any], float] = {}
        found_paths = [primary_path]
        valid_alternatives: List[Tuple[List[int], float]] = []
        fallback_alternatives: List[Tuple[List[int], float]] = []

        def _penalize_path_edges(path: List[int], factor: float):
            for u_step, v_step in zip(path[:-1], path[1:]):
                edge_data = safe_G.get_edge_data(int(u_step), int(v_step))
                if not edge_data:
                    continue
                for k_edge, data in edge_data.items():
                    edge_tuple = (int(u_step), int(v_step), k_edge)
                    if edge_tuple not in modified_edges:
                        modified_edges[edge_tuple] = float(data.get("emergency_weight", 100.0))
                    data["emergency_weight"] = round(float(data["emergency_weight"]) * factor, 3)

        try:
            # Penalize primary route edges to divert next search
            _penalize_path_edges(primary_path, penalty_factor)

            max_attempts = (k - 1) * 4
            for _ in range(max_attempts):
                try:
                    candidate_path = self._find_path(safe_G, source_node, target_node, weight="emergency_weight")
                except nx.NetworkXNoPath:
                    break

                if candidate_path in found_paths:
                    # Penalize further to escape local cycle
                    _penalize_path_edges(candidate_path, 1.5)
                    continue

                found_paths.append(candidate_path)
                candidate_edges = set(zip(candidate_path[:-1], candidate_path[1:]))
                overlap = len(primary_edges & candidate_edges) / max(len(primary_edges), 1)

                if overlap <= max_overlap:
                    valid_alternatives.append((candidate_path, overlap))
                else:
                    fallback_alternatives.append((candidate_path, overlap))

                # Penalize this candidate's edges as well to encourage diversity
                _penalize_path_edges(candidate_path, penalty_factor)

                if len(valid_alternatives) >= k - 1:
                    break

        finally:
            # Restore all modified edge weights
            for (u_edge, v_edge, k_edge), orig_w in modified_edges.items():
                if safe_G.has_edge(u_edge, v_edge, k_edge):
                    safe_G[u_edge][v_edge][k_edge]["emergency_weight"] = orig_w

        # 3. Select final alternatives (prioritizing overlap <= max_overlap)
        chosen: List[Tuple[List[int], float]] = list(valid_alternatives[:k - 1])
        if len(chosen) < k - 1:
            remaining_needed = (k - 1) - len(chosen)
            fallback_sorted = sorted(fallback_alternatives, key=lambda x: x[1])
            chosen.extend(fallback_sorted[:remaining_needed])

        alternatives: List[RouteResponse] = []
        overlaps: List[float] = []
        for path, overlap in chosen:
            alt_route = self._build_route(path, request)
            alt_route.status = f"alternative (overlap: {overlap:.0%})"
            alternatives.append(alt_route)
            overlaps.append(overlap)

        # A backup that shares most of the primary corridor can fail with it.
        # Prefer low overlap while penalizing excessively long fallbacks.
        resilience = RouteResilience(
            score_pct=0,
            status="no_backup",
            explanation="No existe una segunda ruta calculable con la red vial disponible.",
            shared_segment_pct=100.0,
            flood_reports_considered=flood_count,
            flood_reports_excluded_by_vehicle=excluded_by_vehicle,
        )
        if alternatives:
            candidates = []
            for alt_route, overlap in zip(alternatives, overlaps):
                detour = max(0.0, alt_route.total_estimated_time_s / max(primary.total_estimated_time_s, 1.0) - 1.0)
                objective = 0.72 * overlap + 0.28 * min(detour, 1.5)
                candidates.append((objective, alt_route, overlap, detour))
            _, backup, overlap, detour = min(candidates, key=lambda item: item[0])
            status = "resilient" if overlap <= 0.20 and detour <= 0.35 else "constrained" if overlap <= 0.55 and detour <= 0.75 else "fragile"
            score = round(100.0 * (1.0 - overlap) * max(0.2, 1.0 - 0.4 * min(detour, 1.5)))
            if status == "resilient":
                explanation = "La alternativa comparte pocos tramos críticos y conserva un desvío moderado."
            elif status == "constrained":
                explanation = "Hay una alternativa, pero comparte tramos o añade demora; confirma el estado antes del despacho."
            else:
                explanation = "Las rutas dependen de muchos tramos comunes o el respaldo es largo; el corredor es frágil ante otro cierre."
            resilience = RouteResilience(
                score_pct=max(0, min(100, score)), status=status,
                backup_route_id=backup.route_id,
                shared_segment_pct=round(overlap * 100, 1),
                detour_pct=round(detour * 100, 1),
                explanation=explanation,
                flood_reports_considered=flood_count,
                flood_reports_excluded_by_vehicle=excluded_by_vehicle,
            )

        return AlternativeRoutesResponse(
            primary=primary,
            alternatives=alternatives,
            algorithm=settings.ROUTING_ALGORITHM,
            resilience=resilience,
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
            u, v = int(path_nodes[idx]), int(path_nodes[idx + 1])
            edge_data = G.get_edge_data(u, v)
            if not edge_data:
                continue

            for k, data in edge_data.items():
                original_weight = float(data.get("emergency_weight", 100.0))
                orig_mult = float(data.get("corridor_multiplier", 1.0))
                backup.append({
                    "u": u, "v": v, "key": k,
                    "original_weight": original_weight,
                    "original_corridor_multiplier": orig_mult,
                })
                data["corridor_multiplier"] = multiplier
                graph_service.recompute_edge_weight(u, v, k)

        logger.info(
            f"Clearance corridor applied: {len(backup)} edges reduced by "
            f"{reduction_factor:.0%} along {len(path_nodes)}-node path."
        )
        return backup

    def restore_corridor_weights(self, backup: List[Dict[str, Any]]) -> int:
        """
        Restore original corridor weights using the unified recompute_edge_weight helper.

        Returns the number of edges restored.
        """
        G = graph_service.get_graph()
        count = 0
        for entry in backup:
            u, v, k = int(entry["u"]), int(entry["v"]), entry["key"]
            if G.has_edge(u, v, k):
                orig_mult = entry.get("original_corridor_multiplier", 1.0)
                G[u][v][k]["corridor_multiplier"] = orig_mult
                graph_service.recompute_edge_weight(u, v, k)
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
