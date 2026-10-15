"""Real LA graph, public camera inference and isolated review workflow smoke check.

Run from repo root: python -m scripts.verify_los_angeles_integration
Requires an installed ONNX model and downloaded LA graph; accesses one public
Caltrans image and uses temporary case ledgers, never the operator's case data.
"""
import os
from pathlib import Path
import tempfile
import sys


def main():
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    graph = root / "data/processed/los_angeles_regional_graph.graphml"
    model = root / "models/yolov8n.onnx"
    if not graph.is_file() or not model.is_file():
        raise FileNotFoundError("Run scripts/run_flowsense.ps1 -Setup before this check.")
    with tempfile.TemporaryDirectory(prefix="flowsense-la-check-") as sandbox:
        os.environ["FLOWSENSE_CITY"] = "los_angeles"
        os.environ["GRAPH_CACHE_FILE"] = str(graph)
        os.environ["DATA_PROCESSED_DIR"] = sandbox
        os.environ["PERCEPTION_MODEL_PATH"] = str(model)
        from fastapi.testclient import TestClient
        from src.main import app
        with TestClient(app) as client:
            health = client.get("/")
            assert health.status_code == 200 and health.json()["pilot_city"] == "Gran Los Angeles, California"
            cameras = client.get("/api/v1/mobility/cameras").json()
            assert len(cameras) >= 40
            assert {"Los Angeles", "Santa Monica", "Burbank", "El Monte", "West Covina", "Norwalk", "Long Beach"}.issubset({c["district"] for c in cameras})
            camera = next(c for c in cameras if c["id"] == "caltrans-d7-1002")
            image = client.get(camera["image_url"])
            assert image.status_code == 200 and image.headers["content-type"] == "image/jpeg"
            observation = client.get(f"/api/v1/mobility/cameras/{camera['id']}/observation")
            assert observation.status_code == 200, observation.text
            result = observation.json()
            assert result["inference_status"] == "ready", result
            assert sum(result["counts"].values()) == len(result["detections"])
            assert result["speed_kmh"] is None and result["provider_frame_time"] is None
            for detection in result["detections"]:
                assert 0 <= detection["bbox"]["x"] <= 1 and 0 <= detection["bbox"]["y"] <= 1
                assert 0 < detection["bbox"]["width"] <= 1 and 0 < detection["bbox"]["height"] <= 1
            exact_image = client.get(camera["image_url"] + "?frame_id=" + result["frame_id"])
            assert exact_image.status_code == 200
            route = client.post("/api/v1/dispatch/alternatives?k=3", json={
                "origin": {"latitude": 34.0437, "longitude": -118.2505},
                "destination": {"latitude": 34.0533, "longitude": -118.2657},
                "vehicle_type": "ambulance", "priority": "high"})
            assert route.status_code == 200, route.text
            assert route.json()["primary"]["total_distance_m"] > 0 and route.json()["alternatives"]
            case = client.post("/api/v1/mobility/cases", json={"signal_id": "integration-test",
                "title": "Public camera review test", "owner": "Test operations", "severity": "medium",
                "data_origin": "observation", "evidence_camera_id": camera["id"], "evidence_frame_id": result["frame_id"]})
            assert case.status_code == 200
            case_id = case.json()["id"]
            for status in ["assigned", "under_review", "confirmed", "resolved"]:
                reviewed = client.patch(f"/api/v1/mobility/cases/{case_id}", json={"status": status,
                    "owner": "Test operations", "note": "Functional test, no incident declaration."})
                assert reviewed.status_code == 200, reviewed.text
            assert len(reviewed.json()["audit"]) == 5
            assert client.get("/api/v1/mobility/reports/cases.csv").status_code == 200
            pdf = client.get("/api/v1/mobility/reports/cases.pdf")
            assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF-")
            print({"public_cameras": len(cameras), "inference": result["inference_status"],
                   "objects_in_frame": len(result["detections"]), "route_and_alternatives": "PASS",
                   "review_state_machine": "PASS", "exports": "PASS"})


if __name__ == "__main__":
    main()
