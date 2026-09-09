from fastapi.testclient import TestClient

def test_health_check_root(client: TestClient):
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "operational"
    assert data["nodes"] > 0
    assert data["edges"] > 0
    assert "New York" in data["pilot_city"]

def test_graph_status_endpoint(client: TestClient):
    response = client.get("/api/v1/graph/status")
    assert response.status_code == 200
    data = response.json()
    assert "node_count" in data
    assert "edge_count" in data
    assert data["node_count"] > 0

def test_graph_geojson_endpoint(client: TestClient):
    response = client.get("/api/v1/graph/geojson")
    assert response.status_code == 200
    geojson = response.json()
    assert geojson["type"] == "FeatureCollection"
    assert len(geojson["features"]) > 0
    # Check that each feature has appropriate Leaflet properties
    first_feat = geojson["features"][0]
    assert "color" in first_feat["properties"]
    assert "congestion_factor" in first_feat["properties"]

def test_traffic_update_endpoint(client: TestClient):
    status_resp = client.get("/api/v1/graph/status")
    assert status_resp.status_code == 200

    # Get an edge from geojson to ensure it exists
    geojson_resp = client.get("/api/v1/graph/geojson")
    first_edge = geojson_resp.json()["features"][0]["properties"]
    u = first_edge["u"]
    v = first_edge["v"]

    update_payload = {
        "u": u,
        "v": v,
        "key": 0,
        "vehicle_count": 28,
        "average_speed_kmh": 22.5,
        "congestion_factor": 0.65,
        "camera_id": "NYC-CAM-MIDTOWN-04"
    }

    response = client.post("/api/v1/traffic/update", json=update_payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"

def test_dispatch_route_endpoint(client: TestClient):
    dispatch_payload = {
        "origin": {"latitude": 40.7500, "longitude": -73.9920},
        "destination": {"latitude": 40.7600, "longitude": -73.9780},
        "vehicle_type": "ambulance",
        "priority": "critical"
    }

    response = client.post("/api/v1/dispatch/route", json=dispatch_payload)
    assert response.status_code == 200
    route = response.json()
    assert "route_id" in route
    assert route["total_distance_m"] > 0
    assert route["total_estimated_time_s"] > 0
    assert len(route["waypoints"]) > 0
    assert route["geojson"]["type"] == "FeatureCollection"

def test_websocket_telemetry_channel(client: TestClient):
    with client.websocket_connect("/ws/telemetry") as websocket:
        websocket.send_text("client_ping")
