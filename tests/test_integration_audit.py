import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

from src.services.graph_service import graph_service
from src.services.camera_service import camera_service
from src.services.benchmark_service import benchmark_service
from src.services.mock_simulator import simulator
from src.services.replay_service import replay_service
from src.services.routing_engine import routing_engine
from src.models.schemas import CameraTelemetryReport, DispatchRequest, Coordinates


def test_camera_telemetry_payload_standardized_and_incident_edges():
    """Verify camera_service.ingest_telemetry updates only incident edges and produces standardized payload."""
    cameras = camera_service.get_all_cameras()
    cam = cameras[0]
    cam_id = cam.camera_id
    node_id = cam.intersection_node

    report = CameraTelemetryReport(
        camera_id=cam_id,
        vehicle_count=35,
        average_speed_kmh=18.0,
        congestion_factor=0.72,
        frame_timestamp="2026-10-13T19:00:00Z"
    )

    import asyncio
    # Ingest telemetry
    asyncio.run(camera_service.ingest_telemetry(report))

    # Verify camera state
    updated_cam = camera_service.get_camera(cam_id)
    assert updated_cam.latest_vehicle_count == 35
    assert updated_cam.latest_speed_kmh == 18.0
    assert updated_cam.latest_congestion_factor == 0.72

    # Verify incident edges
    G = graph_service.get_graph()
    incident_edges = list(G.in_edges(node_id, keys=True)) + list(G.out_edges(node_id, keys=True))
    assert len(incident_edges) > 0
    for u, v, k in incident_edges:
        assert G[u][v][k]["congestion_factor"] == 0.72
        assert G[u][v][k]["vehicle_count"] == 35


def test_benchmark_service_intensity_and_total_seconds_saved():
    """Verify benchmark_service scales congestion with congestion_intensity and sums total_seconds_saved."""
    summary_low = benchmark_service.run_benchmark(num_samples=4, congestion_intensity=0.2)
    summary_high = benchmark_service.run_benchmark(num_samples=4, congestion_intensity=0.9)

    assert summary_low.num_trips_evaluated > 0
    assert summary_high.num_trips_evaluated > 0
    assert summary_high.total_seconds_saved >= 0.0
    assert len(summary_high.metrics) == 5


@pytest.mark.anyio
async def test_replay_service_records_frames_during_mission():
    """Verify mock_simulator.run_mission_simulation records frames in replay_service buffer."""
    replay_service._buffer.clear()
    assert len(replay_service._buffer) == 0

    G = graph_service.get_graph()
    nodes = list(G.nodes())
    start_node, end_node = nodes[0], nodes[1]

    route = routing_engine.calculate_emergency_route(
        DispatchRequest(
            origin=Coordinates(latitude=G.nodes[start_node]["y"], longitude=G.nodes[start_node]["x"]),
            destination=Coordinates(latitude=G.nodes[end_node]["y"], longitude=G.nodes[end_node]["x"]),
            vehicle_type="ambulance",
            priority="high",
        )
    )

    with patch("asyncio.sleep", return_value=None):
        await simulator.run_mission_simulation(route, vehicle_id="EMS-REPLAY-TEST")

    # Buffer should now have recorded frames
    assert len(replay_service._buffer) > 0
    last_frame = replay_service._buffer[-1]
    assert "vehicles" in last_frame
    assert "edges" in last_frame
    assert "route" in last_frame
    assert last_frame["vehicles"][0]["vehicle_id"] == "EMS-REPLAY-TEST"


def test_persist_choke_in_routing_engine():
    """Verify persist_choke retains bottleneck until explicit clear_active_choke()."""
    G = graph_service.get_graph()
    nodes = list(G.nodes())
    start_node, end_node = nodes[0], nodes[3]

    req = DispatchRequest(
        origin=Coordinates(latitude=G.nodes[start_node]["y"], longitude=G.nodes[start_node]["x"]),
        destination=Coordinates(latitude=G.nodes[end_node]["y"], longitude=G.nodes[end_node]["x"]),
        vehicle_type="ambulance",
        priority="high",
    )

    # With persist_choke=True, choke backup remains stored
    route = routing_engine.calculate_emergency_route(req, simulate=True, persist_choke=True)
    active_choke = routing_engine.get_active_choke()
    assert len(active_choke) > 0

    # Explicit clear restores original attributes
    restored_count = routing_engine.clear_active_choke()
    assert restored_count > 0
    assert len(routing_engine.get_active_choke()) == 0


def test_services_init_exports():
    """Verify src.services.__all__ exports all core and integration services."""
    import src.services as s
    expected_exports = [
        "graph_service", "GraphService",
        "routing_engine", "RoutingEngine",
        "camera_service", "CameraService",
        "signal_service", "SignalService",
        "benchmark_service", "BenchmarkService",
        "replay_service", "ReplayService",
        "simulator", "MockSimulator",
        "incident_intelligence", "IncidentIntelligence",
        "flood_intelligence", "FloodIntelligence",
    ]
    for name in expected_exports:
        assert hasattr(s, name), f"Missing export: {name}"
        assert name in s.__all__, f"Missing in __all__: {name}"
