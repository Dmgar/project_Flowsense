import pytest
from fastapi.testclient import TestClient

def test_alternative_routes_endpoint(client: TestClient):
    payload = {
        "origin": {"latitude": 40.7490, "longitude": -73.9920},
        "destination": {"latitude": 40.7600, "longitude": -73.9780},
        "vehicle_type": "ambulance",
        "priority": "critical"
    }

    response = client.post("/api/v1/dispatch/alternatives?k=3", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "primary" in data
    assert "alternatives" in data
    assert len(data["alternatives"]) >= 1
    assert data["primary"]["total_distance_m"] > 0
    # Check overlap calculation on alternatives
    first_alt = data["alternatives"][0]
    assert "alternative" in first_alt["status"]

def test_fleet_dispatch_endpoint(client: TestClient):
    fleet_payload = {
        "vehicles": [
            {
                "origin": {"latitude": 40.7490, "longitude": -73.9920},
                "destination": {"latitude": 40.7600, "longitude": -73.9780},
                "vehicle_type": "ambulance",
                "priority": "critical"
            },
            {
                "origin": {"latitude": 40.7510, "longitude": -73.9850},
                "destination": {"latitude": 40.7620, "longitude": -73.9800},
                "vehicle_type": "fire_truck",
                "priority": "high"
            }
        ],
        "optimize_for": "min_total_eta"
    }

    response = client.post("/api/v1/dispatch/fleet", json=fleet_payload)
    assert response.status_code == 200
    routes = response.json()
    assert isinstance(routes, list)
    assert len(routes) == 2
    assert routes[0]["vehicle_type"] == "ambulance"
    assert routes[1]["vehicle_type"] == "fire_truck"

def test_reroute_endpoint(client: TestClient):
    # Initial route
    init_payload = {
        "origin": {"latitude": 40.7490, "longitude": -73.9920},
        "destination": {"latitude": 40.7600, "longitude": -73.9780},
        "vehicle_type": "ambulance",
        "priority": "critical"
    }
    init_route = client.post("/api/v1/dispatch/route", json=init_payload).json()
    route_id = init_route["route_id"]

    # Vehicle moved to intermediate position, requesting reroute
    reroute_payload = {
        "route_id": route_id,
        "current_position": {"latitude": 40.7530, "longitude": -73.9870},
        "destination": {"latitude": 40.7600, "longitude": -73.9780},
        "vehicle_type": "ambulance",
        "priority": "critical"
    }

    reroute_resp = client.post("/api/v1/dispatch/reroute", json=reroute_payload)
    assert reroute_resp.status_code == 200
    updated_route = reroute_resp.json()
    assert updated_route["route_id"] == route_id
    assert updated_route["recalculated"] is True
    assert updated_route["total_distance_m"] > 0

def test_corridor_preempt_and_restore_endpoints(client: TestClient):
    # Preempt corridor
    preempt_payload = {
        "path_nodes": [1000, 1001, 1002],
        "reduction_factor": 0.35
    }
    preempt_resp = client.post("/api/v1/dispatch/corridor/preempt", json=preempt_payload)
    assert preempt_resp.status_code == 200
    data = preempt_resp.json()
    assert data["status"] == "applied"
    corridor_id = data["corridor_id"]

    # Restore corridor
    restore_resp = client.post(f"/api/v1/dispatch/corridor/restore?corridor_id={corridor_id}")
    assert restore_resp.status_code == 200
    assert restore_resp.json()["status"] == "restored"
