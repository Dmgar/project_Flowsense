"""Build a balanced regional catalog from official, unauthenticated Caltrans CCTV."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import urllib.request
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json"
GROUPS = {
    "Los Angeles": ({"Los Angeles", "Downtown LA", "Chinatown", "Cypress Park", "Elysian Park"}, 16),
    "Santa Monica": ({"Santa Monica", "Santa Monica Airport", "Santa Monica City Hall"}, 8),
    "Burbank": ({"Burbank"}, 10),
    "El Monte": ({"El Monte", "South El Monte"}, 6),
    "West Covina": ({"West Covina"}, 5),
    "Norwalk": ({"Norwalk", "Norwalk Park"}, 9),
    "Long Beach": ({"Long Beach"}, 10),
}
LEGACY_IDS = ["caltrans-d7-1053", "caltrans-d7-1002", "caltrans-d7-1030", "caltrans-d7-1051",
              "caltrans-d7-1052", "caltrans-d7-1054", "caltrans-d7-1055", "caltrans-d7-1235"]


def verify(item):
    result = dict(item)
    try:
        with urllib.request.urlopen(item["image_url"], timeout=18) as response:
            raw = response.read(10_000_001)
            result["image_status"] = response.status
            result["image_type"] = response.headers.get_content_type()
        frame = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None or len(raw) > 10_000_000:
            raise ValueError("Undecodable image")
        result["frame_sha256"] = hashlib.sha256(raw).hexdigest()
        result["resolution"] = [int(frame.shape[1]), int(frame.shape[0])]
        # Provider outage cards are mostly white. Exclude these conservatively;
        # a 200 response alone does not demonstrate a usable traffic image.
        result["possible_placeholder"] = float(np.mean(np.all(frame > 235, axis=2))) > .70
        result["verified_at"] = datetime.now(timezone.utc).isoformat()
        result["verification"] = "placeholder" if result["possible_placeholder"] else "decodable_image"
        if item["stream_url"]:
            try:
                with urllib.request.urlopen(item["stream_url"], timeout=8) as stream:
                    result["hls_status"] = stream.status if b"#EXTM3U" in stream.read(4096) else "invalid"
            except Exception:
                result["hls_status"] = "unavailable"
                result["stream_url"] = ""
    except Exception as error:
        result["verification"] = "unavailable"
        result["verification_error"] = type(error).__name__
    return result


def main():
    with urllib.request.urlopen(SOURCE, timeout=30) as response:
        records = json.load(response)["data"]
    catalog_path = ROOT / "data/public_cameras_los_angeles.json"
    previous = json.loads(catalog_path.read_text(encoding="utf-8"))
    previous = [next(c for c in previous if c["id"] == key) for key in LEGACY_IDS]
    existing_ids = {c["id"] for c in previous}
    existing_urls = {c["image_url"]: c["id"] for c in previous}
    candidates = []
    for record in records:
        camera = record["cctv"]
        location = camera["location"]
        place = location["nearbyPlace"]
        region = next((name for name, (places, _) in GROUPS.items() if place in places), None)
        if not region:
            continue
        lat, lng = float(location["latitude"]), float(location["longitude"])
        if not (-118.56 <= lng <= -117.84 and 33.70 <= lat <= 34.25):
            continue
        image = camera["imageData"]
        candidates.append({"id": existing_urls.get(image["static"]["currentImageURL"], f"caltrans-d7-cctv-{camera['index']}"), "provider_index": camera["index"], "provider_in_service": camera["inService"] == "true", "name": location["locationName"],
            "district": region, "nearby_place": place, "lat": lat, "lng": lng,
            "image_url": image["static"]["currentImageURL"], "stream_url": image["streamingVideoURL"],
            "source_url": "https://quickmap.dot.ca.gov/", "catalog_url": SOURCE, "provider": "Caltrans",
            "route": location["route"], "direction": location["direction"],
            "refresh_seconds": max(60, float(image["static"]["currentImageUpdateFrequency"] or 2) * 60),
            "provider_record_timestamp": camera["recordTimestamp"]})
    with ThreadPoolExecutor(max_workers=6) as executor:
        verified = list(executor.map(verify, candidates))
    selected, used_hashes = [], set()
    for region, (_, quota) in GROUPS.items():
        options = sorted((c for c in verified if c["district"] == region),
                         key=lambda c: (c["id"] not in existing_ids, c["verification"] != "decodable_image", c.get("hls_status") != 200, c["lng"], c["lat"]))
        count = 0
        for camera in options:
            if camera["id"] in existing_ids or (count < quota and (camera["verification"] != "decodable_image" or camera.get("frame_sha256") not in used_hashes)):
                selected.append(camera)
                if camera.get("frame_sha256"):
                    used_hashes.add(camera["frame_sha256"])
                count += 1
    # Stable camera IDs preserve existing cases and direct evidence URLs.
    for old in previous:
        if not any(c["id"] == old["id"] for c in selected):
            selected.append({**old, "district": "Los Angeles", "verification": "legacy_source"})
    selected = [next(c for c in selected if c["id"] == key) for key in LEGACY_IDS] + [c for c in selected if c["id"] not in existing_ids]
    usable = [c for c in selected if c.get("verification") == "decodable_image"]
    if len(usable) < 40 or any(not any(c["district"] == region for c in usable) for region in GROUPS):
        raise RuntimeError("Regional verification gate failed; existing catalog remains intact.")
    catalog_path.write_text(json.dumps(selected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    audit_path = ROOT / "data/public_cameras_verification.json"
    audit_path.write_text(json.dumps({"source": SOURCE, "checked_at": datetime.now(timezone.utc).isoformat(),
        "candidate_count": len(candidates), "selected_count": len(selected), "usable_count": len(usable),
        "by_region": {region: sum(c["district"] == region for c in selected) for region in GROUPS},
        "checks": verified}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"selected": len(selected), "usable": len(usable),
                      "regions": {r: sum(c["district"] == r for c in selected) for r in GROUPS}}))


if __name__ == "__main__":
    main()
