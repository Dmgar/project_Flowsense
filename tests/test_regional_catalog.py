"""Offline catalog integrity: no lost legacy evidence, fake coordinates, or missing cities."""
import json
import importlib.util
from pathlib import Path
import pytest


@pytest.fixture
def catalog_builder():
    path = Path(__file__).resolve().parents[1] / "scripts/expand_public_cameras.py"
    spec = importlib.util.spec_from_file_location("expand_public_cameras", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_verification_gate_requires_distinct_frames_and_unique_source_references(catalog_builder):
    regions = list(catalog_builder.GROUPS)
    cameras = [{"id": str(i), "image_url": f"https://example.com/{i}.jpg", "district": regions[i % len(regions)],
                "verification": "decodable_image", "frame_sha256": f"unique-{i}"} for i in range(40)]
    assert len(catalog_builder.validate_catalog(cameras)) == 40
    with pytest.raises(RuntimeError):
        catalog_builder.validate_catalog(cameras + [{**cameras[0], "id": "copy", "image_url": "https://example.com/copy.jpg"}])
    with pytest.raises(RuntimeError):
        catalog_builder.validate_catalog([{**camera, "frame_sha256": "same-frame"} for camera in cameras])
    with pytest.raises(RuntimeError):
        catalog_builder.validate_catalog([{**camera, "id": "same-id"} for camera in cameras])
    with pytest.raises(RuntimeError):
        catalog_builder.validate_catalog([{**camera, "image_url": "https://example.com/same.jpg"} for camera in cameras])


def test_failed_catalog_write_keeps_the_previous_file_intact(catalog_builder, tmp_path, monkeypatch):
    target = tmp_path / "catalog.json"
    target.write_text('["previous catalog"]', encoding="utf-8")
    def fail_during_serialization(value, output, **kwargs):
        output.write('{"partial":')
        raise OSError("Interrupted write")
    monkeypatch.setattr(catalog_builder.json, "dump", fail_during_serialization)
    with pytest.raises(OSError):
        catalog_builder.write_json_atomic(target, {"new": "catalog"})
    assert json.loads(target.read_text(encoding="utf-8")) == ["previous catalog"]
    assert list(tmp_path.iterdir()) == [target]


def test_catalog_refresh_preserves_all_published_ids_and_city_assignments(catalog_builder):
    module = catalog_builder
    old = [{"id": "original", "image_url": "https://example.com/a.jpg", "district": "Burbank"},
           {"id": "later-source", "image_url": "https://example.com/b.jpg", "district": "Long Beach", "stream_url": "old.m3u8"}]
    selected = [{"id": "provider-renumbered", "image_url": old[0]["image_url"], "district": "Burbank", "verification": "decodable_image"},
                {"id": "new", "image_url": "https://example.com/c.jpg", "district": "Norwalk"}]
    result = module.preserve_catalog(selected, old)
    assert [c["id"] for c in result] == ["original", "later-source", "new"]
    assert result[1]["district"] == "Long Beach"
    assert result[1]["verification"] == "unavailable" and not result[1]["stream_url"]
    reused = module.preserve_catalog([{**selected[1], "id": "original"}], old)
    assert reused[0]["image_url"] == old[0]["image_url"]
    assert reused[2]["id"].startswith("original-")
    assert len({c["id"] for c in reused}) == 3


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
