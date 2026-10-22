"""Conservative metadata enrichment for public camera catalogs."""
from __future__ import annotations

import math
import re
from urllib.parse import urlparse


_ROUTE_PATTERN = re.compile(r"^(?:I|US|SR|CA)-?\d+[A-Z]?$", re.IGNORECASE)
_DIRECTIONS = {"north", "south", "east", "west"}
_D7_CCTV_SOURCE = "https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json"
CAMERA_METADATA_POLICY_VERSION = 2
CAMERA_SOURCE_CATALOG_POLICY_VERSION = 3


def refresh_caltrans_video_sources(cameras: dict[str, dict], payload: dict,
                                   checked_at: str, max_distance_m: float = 100.0) -> dict:
    """Refresh only official video URLs whose index, name and location match."""
    records = payload.get("data", []) if isinstance(payload, dict) else []
    if not isinstance(records, list):
        return {"matched": 0, "changed": 0, "without_video": 0}
    by_index = {}
    for record in records:
        cctv = record.get("cctv") if isinstance(record, dict) else None
        if isinstance(cctv, dict) and cctv.get("index") is not None:
            by_index[str(cctv["index"]).strip()] = cctv

    matched = changed = without_video = 0
    for camera in cameras.values():
        if not isinstance(camera, dict) or camera.get("provider") != "Caltrans":
            continue
        candidate_indices = []
        # Legacy display IDs retain Caltrans' CCTV index as their numeric suffix.
        # Parenthetical numbers in camera names are road postmiles, not CCTV IDs.
        for candidate in (camera.get("provider_index"),
                          re.search(r"(\d+)$", str(camera.get("id") or ""))):
            index = candidate.group(1) if hasattr(candidate, "group") else str(candidate or "").strip()
            if index and index not in candidate_indices:
                candidate_indices.append(index)
        source = None
        for index in candidate_indices:
            candidate = by_index.get(index)
            location = candidate.get("location") if candidate else None
            image_data = candidate.get("imageData") if candidate else None
            if not isinstance(location, dict) or not isinstance(image_data, dict):
                continue
            if str(location.get("locationName") or "").strip() != str(camera.get("name") or "").strip():
                continue
            try:
                lat, lon = float(camera["lat"]), float(camera["lng"])
                source_lat, source_lon = float(location["latitude"]), float(location["longitude"])
            except (KeyError, TypeError, ValueError):
                continue
            if not all(math.isfinite(value) for value in (lat, lon, source_lat, source_lon)):
                continue
            dx = (lon - source_lon) * 111_320 * math.cos(math.radians(lat))
            dy = (lat - source_lat) * 111_320
            if math.hypot(dx, dy) <= max_distance_m:
                source = candidate
                break
        if not source:
            continue
        image_data = source["imageData"]

        official_url = image_data.get("streamingVideoURL")
        if official_url:
            official_url = str(official_url).strip()
            parsed = urlparse(official_url)
            host = (parsed.hostname or "").casefold()
            if (parsed.scheme != "https" or not host.endswith(".dot.ca.gov")
                    or not parsed.path.casefold().endswith(".m3u8")):
                continue
        else:
            official_url = ""

        matched += 1
        new_in_service = str(source.get("inService", "")).strip().casefold() == "true"
        old_state = (camera.get("stream_url", ""), camera.get("provider_in_service"),
                     camera.get("provider_stream_available"))
        camera["provider_in_service"] = new_in_service
        camera["provider_stream_available"] = bool(official_url)
        camera["provider_stream_checked_at"] = checked_at
        if official_url:
            camera["stream_url"] = official_url
        else:
            without_video += 1
        if old_state != (camera.get("stream_url", ""), new_in_service, bool(official_url)):
            changed += 1
    return {"matched": matched, "changed": changed, "without_video": without_video}


def enrich_caltrans_route_metadata(cameras: dict[str, dict], metadata: dict,
                                   max_distance_m: float = 100.0) -> int:
    """Apply route metadata only for an exact official identity match.

    The official index, public catalog name, and location must all match, which
    prevents a reused or stale index from relinking a camera to a different road.
    Existing metadata is corrected only with an explicit override from the
    district's published CCTV feed.
    """
    enriched = 0
    entries = metadata.get("cameras", {})
    if not isinstance(entries, dict):
        return enriched

    for camera_id, record in entries.items():
        camera = cameras.get(camera_id)
        if not isinstance(camera, dict) or camera.get("provider") != "Caltrans":
            continue
        if not isinstance(record, dict) or camera.get("name") != record.get("location_name"):
            continue
        index_match = re.search(r"(\d+)$", camera_id)
        try:
            if not index_match or int(index_match.group(1)) != int(record["official_index"]):
                continue
        except (KeyError, TypeError, ValueError):
            continue
        try:
            lat, lon = float(camera["lat"]), float(camera["lng"])
            source_lat, source_lon = float(record["latitude"]), float(record["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        if not all(math.isfinite(value) for value in (lat, lon, source_lat, source_lon)):
            continue
        dx = (lon - source_lon) * 111_320 * math.cos(math.radians(lat))
        dy = (lat - source_lat) * 111_320
        if math.hypot(dx, dy) > max_distance_m:
            continue

        route = str(record.get("route") or "").strip().upper()
        direction = str(record.get("direction") or "").strip().casefold()
        if not _ROUTE_PATTERN.fullmatch(route) or direction not in _DIRECTIONS:
            continue
        current_route = str(camera.get("route") or "").strip().upper()
        current_direction = str(camera.get("direction") or "").strip().casefold()
        if current_route == route and current_direction == direction:
            continue
        if (current_route or current_direction) and not (
                record.get("verified_override") is True
                and record.get("source_url") == _D7_CCTV_SOURCE):
            continue

        camera["route"], camera["direction"] = route, direction.title()
        enriched += 1
    return enriched
