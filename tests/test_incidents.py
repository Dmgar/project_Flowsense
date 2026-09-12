import pytest
from fastapi.testclient import TestClient
from src.services.graph_service import graph_service
from src.services.routing_engine import routing_engine
from src.models.schemas import DispatchRequest, Coordinates

def test_incident_injection_and_evasion(client: TestClient):
    # Base route without incidents
    req = DispatchRequest(
        origin=Coordinates(latitude=40.7500, longitude=-73.9920),
        destination=Coordinates(latitude=40.7600, longitude=-73.9780),
        vehicle_type="ambulance",
        priority="critical"
    )
    base_route = routing_engine.calculate_emergency_route(req)
    assert len(base_route.waypoints) >= 2

    # Inject incident on a waypoint halfway through the route
    target_wp = base_route.waypoints[len(base_route.waypoints) // 2]
    incident_payload = {
        "latitude": target_wp.latitude,
        "longitude": target_wp.longitude,
        "description": "Accidente vehicular múltiple e incendio",
        "severity": "critical",
        "radius_m": 200.0,
        "block_traffic": True
    }

    inc_resp = client.post("/api/v1/traffic/incident", json=incident_payload)
    assert inc_resp.status_code == 200
    inc_data = inc_resp.json()
    assert inc_data["affected_edges_count"] > 0
    incident_id = inc_data["incident_id"]

    # Re-route should calculate a new route
    rerouted = routing_engine.calculate_emergency_route(req)
    assert rerouted.route_id != base_route.route_id

    # Clear incident
    clear_resp = client.post(f"/api/v1/traffic/incident/{incident_id}/clear")
    assert clear_resp.status_code == 200
    assert clear_resp.json()["status"] == "cleared"

def test_replay_latest_endpoint(client: TestClient):
    response = client.get("/api/v1/replay/latest?frames=15")
    assert response.status_code == 200
    frames = response.json()
    assert isinstance(frames, list)
    assert len(frames) == 15
    first_frame = frames[0]
    assert "timestamp" in first_frame
    assert "vehicles" in first_frame
    assert "edges" in first_frame
