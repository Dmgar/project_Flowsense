import asyncio
import pytest
from pathlib import Path
from fastapi.testclient import TestClient
import networkx as nx

from src.main import app
from src.core.config import settings
from src.services import (
    graph_service,
    camera_service,
    replay_service,
    routing_engine,
    simulator,
    incident_intelligence,
    flood_intelligence,
)
from src.models.schemas import (
    IncidentCandidateInput,
    IncidentCandidate,
    FloodReportInput,
    FloodReport,
    Coordinates,
    DispatchRequest,
)
from src.api.websockets.connection_manager import manager


def test_schemas_and_services_exports():
    """Point 1: Verify IncidentCandidateInput, FloodReportInput, and intelligence instances."""
    candidate_in = IncidentCandidateInput(
        latitude=10.42,
        longitude=-75.54,
        event_type="collision",
        model_confidence=0.85,
    )
    assert candidate_in.event_type == "collision"

    flood_in = FloodReportInput(
        latitude=10.41,
        longitude=-75.53,
        depth_cm=25.0,
    )
    assert flood_in.depth_cm == 25.0
    assert hasattr(incident_intelligence, "analyze")
    assert hasattr(flood_intelligence, "create")
    assert settings.AMBULANCE_MAX_WATER_DEPTH_CM == 15.0
    assert settings.FIRE_TRUCK_MAX_WATER_DEPTH_CM == 45.0


def test_flood_confirm_and_clear_updates_graph(monkeypatch, tmp_path):
    """Point 1: When confirming flood report, affected edges in graph_service are updated."""
    monkeypatch.setattr(settings, "DATA_PROCESSED_DIR", tmp_path)
    monkeypatch.setattr(flood_intelligence, "db_path", tmp_path / "flood_test.sqlite3")
    with flood_intelligence._connect() as db:
        db.execute("CREATE TABLE IF NOT EXISTS flood_reports (report_id TEXT PRIMARY KEY, payload TEXT NOT NULL)")

    client = TestClient(app)

    # Broadcast recorder
    broadcasted_messages = []
    async def fake_broadcast(msg):
        broadcasted_messages.append(msg)
    monkeypatch.setattr(manager, "broadcast", fake_broadcast)

    # 1. Create a flood report exceeding ambulance depth (25 cm > 15 cm, but <= 45 cm)
    create_resp = client.post(
        "/api/v1/traffic/flood-reports",
        json={"latitude": 40.75, "longitude": -73.985, "depth_cm": 25.0, "radius_m": 200.0},
    )
    assert create_resp.status_code == 200
    report_id = create_resp.json()["report_id"]

    # 2. Confirm the report -> should update edges in graph_service and broadcast TRAFFIC_UPDATE
    confirm_resp = client.post(f"/api/v1/traffic/flood-reports/{report_id}/confirm")
    assert confirm_resp.status_code == 200
    assert confirm_resp.json()["status"] == "confirmed"

    # Verify graph_service has active incident
    assert report_id in graph_service.active_incidents
    incident_data = graph_service.active_incidents[report_id]
    assert len(incident_data["affected_nodes"]) > 0

    # Verify websocket events
    traffic_updates = [m for m in broadcasted_messages if m.event.value == "traffic_update"]
    assert any(m.data.get("incident_id") == report_id for m in traffic_updates)

    # 3. Clear the report -> should clear incident in graph_service and broadcast reset
    clear_resp = client.post(f"/api/v1/traffic/flood-reports/{report_id}/clear")
    assert clear_resp.status_code == 200
    assert report_id not in graph_service.active_incidents

    reset_updates = [m for m in broadcasted_messages if m.event.value == "traffic_update" and m.data.get("status") == "reset"]
    assert any(m.data.get("incident_id") == report_id for m in reset_updates)


def test_cartagena_cameras_loaded_in_arteries(monkeypatch):
    """Point 2: If CITY_PROFILE == 'cartagena', real Cartagena cameras are registered."""
    monkeypatch.setattr(settings, "CITY_PROFILE", "cartagena")
    camera_service._initialized = False
    camera_service._cameras.clear()

    cameras = camera_service.get_all_cameras()
    cam_names = [c.name for c in cameras]

    expected_arteries = [
        "Pedro de Heredia",
        "Torre del Reloj",
        "Bazurto",
        "Bocagrande",
        "Ronda Real",
        "Marbella",
        "Ceballos",
        "El Amparo",
    ]
    for artery in expected_arteries:
        assert any(artery.lower() in name.lower() for name in cam_names), f"Missing artery: {artery}"

    # Reset back
    camera_service._initialized = False
    camera_service._cameras.clear()


