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
