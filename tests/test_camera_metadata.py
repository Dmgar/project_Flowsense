from copy import deepcopy
import json
import os
import threading

from src.services.mobility_service import MobilityService
from pathlib import Path

from src.services.camera_metadata import enrich_caltrans_route_metadata


def test_shipped_caltrans_records_enrich_four_exact_catalog_entries():
    root = Path(__file__).resolve().parents[1]
    cameras = {item["id"]: item for item in json.loads(
        (root / "data/public_cameras_los_angeles.json").read_text(encoding="utf-8"))}
    metadata = json.loads((root / "data/caltrans_camera_route_metadata.json").read_text(encoding="utf-8"))

    assert enrich_caltrans_route_metadata(cameras, metadata) == 4
    assert (cameras["caltrans-d7-1002"]["route"], cameras["caltrans-d7-1002"]["direction"]) == ("I-110", "North")
    assert (cameras["caltrans-d7-1030"]["route"], cameras["caltrans-d7-1030"]["direction"]) == ("I-110", "North")
    assert (cameras["caltrans-d7-1051"]["route"], cameras["caltrans-d7-1051"]["direction"]) == ("I-5", "North")
    assert (cameras["caltrans-d7-1235"]["route"], cameras["caltrans-d7-1235"]["direction"]) == ("I-10", "East")


def test_enriches_exact_caltrans_identity_and_coordinates_only():
    cameras = {
        "caltrans-d7-1002": {
            "id": "caltrans-d7-1002", "name": "I-110 : (186) Wilshire Blvd",
            "provider": "Caltrans", "lat": 34.0517, "lng": -118.2599,
            "route": None, "direction": None,
        },
        "caltrans-d7-custom": {
            "id": "caltrans-d7-custom", "name": "I-110 : (186) Wilshire Blvd",
            "provider": "Operator source", "lat": 34.0517, "lng": -118.2599,
        },
    }
    metadata = {"cameras": {"caltrans-d7-1002": {
        "official_index": 1002,
        "location_name": "I-110 : (186) Wilshire Blvd", "route": "I-110", "direction": "North",
        "latitude": 34.0517, "longitude": -118.2599,
    }, "caltrans-d7-custom": {
        "location_name": "I-110 : (186) Wilshire Blvd", "route": "I-110", "direction": "North",
        "latitude": 34.0517, "longitude": -118.2599,
    }}}

    assert enrich_caltrans_route_metadata(cameras, metadata) == 1
    assert cameras["caltrans-d7-1002"]["route"] == "I-110"
    assert cameras["caltrans-d7-1002"]["direction"] == "North"
    assert "route" not in cameras["caltrans-d7-custom"]


def test_rejects_changed_name_distant_camera_and_invalid_direction():
    camera = {"id": "caltrans-d7-1002", "name": "Renamed camera", "provider": "Caltrans",
              "lat": 34.0517, "lng": -118.2599, "route": None, "direction": None}
    entries = {
        "caltrans-d7-1002": {"official_index": 1002, "location_name": "I-110 : (186) Wilshire Blvd", "route": "I-110",
                              "direction": "North", "latitude": 34.0517, "longitude": -118.2599},
    }
    assert enrich_caltrans_route_metadata({camera["id"]: camera}, {"cameras": entries}) == 0

    camera["name"] = "I-110 : (186) Wilshire Blvd"
    entries[camera["id"]]["official_index"] = 888
    assert enrich_caltrans_route_metadata({camera["id"]: camera}, {"cameras": entries}) == 0

    entries[camera["id"]]["official_index"] = 1002
    entries[camera["id"]]["latitude"] += .01
    assert enrich_caltrans_route_metadata({camera["id"]: camera}, {"cameras": entries}) == 0

    entries[camera["id"]]["latitude"] = camera["lat"]
    entries[camera["id"]]["direction"] = "Northeast"
    assert enrich_caltrans_route_metadata({camera["id"]: camera}, {"cameras": entries}) == 0


def test_never_overwrites_existing_catalog_route_or_direction():
    camera = {"id": "caltrans-d7-1002", "name": "I-110 : (186) Wilshire Blvd", "provider": "Caltrans",
              "lat": 34.0517, "lng": -118.2599, "route": "I-110", "direction": "South"}
    original = deepcopy(camera)
    metadata = {"cameras": {camera["id"]: {
        "official_index": 1002,
        "location_name": camera["name"], "route": "I-110", "direction": "North",
        "latitude": camera["lat"], "longitude": camera["lng"],
    }}}
    assert enrich_caltrans_route_metadata({camera["id"]: camera}, metadata) == 0
    assert camera == original


def test_live_service_refreshes_exact_match_metadata_only_when_file_changes(tmp_path):
    camera = {
        "id": "caltrans-d7-1002", "name": "I-110 : (186) Wilshire Blvd",
        "provider": "Caltrans", "lat": 34.0517, "lng": -118.2599,
        "route": None, "direction": None,
    }
    metadata = {"cameras": {camera["id"]: {
        "official_index": 1002, "location_name": camera["name"],
        "route": "I-110", "direction": "North",
        "latitude": camera["lat"], "longitude": camera["lng"],
    }}}
    path = tmp_path / "routes.json"
    path.write_text(json.dumps(metadata), encoding="utf-8")

    service = object.__new__(MobilityService)
    service.cameras = {camera["id"]: camera}
    service.route_metadata_path = path
    service._route_metadata_mtime_ns = None
    service._registry_lock = threading.Lock()

    assert service.refresh_route_metadata() == 1
    assert service.cameras[camera["id"]]["route"] == "I-110"
    assert service.cameras[camera["id"]]["direction"] == "North"
    assert service.refresh_route_metadata() == 0

    second = {
        "id": "caltrans-d7-1030", "name": "I-110 : (185) 7th St",
        "provider": "Caltrans", "lat": 34.0504, "lng": -118.2619,
        "route": None, "direction": None,
    }
    metadata["cameras"][second["id"]] = {
        "official_index": 1030, "location_name": second["name"],
        "route": "I-110", "direction": "North",
        "latitude": second["lat"], "longitude": second["lng"],
    }
    service.cameras[second["id"]] = second
    path.write_text(json.dumps(metadata), encoding="utf-8")
    updated = service._route_metadata_mtime_ns + 1_000_000_000
    os.utime(path, ns=(updated, updated))

    assert service.refresh_route_metadata() == 1
    assert service.cameras[second["id"]]["route"] == "I-110"
