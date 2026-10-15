"""Regressions at the Cartagena pilot / upstream routing integration boundary."""
import networkx as nx
import pytest

from src.models.schemas import Coordinates, DispatchRequest, FleetDispatchRequest
from src.services.flood_intelligence import flood_intelligence
from src.services.graph_service import graph_service
from src.services.routing_engine import RoutingEngine


@pytest.fixture
def road_graph(monkeypatch):
    graph = nx.MultiDiGraph()
    for node in range(1, 6):
        graph.add_node(node, y=10.0, x=-75.0 + node * 0.001)
    for u, v, length in [(1, 2, 100), (2, 4, 100), (1, 3, 140), (3, 4, 140)]:
        graph.add_edge(u, v, length=length, emergency_weight=float(length),
                       congestion_factor=0.0, vehicle_count=0, average_speed_kmh=45.0,
                       incident_multiplier=1.0, corridor_multiplier=1.0)
    monkeypatch.setattr(graph_service, "graph", graph)
    monkeypatch.setattr(graph_service, "find_nearest_node",
                        lambda lat, lon, **kw: min(graph, key=lambda n: abs(graph.nodes[n]["x"] - lon)))
    monkeypatch.setattr(flood_intelligence, "blocked_nodes", lambda graph, vehicle: ({5}, 1, 1))
    return graph


def request_between(graph, source=1, target=4):
    return DispatchRequest(
        origin=Coordinates(latitude=graph.nodes[source]["y"], longitude=graph.nodes[source]["x"]),
        destination=Coordinates(latitude=graph.nodes[target]["y"], longitude=graph.nodes[target]["x"]),
        vehicle_type="ambulance",
    )


def test_astar_remains_optimal_with_deep_clearance_discounts(road_graph):
    engine = RoutingEngine()
    road_graph[1][2][0]["emergency_weight"] = 10.0
    road_graph[2][4][0]["emergency_weight"] = 10.0
    road_graph[1][3][0]["emergency_weight"] = 1.0
    road_graph[3][4][0]["emergency_weight"] = 1.0
    assert engine._find_path_astar(road_graph, 1, 4) == [1, 3, 4]
    assert engine._find_path_astar(road_graph, 1, 4, "length") == [1, 2, 4]


def test_simulated_traffic_reaches_flood_filtered_graph(road_graph):
    route = RoutingEngine().calculate_emergency_route(request_between(road_graph), simulate=True)
    assert route.path_node_ids == [1, 3, 4]
    assert route.savings_pct > 0
    assert all(data["congestion_factor"] == 0 for _, _, data in road_graph.edges(data=True))


def test_repeated_persistent_dispatch_restores_original_traffic(road_graph):
    engine = RoutingEngine()
    request = request_between(road_graph)
    engine.calculate_emergency_route(request, simulate=True, persist_choke=True)
    engine.calculate_emergency_route(request, simulate=True, persist_choke=True)
    assert engine.clear_active_choke() == 2
    assert all(data["congestion_factor"] == 0 for _, _, data in road_graph.edges(data=True))
    assert engine.get_active_choke() == []


def test_failed_dispatch_does_not_leave_persistent_demo_traffic(road_graph, monkeypatch):
    engine = RoutingEngine()
    def fail(*args):
        raise ValueError("route could not be built")
    monkeypatch.setattr(engine, "_build_route", fail)
    with pytest.raises(ValueError, match="could not be built"):
        engine.calculate_emergency_route(request_between(road_graph), simulate=True, persist_choke=True)
    assert engine.get_active_choke() == []
    assert all(data["congestion_factor"] == 0 for _, _, data in road_graph.edges(data=True))


def test_fleet_reports_unreachable_vehicle_instead_of_partial_success(road_graph):
    fleet = FleetDispatchRequest(vehicles=[request_between(road_graph), request_between(road_graph, 4, 1)])
    with pytest.raises(ValueError, match="unidad 2"):
        RoutingEngine().optimize_fleet_routes(fleet)


def test_single_route_preserves_flood_assessment(road_graph):
    response = RoutingEngine().calculate_alternative_routes(request_between(road_graph), k=1)
    assert response.resilience.status == "no_backup"
    assert response.resilience.flood_reports_considered == 1
    assert response.resilience.flood_reports_excluded_by_vehicle == 1


def test_fleet_endpoint_returns_actionable_error(road_graph, monkeypatch):
    from fastapi.testclient import TestClient
    from src.main import app
    monkeypatch.setattr(graph_service, "initialize", lambda: None)
    fleet = FleetDispatchRequest(vehicles=[request_between(road_graph), request_between(road_graph, 4, 1)])
    with TestClient(app) as client:
        response = client.post("/api/v1/dispatch/fleet", json=fleet.model_dump())
    assert response.status_code == 400
    assert "unidad 2" in response.json()["detail"]


def test_ledgers_close_connections_after_read_and_write(tmp_path, monkeypatch):
    from src.core.config import settings
    from src.models.schemas import FloodReportInput, IncidentCandidateInput
    from src.services.flood_intelligence import FloodIntelligence
    from src.services.incident_intelligence import IncidentIntelligence
    monkeypatch.setattr(settings, "DATA_PROCESSED_DIR", tmp_path)
    floods = FloodIntelligence()
    floods.create(FloodReportInput(latitude=10.39, longitude=-75.48, depth_cm=20))
    assert len(floods.list()) == 1
    incidents = IncidentIntelligence()
    incidents.analyze(IncidentCandidateInput(latitude=10.39, longitude=-75.48,
                                           event_type="collision", model_confidence=0.8))
    assert len(IncidentIntelligence().list()) == 1
    # Windows refuses this while an SQLite connection still owns the file.
    floods.db_path.unlink()
    incidents.database_path.unlink()
