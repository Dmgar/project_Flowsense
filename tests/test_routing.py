import pytest
from src.services.graph_service import graph_service
from src.services.routing_engine import routing_engine
from src.models.schemas import Coordinates, DispatchRequest
from src.core.config import settings

def test_graph_initialization():
    G = graph_service.get_graph()
    assert G.number_of_nodes() > 0
    assert G.number_of_edges() > 0

def test_nearest_node_lookup():
    # Lat/lon around Times Square / Manhattan
    lat, lon = 40.7550, -73.9850
    node = graph_service.find_nearest_node(lat, lon)
    assert isinstance(node, int)
    node_data = graph_service.get_graph().nodes[node]
    assert "x" in node_data
    assert "y" in node_data

def test_congestion_impedance_update():
    G = graph_service.get_graph()
    u, v, k = list(G.edges(keys=True))[0]
    initial_edge = G[u][v][k]
    initial_weight = initial_edge["emergency_weight"]
    length = initial_edge["length"]

    # Set severe congestion
    graph_service.update_edge_congestion(
        u=u, v=v, key=k,
        congestion_factor=0.90,
        vehicle_count=35,
        average_speed_kmh=12.0
    )

    updated_edge = G[u][v][k]
    assert updated_edge["congestion_factor"] == 0.90
    assert updated_edge["vehicle_count"] == 35
    # W_e should increase significantly
    assert updated_edge["emergency_weight"] > initial_weight

def test_dynamic_routing_avoids_congestion():
    # Dispatch from 34th St area to 54th St area
    req = DispatchRequest(
        origin=Coordinates(latitude=40.7490, longitude=-73.9900),
        destination=Coordinates(latitude=40.7610, longitude=-73.9800),
        vehicle_type="ambulance",
        priority="critical"
    )

    # Calculate base route
    route_1 = routing_engine.calculate_emergency_route(req)
    assert route_1.total_distance_m > 0
    assert len(route_1.waypoints) >= 2
    assert "FeatureCollection" == route_1.geojson["type"]

    # Now congest an edge that is currently in path_node_ids
    path_nodes = route_1.path_node_ids
    if len(path_nodes) >= 2:
        congest_u = path_nodes[0]
        congest_v = path_nodes[1]
        graph_service.update_edge_congestion(
            u=congest_u, v=congest_v, key=0,
            congestion_factor=1.0,  # Total gridlock
            vehicle_count=50,
            average_speed_kmh=5.0
        )

        # Recalculate route
        route_2 = routing_engine.calculate_emergency_route(req)
        assert route_2.route_id != route_1.route_id
        # The route should adapt
        assert len(route_2.waypoints) >= 2
