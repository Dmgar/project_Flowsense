"""
Unit tests for FlowSense Advanced Routing Engine.

Tests A* with Haversine heuristic, K alternative routes, clearance corridor
pre-computation and restoration, and NSGA-II fleet placeholder.
"""
import pytest
from src.services.graph_service import graph_service
from src.services.routing_engine import routing_engine, _haversine_m
from src.models.schemas import DispatchRequest, Coordinates, FleetDispatchRequest


@pytest.fixture(autouse=True)
def _init_graph():
    """Ensure the graph is initialised before each test and reset congestion after."""
    graph_service.initialize()
    yield
    graph_service.reset_all_congestion()


# ======================================================================
# Haversine heuristic
# ======================================================================

class TestHaversine:
    def test_same_point_zero_distance(self):
        assert _haversine_m(40.758, -73.985, 40.758, -73.985) == pytest.approx(0.0, abs=0.01)

    def test_known_distance(self):
        # Times Square to Empire State Building ≈ ~1.1 km
        dist = _haversine_m(40.7580, -73.9855, 40.7484, -73.9857)
        assert 900 < dist < 1200  # reasonable range


# ======================================================================
# A* vs Dijkstra — should produce same-cost or better path
# ======================================================================

class TestAStarRouting:
    def _make_request(self) -> DispatchRequest:
        """Create a dispatch request across the synthetic Manhattan grid."""
        G = graph_service.get_graph()
        nodes = list(G.nodes(data=True))
        # Use first and last node for a cross-grid route
        first = nodes[0]
        last = nodes[-1]
        return DispatchRequest(
            origin=Coordinates(
                latitude=float(first[1].get("y", 40.748)),
                longitude=float(first[1].get("x", -73.995)),
            ),
            destination=Coordinates(
                latitude=float(last[1].get("y", 40.762)),
                longitude=float(last[1].get("x", -73.975)),
            ),
            vehicle_type="ambulance",
        )

    def test_astar_returns_valid_route(self):
        request = self._make_request()
        route = routing_engine.calculate_emergency_route_astar(request)

        assert route.route_id.startswith("route_")
        assert route.total_distance_m > 0
        assert route.total_estimated_time_s > 0
        assert len(route.path_node_ids) >= 2
        assert len(route.waypoints) >= 2

    def test_astar_matches_default_routing(self):
        """A* and the default algorithm should produce the same optimal cost."""
        request = self._make_request()

        route_astar = routing_engine.calculate_emergency_route_astar(request)
        route_default = routing_engine.calculate_emergency_route(request)

        # Costs should be equal (both are optimal on the same graph state)
        assert route_astar.total_distance_m == pytest.approx(route_default.total_distance_m, rel=0.01)


# ======================================================================
# K Alternative Routes
# ======================================================================

class TestAlternativeRoutes:
    def _make_request(self) -> DispatchRequest:
        G = graph_service.get_graph()
        nodes = list(G.nodes(data=True))
        first = nodes[0]
        last = nodes[-1]
        return DispatchRequest(
            origin=Coordinates(
                latitude=float(first[1].get("y", 40.748)),
                longitude=float(first[1].get("x", -73.995)),
            ),
            destination=Coordinates(
                latitude=float(last[1].get("y", 40.762)),
                longitude=float(last[1].get("x", -73.975)),
            ),
            vehicle_type="ambulance",
        )

    def test_returns_primary_and_alternatives(self):
        request = self._make_request()
        result = routing_engine.calculate_alternative_routes(request, k=3)

        assert result.primary is not None
        assert result.primary.total_distance_m > 0
        assert result.algorithm in ("astar", "dijkstra")

    def test_alternatives_differ_from_primary(self):
        request = self._make_request()
        result = routing_engine.calculate_alternative_routes(request, k=3)

        if result.alternatives:
            primary_nodes = set(result.primary.path_node_ids)
            for alt in result.alternatives:
                alt_nodes = set(alt.path_node_ids)
                # Alternative should not be identical to primary
                assert alt_nodes != primary_nodes or alt.total_distance_m != result.primary.total_distance_m

    def test_k_equals_one_returns_only_primary(self):
        request = self._make_request()
        result = routing_engine.calculate_alternative_routes(request, k=1)

        assert result.primary is not None
        assert len(result.alternatives) == 0


# ======================================================================
# Clearance Corridor
# ======================================================================

class TestClearanceCorridor:
    def test_apply_and_restore(self):
        """Clearance corridor should reduce weights then fully restore them."""
        G = graph_service.get_graph()
        nodes = list(G.nodes())[:5]

        # Ensure edges exist between consecutive nodes
        path = []
        for n in nodes:
            path.append(n)
            if len(path) >= 3:
                break

        if len(path) < 2:
            pytest.skip("Not enough connected nodes for corridor test")

        # Grab original weights
        original_weights = {}
        for idx in range(len(path) - 1):
            u, v = path[idx], path[idx + 1]
            edge_data = G.get_edge_data(u, v)
            if edge_data:
                for k, data in edge_data.items():
                    original_weights[(u, v, k)] = float(data.get("emergency_weight", 100.0))

        if not original_weights:
            pytest.skip("No edges found along test path")

        # Apply corridor
        backup = routing_engine.precompute_clearance_corridor(path, reduction_factor=0.3)
        assert len(backup) > 0

        # Verify weights were reduced
        for u, v, k in original_weights:
            current = float(G[u][v][k]["emergency_weight"])
            assert current < original_weights[(u, v, k)]

        # Restore
        restored = routing_engine.restore_corridor_weights(backup)
        assert restored == len(backup)

        # Verify weights are back to original
        for u, v, k in original_weights:
            current = float(G[u][v][k]["emergency_weight"])
            assert current == pytest.approx(original_weights[(u, v, k)], rel=0.001)


# ======================================================================
# NSGA-II Fleet Placeholder
# ======================================================================

class TestFleetDispatch:
    def test_fleet_routes_returned(self):
        G = graph_service.get_graph()
        nodes = list(G.nodes(data=True))
        first = nodes[0]
        mid = nodes[len(nodes) // 2]
        last = nodes[-1]

        fleet = FleetDispatchRequest(
            vehicles=[
                DispatchRequest(
                    origin=Coordinates(latitude=float(first[1]["y"]), longitude=float(first[1]["x"])),
                    destination=Coordinates(latitude=float(last[1]["y"]), longitude=float(last[1]["x"])),
                    vehicle_type="ambulance",
                ),
                DispatchRequest(
                    origin=Coordinates(latitude=float(mid[1]["y"]), longitude=float(mid[1]["x"])),
                    destination=Coordinates(latitude=float(first[1]["y"]), longitude=float(first[1]["x"])),
                    vehicle_type="fire_truck",
                ),
            ],
            optimize_for="min_total_eta",
        )

        routes = routing_engine.optimize_fleet_routes(fleet)
        assert len(routes) == 2

        for route in routes:
            assert route.total_distance_m > 0
            assert "fleet_optimised" in route.status
