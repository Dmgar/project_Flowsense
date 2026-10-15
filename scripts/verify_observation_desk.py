"""Read-only check of independent camera observations used by the desk."""
from concurrent.futures import ThreadPoolExecutor
import json
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8002/api/v1/mobility"


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=35) as response:
        return response.read()


def check(camera):
    try:
        observation = json.loads(get(f"/cameras/{camera['id']}/observation"))
        assert observation["camera_id"] == camera["id"]
        image = get(f"/cameras/{camera['id']}/snapshot?frame_id={observation['frame_id']}")
        assert image.startswith(b"\xff\xd8")
        if observation["source_status"] == "provider_notice":
            assert observation["counts"] is None
        elif observation["inference_status"] == "ready":
            assert observation["counts"] is not None
        return {"camera": camera["id"], "city": camera["district"], "source_status": observation["source_status"],
                "inference": observation["inference_status"], "frame_id": observation["frame_id"],
                "observed_at": observation["observed_at"], "image_bytes": len(image), "contract": "PASS"}
    except urllib.error.HTTPError as error:
        if error.code != 503:
            raise
        return {"camera": camera["id"], "city": camera["district"], "source_status": "unavailable", "http_status": error.code}


if __name__ == "__main__":
    cameras = json.loads(get("/cameras"))
    selected = [next(camera for camera in reversed(cameras) if camera["district"] == city and camera.get("verification") == "decodable_image")
                for city in ["Los Angeles", "Burbank", "West Covina", "Long Beach"]]
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(check, selected))
    assert sum(item.get("contract") == "PASS" for item in results) >= 2, "Insufficient available sources for the live desk check"
    print(json.dumps({"catalog": len(cameras), "parallel_requests": 2, "results": results}, indent=2))
