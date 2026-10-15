"""Read-only live regional checks; never creates cases or dispatches vehicles."""
import json
from pathlib import Path
import cv2
import numpy as np
import requests

BASE = "http://127.0.0.1:8002"
CENTERS = {"Los Angeles": (34.0522, -118.2437), "Santa Monica": (34.0259, -118.4894),
    "Burbank": (34.1808, -118.3090), "El Monte": (34.0686, -118.0276),
    "West Covina": (34.0686, -117.9389), "Norwalk": (33.9022, -118.0817), "Long Beach": (33.7701, -118.1937)}


def main():
    health = requests.get(BASE + "/", timeout=15).json()
    cameras = requests.get(BASE + "/api/v1/mobility/cameras", timeout=15).json()
    assert len(cameras) >= 40 and health["nodes"] > 15000
    checks = []
    for city, (lat, lng) in CENTERS.items():
        camera = next(c for c in cameras if c["district"] == city and c.get("verification") == "decodable_image")
        response = requests.get(BASE + camera["image_url"], timeout=20)
        response.raise_for_status()
        frame = cv2.imdecode(np.frombuffer(response.content, dtype=np.uint8), cv2.IMREAD_COLOR)
        assert frame is not None
        observation = requests.get(BASE + f"/api/v1/mobility/cameras/{camera['id']}/observation", timeout=20).json()
        assert observation["counts"] is None or sum(observation["counts"].values()) == len(observation["detections"])
        route = requests.post(BASE + "/api/v1/dispatch/route", timeout=30, json={
            "origin": {"latitude": 34.0522, "longitude": -118.2437},
            "destination": {"latitude": lat, "longitude": lng}, "vehicle_type": "ambulance", "priority": "high"})
        route.raise_for_status()
        checks.append({"region": city, "camera": camera["id"], "snapshot": response.status_code,
            "inference": observation["inference_status"], "distance_m": route.json()["total_distance_m"]})
    target = Path(__file__).resolve().parents[1] / "output/catalog/regional-integration-check.json"
    target.write_text(json.dumps({"health": health, "catalog_count": len(cameras), "checks": checks}, indent=2), encoding="utf-8")
    print(json.dumps(checks, indent=2))


if __name__ == "__main__":
    main()
