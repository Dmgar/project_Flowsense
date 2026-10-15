"""Offline catalog integrity: no lost legacy evidence, fake coordinates, or missing cities."""
import json
from pathlib import Path


def test_regional_catalog_covers_requested_cities_and_preserves_evidence_ids():
    root = Path(__file__).resolve().parents[1]
    catalog = json.loads((root / "data/public_cameras_los_angeles.json").read_text(encoding="utf-8"))
    cities = {"Los Angeles", "Santa Monica", "Burbank", "El Monte", "West Covina", "Norwalk", "Long Beach"}
    assert len(catalog) >= 40
    assert len({c["id"] for c in catalog}) == len(catalog)
    assert len({c["image_url"] for c in catalog}) == len(catalog)
    assert cities.issubset({c["district"] for c in catalog})
    for city in cities:
        assert sum(c["district"] == city for c in catalog) >= 4
    assert [c["id"] for c in catalog[:8]] == ["caltrans-d7-1053", "caltrans-d7-1002", "caltrans-d7-1030",
        "caltrans-d7-1051", "caltrans-d7-1052", "caltrans-d7-1054", "caltrans-d7-1055", "caltrans-d7-1235"]
    verified = [c for c in catalog if c.get("verification") == "decodable_image"]
    assert len(verified) >= 40
    assert len({c["frame_sha256"] for c in verified}) == len(verified)
    for camera in catalog:
        assert -118.56 <= camera["lng"] <= -117.84 and 33.70 <= camera["lat"] <= 34.25
        assert camera["image_url"].startswith("https://cwwp2.dot.ca.gov/")
        assert camera["provider"] == "Caltrans"
