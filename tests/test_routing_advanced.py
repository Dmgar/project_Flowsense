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


# ======================================================================
# Verification of Audit Improvements
# ======================================================================

class TestAuditCorrections:
    def test_astar_heuristic_admissibility(self):
        """Verify that scaled Haversine heuristic h(u, v) <= c(u, v) across all direct edges."""
        from src.services.routing_engine import _make_haversine_heuristic
        G = graph_service.get_graph()
        nodes = list(G.nodes())
        sample_target = nodes[-1]
        heuristic = _make_haversine_heuristic(G, sample_target)

        # For every direct neighbor of target, h(neighbor, target) must be <= edge weight
        for u, v, k, data in G.in_edges(sample_target, keys=True, data=True):
            h_val = heuristic(u, sample_target)
            w_e = float(data.get("emergency_weight", 100.0))
            assert h_val <= w_e + 1e-3, f"Heuristic {h_val} overestimates edge weight {w_e}"

    def test_simulation_state_isolation(self):
        """Verify that simulate=True in calculate_emergency_route leaves no lingering choked edges."""
        req = DispatchRequest(
            origin=Coordinates(latitude=40.7500, longitude=-73.9900),
            destination=Coordinates(latitude=40.7600, longitude=-73.9800),
            vehicle_type="ambulance",
            priority="high",
        )
        graph_service.reset_all_congestion()
        G = graph_service.get_graph()

        # Capture free flow weights
        pre_weights = {
            (u, v, k): float(data["emergency_weight"])
            for u, v, k, data in G.edges(keys=True, data=True)
        }

        # Run simulation mode
        route = routing_engine.calculate_emergency_route(req, simulate=True)
        assert route.savings_pct > 0

        # Verify weights were restored cleanly after calculation
        for (u, v, k), orig_w in pre_weights.items():
            post_w = float(G[u][v][k]["emergency_weight"])
            assert post_w == pytest.approx(orig_w, rel=0.001)

    def test_recompute_edge_weight_formula(self):
        """Verify graph_service.recompute_edge_weight integrates incident and corridor multipliers."""
        G = graph_service.get_graph()
        edge = next(iter(G.edges(keys=True)))
        u, v, k = edge

        data = G[u][v][k]
        data["congestion_factor"] = 0.5
        data["incident_multiplier"] = 2.0
        data["corridor_multiplier"] = 0.5

        w = graph_service.recompute_edge_weight(u, v, k)
        # Expected: length * (1 + 3 * 0.5) * road_class_factor * 2.0 * 0.5 = length * 2.5 * road_class_factor
        raw_len = float(data["length"])
        road_class_factor = 0.85 if ("primary" in str(data.get("highway", "")) or "trunk" in str(data.get("highway", ""))) else 1.0
        expected = raw_len * (1.0 + 3.0 * 0.5) * road_class_factor * 2.0 * 0.5
        assert w == pytest.approx(round(expected, 3), rel=0.001)

        # Reset back
        data["congestion_factor"] = 0.0
        data["incident_multiplier"] = 1.0
        data["corridor_multiplier"] = 1.0
        graph_service.recompute_edge_weight(u, v, k)

    def test_to_geojson_edge_geometry_and_int_types(self):
        """Verify to_geojson outputs integer node IDs and valid GeoJSON geometries."""
        geojson = graph_service.to_geojson()
        assert geojson["type"] == "FeatureCollection"
        assert len(geojson["features"]) > 0

        feature = geojson["features"][0]
        assert isinstance(feature["properties"]["u"], int)
        assert isinstance(feature["properties"]["v"], int)
        assert len(feature["geometry"]["coordinates"]) >= 2
