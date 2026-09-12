import pytest
from fastapi.testclient import TestClient
from src.services.graph_service import graph_service
from src.services.camera_service import camera_service

def test_list_cameras_endpoint(client: TestClient):
    response = client.get("/api/v1/cameras")
    assert response.status_code == 200
    cameras = response.json()
    assert isinstance(cameras, list)
    assert len(cameras) >= 6
    first_cam = cameras[0]
    assert "camera_id" in first_cam
    assert "status" in first_cam
    assert "latitude" in first_cam
    assert "longitude" in first_cam

def test_cameras_geojson_endpoint(client: TestClient):
    response = client.get("/api/v1/cameras/geojson")
    assert response.status_code == 200
    fc = response.json()
    assert fc["type"] == "FeatureCollection"
    assert len(fc["features"]) >= 6
    feat = fc["features"][0]
    assert feat["geometry"]["type"] == "Point"
    assert len(feat["geometry"]["coordinates"]) == 2
    assert "camera_id" in feat["properties"]

def test_camera_telemetry_ingestion_updates_graph(client: TestClient):
    cameras = client.get("/api/v1/cameras").json()
    cam = cameras[0]
    cam_id = cam["camera_id"]
    node_id = cam["intersection_node"]

    # Ingest detection from OpenCV 5
    telemetry_payload = {
        "camera_id": cam_id,
        "vehicle_count": 48,
        "average_speed_kmh": 14.5,
        "congestion_factor": 0.85,
        "frame_timestamp": "2026-09-11T23:30:00Z"
    }

    post_resp = client.post(f"/api/v1/cameras/{cam_id}/telemetry", json=telemetry_payload)
    assert post_resp.status_code == 200
    updated_cam = post_resp.json()
    assert updated_cam["latest_vehicle_count"] == 48
    assert updated_cam["latest_congestion_factor"] == 0.85

    # Check that connected road edges in the graph received this congestion factor
    G = graph_service.get_graph()
    connected_edges = [
        data for u, v, k, data in G.edges(keys=True, data=True)
        if u == node_id or v == node_id
    ]
    assert len(connected_edges) > 0
    # At least one edge must match the updated congestion
    has_matching_cg = any(edge.get("congestion_factor") == 0.85 for edge in connected_edges)
    assert has_matching_cg
