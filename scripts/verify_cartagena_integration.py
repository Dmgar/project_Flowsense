"""Verify the real Cartagena graph and API using disposable incident ledgers.

Run from the repository root: python -m scripts.verify_cartagena_integration
Requires data/processed/cartagena_graph.graphml; does not download or alter it.
"""
import os
import tempfile
from pathlib import Path


def main():
    graph_path = Path("data/processed/cartagena_graph.graphml").resolve()
    if not graph_path.is_file():
        raise FileNotFoundError("Download the Cartagena graph before running this check.")
    with tempfile.TemporaryDirectory(prefix="flowsense-cartagena-check-") as sandbox:
        os.environ["FLOWSENSE_CITY"] = "cartagena"
        os.environ["DATA_PROCESSED_DIR"] = sandbox
        os.environ["GRAPH_CACHE_FILE"] = str(graph_path)
        import networkx as nx
        from fastapi.testclient import TestClient
        from src.main import app
        from src.services.graph_service import graph_service
        from src.services.flood_intelligence import flood_intelligence

        with TestClient(app) as client:
            health = client.get("/")
            assert health.status_code == 200 and "Cartagena" in health.json()["pilot_city"]
            status = client.get("/api/v1/graph/status").json()
            assert status["city_profile"] == "cartagena" and not status["is_synthetic"]
            graph = graph_service.get_graph()
            component = max(nx.strongly_connected_components(graph), key=len)
            source = min(component)
            paths = nx.single_source_shortest_path(graph.subgraph(component), source, cutoff=12)
            target = max(paths.values(), key=len)[-1]
            payload = {
                "origin": {"latitude": graph.nodes[source]["y"], "longitude": graph.nodes[source]["x"]},
                "destination": {"latitude": graph.nodes[target]["y"], "longitude": graph.nodes[target]["x"]},
                "vehicle_type": "ambulance",
            }
            response = client.post("/api/v1/dispatch/route", json=payload)
            assert response.status_code == 200, response.text
            route = response.json()
            middle = route["path_node_ids"][len(route["path_node_ids"]) // 2]
            response = client.post("/api/v1/traffic/flood-reports", json={
                "latitude": graph.nodes[middle]["y"], "longitude": graph.nodes[middle]["x"],
                "depth_cm": 30, "radius_m": 10, "source": "integration check", "demo": True,
            })
            assert response.status_code == 200, response.text
            report = response.json()
            assert not flood_intelligence.blocked_nodes(graph, "ambulance")[0]
            report_url = "/api/v1/traffic/flood-reports/" + report["report_id"]
            assert client.post(report_url + "/confirm").status_code == 200
            blocked = flood_intelligence.blocked_nodes(graph, "ambulance")[0]
            assert middle in blocked
            response = client.post("/api/v1/dispatch/alternatives?k=3", json=payload)
            assert response.status_code == 200, response.text
            alternatives = response.json()
            for candidate in [alternatives["primary"], *alternatives["alternatives"]]:
                assert not (set(candidate["path_node_ids"]) & blocked)
            assert alternatives["resilience"]["flood_reports_considered"] == 1
            assert client.post(report_url + "/clear").status_code == 200
            assert not flood_intelligence.blocked_nodes(graph, "ambulance")[0]
            with client.websocket_connect("/ws/telemetry") as ws:
                ws.send_text("ping")
                assert client.post("/api/v1/dispatch/route", json=payload).status_code == 200
                assert ws.receive_json()["event"] == "route_update"
            print({"city": status["city_profile"], "nodes": status["node_count"],
                   "edges": status["edge_count"], "alternatives": len(alternatives["alternatives"]),
                   "flood_review_and_routing": "PASS", "websocket_route_update": "PASS"})


if __name__ == "__main__":
    main()
