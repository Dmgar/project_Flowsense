"""Approximate directional camera-to-OSM association; never changes route weights."""
import json
import hashlib
import math
import re
import threading
import weakref
from contextlib import closing


ROAD_NAME_ALIASES = {
    "1": ("pacific coast highway", "pch"),
    "5": ("golden state freeway", "santa ana freeway"),
    "10": ("santa monica freeway", "san bernardino freeway"),
    "47": ("terminal island freeway",),
    "60": ("pomona freeway",),
    "101": ("ventura freeway", "hollywood freeway"),
    "105": ("century freeway",),
    "110": ("harbor freeway", "pasadena freeway", "arroyo seco parkway"),
    "405": ("san diego freeway",),
    "605": ("san gabriel river freeway",),
    "710": ("long beach freeway",),
}
_ROAD_CATALOG_LOCK = threading.Lock()
_GRAPH_SIGNATURE_LOCK = threading.Lock()
_GRAPH_SIGNATURE_CACHE = weakref.WeakKeyDictionary()
_ROAD_MATCH_VERSION = 7


def _graph_signature(graph):
    with _GRAPH_SIGNATURE_LOCK:
        cached = _GRAPH_SIGNATURE_CACHE.get(graph)
        if cached is not None:
            return cached
    profile = graph.graph.get("flowsense_location_profile", "active")
    signature = f"{_ROAD_MATCH_VERSION}:{profile}:{graph.number_of_nodes()}:{graph.number_of_edges()}"
    with _GRAPH_SIGNATURE_LOCK:
        _GRAPH_SIGNATURE_CACHE[graph] = signature
    return signature