def test_replay_service_under_cartagena(monkeypatch):
    """Point 2: ReplayService._build_synthetic_session does not throw ValueError in Cartagena."""
    monkeypatch.setattr(settings, "CITY_PROFILE", "cartagena")
    monkeypatch.setattr(settings, "MAP_CENTER_LATITUDE", 10.3910)
    monkeypatch.setattr(settings, "MAP_CENTER_LONGITUDE", -75.4794)

    session = replay_service._build_synthetic_session(total_frames=5)
    assert len(session) == 5
    assert "vehicles" in session[0]
    assert len(session[0]["vehicles"]) > 0


def test_no_duplicate_dispatch_fleet_route():
    """Point 3: POST /dispatch/fleet must not be duplicated in /perception."""
    client = TestClient(app)
    # /api/v1/dispatch/fleet is active
    fleet_payload = {
        "vehicles": [
            {
                "origin": {"latitude": 40.75, "longitude": -73.985},
                "destination": {"latitude": 40.755, "longitude": -73.98},
                "vehicle_type": "ambulance",
            }
        ],
        "optimize_for": "min_total_eta",
    }
    resp = client.post("/api/v1/dispatch/fleet", json=fleet_payload)
    assert resp.status_code in (200, 400)

    # /api/v1/perception/dispatch/fleet does not exist
    resp_perception = client.post("/api/v1/perception/dispatch/fleet", json=fleet_payload)
    assert resp_perception.status_code in (404, 405)


@pytest.mark.anyio
async def test_traffic_task_reference_stored_and_cancelled():
    """Point 3: start_simulated_traffic sets simulator._traffic_task which stop cancels."""
    from src.api.routes.dispatch import start_simulated_traffic, stop_simulated_traffic
    simulator.stop_traffic_simulation()

    resp_start = await start_simulated_traffic(interval_seconds=10.0)
    assert resp_start["status"] == "started"
    assert simulator._traffic_task is not None
    assert not simulator._traffic_task.done()

    resp_stop = await stop_simulated_traffic()
    assert resp_stop["status"] == "stopped"
    assert not simulator.is_simulating_traffic
    await asyncio.sleep(0.01)
    assert simulator._traffic_task.cancelled() or simulator._traffic_task.done()


def test_rebroadcast_graph_reset_and_incident_clear(monkeypatch):
    """Point 3: /graph/reset and /incident/{id}/clear re-broadcast TRAFFIC_UPDATE with status: reset."""
    broadcasted = []
    async def fake_broadcast(msg):
        broadcasted.append(msg)
    monkeypatch.setattr(manager, "broadcast", fake_broadcast)

    client = TestClient(app)

    # 1. Test /graph/reset
    resp_reset = client.post("/api/v1/graph/reset")
    assert resp_reset.status_code == 200
    reset_events = [m for m in broadcasted if m.event.value == "traffic_update" and m.data.get("status") == "reset"]
    assert len(reset_events) > 0

    # 2. Test /incident/{id}/clear
    inc_resp = client.post(
        "/api/v1/traffic/incident",
        json={"latitude": 40.75, "longitude": -73.985, "radius_m": 150, "description": "Crash test"},
    )
    inc_id = inc_resp.json()["incident_id"]

    broadcasted.clear()
    clear_resp = client.post(f"/api/v1/traffic/incident/{inc_id}/clear")
    assert clear_resp.status_code == 200

    incident_reset_events = [
        m for m in broadcasted
        if m.event.value == "traffic_update" and m.data.get("status") == "reset" and m.data.get("incident_id") == inc_id
    ]
    assert len(incident_reset_events) > 0


def test_cartagena_ps1_bbox_order():
    """Point 5: Verify run_cartagena_pilot.ps1 uses (WEST, SOUTH, EAST, NORTH) bbox order."""
    ps1_path = Path("scripts/run_cartagena_pilot.ps1")
    content = ps1_path.read_text(encoding="utf-8")
    assert "--bbox -75.62 10.31 -75.42 10.50" in content
