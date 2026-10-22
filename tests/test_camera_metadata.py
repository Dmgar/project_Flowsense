from copy import deepcopy
import json
import os
import threading

from src.services.mobility_service import MobilityService
from pathlib import Path

from src.services.camera_metadata import enrich_caltrans_route_metadata, refresh_caltrans_video_sources


def test_shipped_caltrans_records_enrich_four_exact_catalog_entries():
    root = Path(__file__).resolve().parents[1]
    cameras = {item["id"]: item for item in json.loads(
        (root / "data/public_cameras_los_angeles.json").read_text(encoding="utf-8"))}
    metadata = json.loads((root / "data/caltrans_camera_route_metadata.json").read_text(encoding="utf-8"))

    assert enrich_caltrans_route_metadata(cameras, metadata) == 4
    assert (cameras["caltrans-d7-1002"]["route"], cameras["caltrans-d7-1002"]["direction"]) == ("I-110", "North")
    assert (cameras["caltrans-d7-1030"]["route"], cameras["caltrans-d7-1030"]["direction"]) == ("I-110", "North")
    assert (cameras["caltrans-d7-1051"]["route"], cameras["caltrans-d7-1051"]["direction"]) == ("I-110", "North")
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


def test_official_stream_refresh_replaces_only_an_exactly_matched_source_and_marks_missing_video():
    camera = {"id": "caltrans-d7-cctv-320", "provider": "Caltrans", "provider_index": "320",
              "name": "I-105 : (320) I-605", "lat": 33.9137, "lng": -118.1046,
              "stream_url": "https://wzmedia.dot.ca.gov/D7/CCTV-320.stream/playlist.m3u8",
              "provider_in_service": True, "route": "I-105", "direction": "East"}
    cameras = {camera["id"]: camera}
    source = {"index": "320", "inService": "true",
              "location": {"locationName": camera["name"], "latitude": str(camera["lat"]),
                           "longitude": str(camera["lng"])},
              "imageData": {"streamingVideoURL": "https://wzmedia.dot.ca.gov/D7/CCTV-320-new.stream/playlist.m3u8"}}

    refreshed = refresh_caltrans_video_sources(cameras, {"data": [{"cctv": source}]}, "checked-now")

    assert refreshed == {"matched": 1, "changed": 1, "without_video": 0}
    assert camera["stream_url"].endswith("CCTV-320-new.stream/playlist.m3u8")
    assert camera["provider_stream_available"] is True
    assert camera["route"] == "I-105" and camera["direction"] == "East"

    source["imageData"]["streamingVideoURL"] = None
    refreshed = refresh_caltrans_video_sources(cameras, {"data": [{"cctv": source}]}, "checked-again")

    assert refreshed == {"matched": 1, "changed": 1, "without_video": 1}
    assert camera["provider_stream_available"] is False
    assert camera["provider_stream_checked_at"] == "checked-again"
    assert camera["stream_url"].endswith("CCTV-320-new.stream/playlist.m3u8")


def test_official_stream_refresh_rejects_name_location_and_external_url_mismatches():
    camera = {"id": "caltrans-d7-1002", "provider": "Caltrans", "provider_index": "186",
              "name": "I-110 : (186) Wilshire Blvd", "lat": 34.0517, "lng": -118.2599,
              "stream_url": "https://wzmedia.dot.ca.gov/original/playlist.m3u8"}
    source = {"index": "186", "inService": "true", "location": {
        "locationName": camera["name"], "latitude": str(camera["lat"] + .01), "longitude": str(camera["lng"])},
        "imageData": {"streamingVideoURL": "https://attacker.example/playlist.m3u8"}}

    result = refresh_caltrans_video_sources({camera["id"]: camera}, {"data": [{"cctv": source}]}, "checked")

    assert result == {"matched": 0, "changed": 0, "without_video": 0}
    assert camera["stream_url"].endswith("original/playlist.m3u8")
    assert "provider_stream_available" not in camera


def test_official_stream_refresh_matches_legacy_ids_using_exact_name_and_location():
    camera = {"id": "caltrans-d7-1002", "provider": "Caltrans",
              "name": "I-110 : (186) Wilshire Blvd", "lat": 34.0517, "lng": -118.2599,
              "stream_url": "https://wzmedia.dot.ca.gov/D7/CCTV-186.stream/playlist.m3u8"}
    source = {"index": "1002", "inService": "true",
              "location": {"locationName": camera["name"], "latitude": str(camera["lat"]),
                           "longitude": str(camera["lng"])},
              "imageData": {"streamingVideoURL": camera["stream_url"]}}

    result = refresh_caltrans_video_sources({camera["id"]: camera}, {"data": [{"cctv": source}]}, "checked")

    assert result["matched"] == 1
    assert camera["provider_stream_available"] is True

    source["location"]["locationName"] = "I-110 : (185) 7th St"
    source["location"]["latitude"] = "34.0504"
    source["location"]["longitude"] = "-118.2619"
    assert refresh_caltrans_video_sources({camera["id"]: camera}, {"data": [{"cctv": source}]}, "later")["matched"] == 0


def test_official_stream_refresh_does_not_treat_milepost_parentheses_as_camera_index():
    camera = {"id": "caltrans-d7-1002", "provider": "Caltrans",
              "name": "I-110 : (186) Wilshire Blvd", "lat": 34.0517, "lng": -118.2599,
              "stream_url": "https://wzmedia.dot.ca.gov/D7/CCTV-186.stream/playlist.m3u8"}
    wrong_index = {"index": "186", "inService": "true",
                   "location": {"locationName": camera["name"], "latitude": str(camera["lat"]),
                                "longitude": str(camera["lng"])},
                   "imageData": {"streamingVideoURL": "https://wzmedia.dot.ca.gov/D7/wrong/playlist.m3u8"}}

    result = refresh_caltrans_video_sources({camera["id"]: camera}, {"data": [{"cctv": wrong_index}]}, "checked")

    assert result["matched"] == 0
    assert "provider_stream_available" not in camera


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


def test_does_not_overwrite_existing_route_without_verified_feed_override():
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


def test_verified_district_feed_override_corrects_stale_route_for_exact_camera():
    camera = {"id": "caltrans-d7-1051",
              "name": "I-110 : (828) James M Wood Blvd Off-Ramp",
              "provider": "Caltrans", "lat": 34.047339, "lng": -118.26519,
              "route": "I-5", "direction": "North"}
    metadata = {"cameras": {camera["id"]: {
        "official_index": 1051, "location_name": camera["name"],
        "route": "I-110", "direction": "North",
        "latitude": camera["lat"], "longitude": camera["lng"],
        "verified_override": True,
        "source_url": "https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json",
    }}}

    assert enrich_caltrans_route_metadata({camera["id"]: camera}, metadata) == 1
    assert camera["route"] == "I-110"
    assert camera["direction"] == "North"


def test_verified_override_from_another_source_cannot_replace_route():
    camera = {"id": "caltrans-d7-1051",
              "name": "I-110 : (828) James M Wood Blvd Off-Ramp",
              "provider": "Caltrans", "lat": 34.047339, "lng": -118.26519,
              "route": "I-5", "direction": "North"}
    metadata = {"cameras": {camera["id"]: {
        "official_index": 1051, "location_name": camera["name"],
        "route": "I-110", "direction": "North",
        "latitude": camera["lat"], "longitude": camera["lng"],
        "verified_override": True, "source_url": "https://example.com/cameras.json",
    }}}

    assert enrich_caltrans_route_metadata({camera["id"]: camera}, metadata) == 0
    assert camera["route"] == "I-5"


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
