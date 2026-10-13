import pytest
from fastapi.testclient import TestClient
from src.services.signal_service import signal_service
from src.services.graph_service import graph_service
from src.models.schemas import RouteStep

def test_list_signals_endpoint(client: TestClient):
    response = client.get("/api/v1/signals")
    assert response.status_code == 200
    signals = response.json()
    assert isinstance(signals, list)
    assert len(signals) > 0
    first_sig = signals[0]
    assert "node_id" in first_sig
    assert "state" in first_sig
    assert first_sig["state"] in ("normal", "preempted")

def test_signal_preemption_lifecycle(client: TestClient):
    # Pick first signal node
    signals_resp = client.get("/api/v1/signals")
    target_node = signals_resp.json()[0]["node_id"]

    # Preempt
    preempt_resp = client.post(
        f"/api/v1/signals/{target_node}/preempt?vehicle_id=EMS-AMB-01&duration_seconds=15"
    )
    assert preempt_resp.status_code == 200
    preempted_data = preempt_resp.json()
    assert preempted_data["state"] == "preempted"
    assert preempted_data["preempted_by_vehicle"] == "EMS-AMB-01"

    # Verify active endpoint shows it
    active_resp = client.get("/api/v1/signals/active")
    assert active_resp.status_code == 200
    active_ids = [s["node_id"] for s in active_resp.json()]
    assert target_node in active_ids

    # Release
    release_resp = client.post(f"/api/v1/signals/{target_node}/release")
    assert release_resp.status_code == 200
    assert release_resp.json()["state"] == "normal"

def test_green_wave_corridor_ahead():
    import asyncio

    async def _run():
        G = graph_service.get_graph()
        nodes = list(G.nodes())[:5]
        waypoints = [
            RouteStep(
                node_id=int(n),
                latitude=G.nodes[n]["y"],
                longitude=G.nodes[n]["x"],
                length_m=150.0,
                congestion_factor=0.2,
                estimated_duration_s=12.0
            )
            for n in nodes
        ]

        cleared = await signal_service.update_green_wave_corridor(
            vehicle_id="EMS-TEST-99",
            current_wp_idx=0,
            waypoints=waypoints,
            clearance_lookahead_count=2
        )
        assert len(cleared) >= 2
        for nid in cleared:
            sig = signal_service._signals.get(nid)
            assert sig["state"] == "preempted"

        for nid in cleared:
            await signal_service.release_intersection(nid)

    asyncio.run(_run())


@pytest.mark.anyio
async def test_preempt_incident_edges_and_weight_update():
    G = graph_service.get_graph()
    target_node = list(G.nodes())[0]

    out_edges = list(G.out_edges(target_node, keys=True))
    if out_edges:
        u, v, k = out_edges[0]
        graph_service.update_edge_congestion(u, v, k, congestion_factor=0.8, vehicle_count=30, average_speed_kmh=15.0)
        weight_before = G[u][v][k]["emergency_weight"]

        # Preempt the node
        await signal_service.preempt_intersection(target_node, vehicle_id="EMS-PREEMPT-TEST")
        weight_after = G[u][v][k]["emergency_weight"]

        # Congestion factor should have been reduced and emergency_weight recomputed
        assert G[u][v][k]["congestion_factor"] == pytest.approx(0.24, abs=0.01)
        assert weight_after < weight_before

        await signal_service.release_intersection(target_node)


@pytest.mark.anyio
async def test_mock_simulator_mission_terminates_cleanly():
    from unittest.mock import patch
    from src.services.mock_simulator import simulator
    from src.services.routing_engine import routing_engine
    from src.models.schemas import DispatchRequest, Coordinates

    G = graph_service.get_graph()
    nodes = list(G.nodes())
    start_node, end_node = nodes[0], nodes[2]

    route = routing_engine.calculate_emergency_route(
        DispatchRequest(
            origin=Coordinates(latitude=G.nodes[start_node]["y"], longitude=G.nodes[start_node]["x"]),
            destination=Coordinates(latitude=G.nodes[end_node]["y"], longitude=G.nodes[end_node]["x"]),
            vehicle_type="ambulance",
            priority="high",
        )
    )

    with patch("asyncio.sleep", return_value=None):
        # Must terminate cleanly without infinite loop
        await simulator.run_mission_simulation(route, vehicle_id="EMS-FINISH-01")
        # All signals along route should have been released
        for wp in route.waypoints:
            sig = signal_service._signals.get(wp.node_id)
            if sig:
                assert sig["state"] == "normal"
