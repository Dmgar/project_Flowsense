"""Conservative metadata enrichment for public camera catalogs."""
from __future__ import annotations

import math
import re


_ROUTE_PATTERN = re.compile(r"^(?:I|US|SR|CA)-?\d+[A-Z]?$", re.IGNORECASE)
_DIRECTIONS = {"north", "south", "east", "west"}


def enrich_caltrans_route_metadata(cameras: dict[str, dict], metadata: dict,
                                   max_distance_m: float = 100.0) -> int:
    """Fill missing route/direction only for an exact official identity match.

    The official index, public catalog name, and location must all match, which
    prevents a reused or stale index from relinking a camera to a different road.
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
        if camera.get("route") or camera.get("direction"):
            continue

        camera["route"], camera["direction"] = route, direction.title()
        enriched += 1
    return enriched