def _camera_signature(camera):
    payload = [camera.get("id"), camera.get("lat"), camera.get("lng"),
               camera.get("route"), camera.get("direction")]
    encoded = json.dumps(payload, ensure_ascii=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(encoded).hexdigest()[:20]


def _public_road_link(item):
    return {**{key: value for key, value in item.items()
               if key not in {"graph_signature", "camera_signature"}},
            "road_matching_version": _ROAD_MATCH_VERSION}


def route_matches_camera(route, text):
    """Match exact OSM route references or known LA freeway names."""
    digits = "".join(character for character in str(route) if character.isdigit())
    if not digits:
        return False
    # Route numbers must be standalone tokens: I-5 must not match an ordinary
    # street name such as "West 5th Street" or a different route such as I-405.
    if re.search(rf"(?<![A-Za-z0-9]){re.escape(digits)}(?![A-Za-z0-9])", str(text)):
        return True
    folded = str(text).casefold()
    return any(alias in folded for alias in ROAD_NAME_ALIASES.get(digits, ()))


def road_context(camera, graph, store):
    graph_signature = _graph_signature(graph)
    camera_signature = _camera_signature(camera)
    with closing(store.connect()) as db, db:
        db.execute("CREATE TABLE IF NOT EXISTS camera_road_links (camera TEXT PRIMARY KEY,payload TEXT NOT NULL)")
        saved = db.execute("SELECT payload FROM camera_road_links WHERE camera=?", (camera["id"],)).fetchone()
    if saved:
        item = json.loads(saved[0])
        if (item.get("graph_signature") == graph_signature
                and item.get("camera_signature") == camera_signature):
            if not item.get("matched") or graph.has_edge(item["u"], item["v"], item["key"]):
                return _public_road_link(item)
    if not camera.get("route") or not camera.get("direction"):
        item = {"name": camera.get("route") or "Road", "route": camera.get("route"),
                "direction": camera.get("direction"),
                "association": "Route and travel direction are required before camera traffic can be assigned to a road",
                "matched": False, "graph_signature": graph_signature,
                "camera_signature": camera_signature}
        with closing(store.connect()) as db, db:
            db.execute("INSERT OR REPLACE INTO camera_road_links VALUES (?,?)", (camera["id"], json.dumps(item)))
        return _public_road_link(item)
    from shapely.geometry import LineString, Point
    from shapely import wkt
    lat, lon = camera["lat"], camera["lng"]
    sx, sy = 111320 * math.cos(math.radians(lat)), 111320
    route = ''.join(c for c in camera.get("route", "") if c.isdigit())
    heading = camera.get("direction", "").lower()
    candidates = []
    for u, v, key, data in graph.edges(keys=True, data=True):
        if not any(t in str(data.get("highway", "")) for t in ("motorway", "trunk", "primary")):
            continue
        a, b = graph.nodes[u], graph.nodes[v]
        text = str(data.get("ref", "")) + " " + str(data.get("name", ""))
        matches = route_matches_camera(camera.get("route", ""), text)
        if not matches:
            continue
        geometry = data.get("geometry")
        try:
            if isinstance(geometry, str):
                geometry = wkt.loads(geometry)
            # Endpoint proximity is only a safe shortcut for straight edges.
            # A long curved OSM geometry can pass beside the camera while both
            # graph nodes remain far away, so keep its full shape for matching.
            if geometry is None and min(
                    math.hypot((float(node["x"]) - lon) * sx,
                               (float(node["y"]) - lat) * sy) for node in (a, b)) > 700:
                continue
            coordinates = list(geometry.coords) if geometry is not None else [(float(a["x"]), float(a["y"])), (float(b["x"]), float(b["y"]))]
            line = LineString([((x - lon) * sx, (y - lat) * sy) for x, y in coordinates])
            distance = line.distance(Point(0, 0))
            # A curved freeway can point in a different compass direction near
            # the camera than its endpoint-to-endpoint chord. Use the local
            # directed tangent where the camera is closest to the road.
            along = line.project(Point(0, 0))
            tangent_span = min(5.0, line.length / 2)
            before = line.interpolate(max(0.0, along - tangent_span))
            after = line.interpolate(min(line.length, along + tangent_span))
            dx, dy = after.x - before.x, after.y - before.y
        except Exception:
            continue
        compatible = {"south": dy < 0, "north": dy > 0,
                      "east": dx > 0, "west": dx < 0}.get(heading, False)
        if not compatible:
            continue
        if distance <= 200:
            candidates.append((distance, {"u": int(u), "v": int(v), "key": int(key),
                "name": str(data.get("name", camera.get("route", "Road"))), "route": camera.get("route"),
                "direction": camera.get("direction"), "distance_m": round(distance),
                "association": "Approximate catalog route/direction and OSM geometry match",
                "coordinates": [[float(x), float(y)] for x, y in coordinates]}))
    if not candidates:
        item = {"name": camera.get("route", "Road"), "route": camera.get("route"),
                "direction": camera.get("direction"), "association": "No matching directional OSM segment within 200 m",
                "matched": False, "graph_signature": graph_signature,
                "camera_signature": camera_signature}
        with closing(store.connect()) as db, db:
            db.execute("INSERT OR REPLACE INTO camera_road_links VALUES (?,?)", (camera["id"], json.dumps(item)))
        return _public_road_link(item)
    item = min(candidates, key=lambda pair: pair[0])[1]
    item["matched"], item["graph_signature"], item["camera_signature"] = True, graph_signature, camera_signature
    with closing(store.connect()) as db, db:
        db.execute("INSERT OR REPLACE INTO camera_road_links VALUES (?,?)", (camera["id"], json.dumps(item)))
    return _public_road_link(item)


def _aggregate_road_observations(rows):
    """Combine cameras on the same directed OSM edge without hiding disagreement."""
    from collections import Counter

    grouped = {}
    for row in rows:
        key = (row["u"], row["v"], row["key"])
        grouped.setdefault(key, []).append(row)

    labels = {"moving": "Traffic moving", "building": "Traffic slowing", "slow": "Possible queue"}
    result = []
    for sources in grouped.values():
        sources.sort(key=lambda row: row["camera_id"])
        available = [row for row in sources if row["estimate"].get("label") != "No active feed"
                     and row["estimate"].get("source_health") != "unavailable"]
        live = [row for row in sources if row["estimate"].get(
            "feed_active", row["estimate"].get("label") != "No active feed")]
        measured = [row for row in available if row["estimate"].get("level") in labels
                    and row["estimate"].get("updated_at")]
        levels = Counter(row["estimate"]["level"] for row in measured)
        level = "unknown"
        if measured:
            majority_level, majority_count = levels.most_common(1)[0]
            if majority_count > len(measured) / 2:
                level = majority_level
                contributors = [row for row in measured if row["estimate"]["level"] == level]
                label = contributors[0]["estimate"]["label"] if len(levels) == 1 else labels[level]
            else:
                contributors = measured
                label = "Conflicting camera estimates"
        elif all(row["estimate"].get("source_health") == "unavailable" for row in sources):
            contributors = []
            label = "Camera source unavailable"
        elif not available:
            contributors = []
            label = "No active feed"
        else:
            contributors = available
            source_labels = [row["estimate"].get("label") for row in available]
            # A missing zone on one linked camera must not hide that another,
            # calibrated source has gone stale. Keep the stale primary state
            # visible; the per-source estimates and zone_required_camera_count
            # still show the remaining calibration work.
            if ("Direction zone required" in source_labels
                    and not any(row["estimate"].get("zone_enabled") for row in available)):
                label = "Direction zone required"
            elif any(row["estimate"].get("evidence_quality") == "sparse" or
                     row["estimate"].get("label") == "Sparse vehicle footprint" for row in available):
                label = next((row["estimate"].get("label") for row in available
                              if str(row["estimate"].get("label", "")).startswith("Vehicle movement")),
                             "Sparse vehicle footprint")
            elif any(row["estimate"].get("evidence_quality") == "motion_unavailable" for row in available):
                label = "Vehicle movement · motion unavailable"
            elif "No recent estimate" in source_labels:
                label = "No recent estimate"
            else:
                label = source_labels[0] if source_labels else "No active feed"

        updated = [row["estimate"].get("updated_at") for row in contributors
                   if row["estimate"].get("updated_at")]
        coverages = [row["estimate"].get("image_coverage_percent") for row in available
                     if row["estimate"].get("image_coverage_percent") is not None]
        slow_values = [row["estimate"].get("slow_fraction") for row in measured
                       if row["estimate"].get("slow_fraction") is not None]
        estimate = {
            "level": level,
            "label": label,
            "sample_count": sum(row["estimate"].get("sample_count", 0) or 0 for row in available),
            "calibrated_camera_count": sum(bool(row["estimate"].get("zone_enabled")) for row in sources),
            "zone_required_camera_count": sum(not bool(row["estimate"].get("zone_enabled")) for row in sources),
            "track_crossings_last_minute": sum(row["estimate"].get("track_crossings_last_minute", 0) or 0 for row in available),
            "updated_at": max(updated) if updated else None,
            "image_coverage_percent": round(sum(coverages) / len(coverages), 1) if coverages else None,
            "slow_fraction": round(sum(slow_values) / len(slow_values), 3) if slow_values else None,
            "visibility": "low_light" if any(row["estimate"].get("visibility") == "low_light" for row in available) else "standard",
            "evidence_quality": "sparse" if any(row["estimate"].get("evidence_quality") == "sparse"
                                                   for row in contributors) else "motion_unavailable" if label == "Vehicle movement · motion unavailable" else "multi_camera" if len(measured) > 1 else "single_camera" if measured else "unavailable",
            "movement_sample_count": sum(row["estimate"].get("movement_sample_count", 0) or 0 for row in available),
            "source_health": "unavailable" if all(
                row["estimate"].get("source_health") == "unavailable" for row in sources) else None,
            "source_http_status": next((row["estimate"].get("source_http_status") for row in sources
                                         if row["estimate"].get("source_health") == "unavailable"), None),
            "basis": (f"{len(measured)} linked camera views provide fresh usable estimates; {len(live)} feeds are active on this directed road segment."
                      if measured else "; ".join(dict.fromkeys(row["estimate"].get("basis", "") for row in available if row["estimate"].get("basis")))
                      if available else "No linked camera source has recent saved evidence."),
        }
        source_estimates = [{"camera_id": row["camera_id"], "level": row["estimate"].get("level"),
                             "distance_m": row.get("distance_m"),
                             "association": row.get("association"),
                             "label": row["estimate"].get("label"), "sample_count": row["estimate"].get("sample_count", 0),
                             "feed_active": row["estimate"].get("feed_active", row["estimate"].get("label") != "No active feed"),
                             "source_health": row["estimate"].get("source_health"),
                             "source_http_status": row["estimate"].get("source_http_status"),
                             "zone_enabled": row["estimate"].get("zone_enabled"),
                             "image_coverage_percent": row["estimate"].get("image_coverage_percent"),
                             "track_crossings_last_minute": row["estimate"].get("track_crossings_last_minute", 0),
                             "evidence_quality": row["estimate"].get("evidence_quality"),
                             "movement_sample_count": row["estimate"].get("movement_sample_count"),
                             "visibility": row["estimate"].get("visibility"),
                             "updated_at": row["estimate"].get("updated_at")} for row in sources]
        primary = next((row for row in measured), next(iter(available), sources[0]))
        result.append({**primary, "camera_id": primary["camera_id"],
                       "camera_ids": [row["camera_id"] for row in sources],
                       "active_camera_ids": [row["camera_id"] for row in live],
                       "camera_count": len(sources), "active_camera_count": len(live),
                       "measured_camera_count": len(measured), "source_estimates": source_estimates,
                       "estimate": estimate})
    return result


def road_observations(store, cameras=None, graph=None, active_camera_ids=(), graph_for_camera=None,
                      source_health=None):
    from datetime import datetime, timezone, timedelta
    active = set(active_camera_ids)
    if (graph is not None or graph_for_camera is not None) and cameras:
        video_cameras = [camera for camera in cameras.values() if camera.get("stream_url")]
        with _ROAD_CATALOG_LOCK:
            with closing(store.connect()) as db, db:
                db.execute("CREATE TABLE IF NOT EXISTS camera_road_links (camera TEXT PRIMARY KEY,payload TEXT NOT NULL)")
                cached = {camera: json.loads(payload) for camera, payload in
                          db.execute("SELECT camera,payload FROM camera_road_links")}
            for camera in video_cameras:
                camera_graph = graph_for_camera(camera) if graph_for_camera else graph
                if camera_graph is None:
                    continue
                graph_signature = _graph_signature(camera_graph)
                saved = cached.get(camera["id"], {})
                if (camera["id"] in active
                        or saved.get("graph_signature") != graph_signature
                        or saved.get("camera_signature") != _camera_signature(camera)):
                    road_context(camera, camera_graph, store)
    with closing(store.connect()) as db, db:
        db.execute("CREATE TABLE IF NOT EXISTS camera_road_links (camera TEXT PRIMARY KEY,payload TEXT NOT NULL)")
        links = list(db.execute("SELECT camera,payload FROM camera_road_links"))
    linked_camera_ids = [camera for camera, payload in links
                         if (not cameras or camera in cameras) and json.loads(payload).get("matched")]
    zones = store.zones(linked_camera_ids) if hasattr(store, "zones") else {}
    result = []
    for camera, payload in links:
        item = json.loads(payload)
        if (cameras and camera not in cameras) or not item.get("matched"):
            continue
        zone = zones.get(camera) if zones else None
        if zone is None:
            zone = store.zone(camera)
        zone_enabled = bool(zone.get("enabled"))
        if camera in active:
            if zone_enabled:
                summary = store.summary(camera, (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat())
                estimate = {**summary["traffic_estimate"], "feed_active": True}
            else:
                estimate = {"level": "unknown", "label": "Direction zone required", "sample_count": 0,
                    "updated_at": None, "image_coverage_percent": None, "slow_fraction": None,
                    "track_crossings_last_minute": 0,
                    "feed_active": True,
                    "basis": "Live detections are not attributed to this road until a camera-specific road polygon and travel direction are enabled."}
        else:
            if zone_enabled:
                summary = store.summary(camera, (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat())
                estimate = {**summary["traffic_estimate"], "feed_active": False}
            else:
                estimate = {"level": "unknown", "label": "Direction zone required", "sample_count": 0,
                    "updated_at": None, "image_coverage_percent": None, "slow_fraction": None,
                    "track_crossings_last_minute": 0, "feed_active": False,
                    "basis": "This camera is linked to the road, but its inbound lane and direction have not been calibrated. No traffic estimate is available."}
            if estimate.get("sample_count", 0) or estimate.get("track_crossings_last_minute", 0):
                estimate["basis"] = ("Recent saved camera evidence is shown, but the video feed is inactive. "
                    "Congestion is only estimated while observations remain fresh; track crossings are not calibrated vehicle counts.")
            elif zone_enabled:
                estimate.update(level="unknown", label="No active feed", sample_count=0,
                    updated_at=None, image_coverage_percent=None, slow_fraction=None,
                    track_crossings_last_minute=0,
                    basis="No active camera video or recent saved observations are available for this road.")
        health = (source_health or {}).get(camera)
        if health and health.get("state") == "unavailable":
            estimate["feed_active"] = False
            estimate["source_health"] = "unavailable"
            estimate["source_http_status"] = health.get("http_status")
            estimate["source_checked_at"] = health.get("checked_at")
            if estimate.get("sample_count", 0) or estimate.get("track_crossings_last_minute", 0):
                estimate["basis"] = ("The source is currently unavailable; saved observations remain visible, "
                                      "but they do not establish current road conditions.")
            else:
                estimate.update(level="unknown", label="Camera source unavailable", sample_count=0,
                    updated_at=None, image_coverage_percent=None, slow_fraction=None,
                    track_crossings_last_minute=0,
                    basis="The camera source returned an unavailable response. No current road estimate is shown.")
        estimate["zone_enabled"] = zone_enabled
        association = _public_road_link(item)
        result.append({**association, "camera_id": camera, "estimate": estimate})
    return _aggregate_road_observations(result)
