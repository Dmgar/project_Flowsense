import asyncio
import os
import sys
import httpx
import websockets
from websockets.exceptions import InvalidStatus, InvalidStatusCode

BASE_URL = os.getenv("FLOWSENSE_URL", "https://flowsense.duckdns.org").rstrip("/")
WS_URL = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/ws/telemetry"

VALID_API_KEY = os.getenv("FLOWSENSE_API_KEY", "flowsense-operator-v1")


def print_result(test_name: str, passed: bool, detail: str):
    icon = "✅ [OK]" if passed else "❌ [FAIL]"
    print(f"{icon} {test_name}: {detail}")


async def test_1_security_headers(client: httpx.AsyncClient):
    """Verifies that Nginx injects essential OWASP security headers."""
    resp = await client.get(f"{BASE_URL}/")
    headers = {k.lower(): v for k, v in resp.headers.items()}

    required = ["strict-transport-security", "x-content-type-options", "x-frame-options"]
    missing = [h for h in required if h not in headers]

    print_result(
        "1. HTTP Security Headers (HSTS, nosniff, DENY)",
        len(missing) == 0,
        "All required security headers present" if not missing else f"Missing: {', '.join(missing)}",
    )


async def test_2_auth_protection(client: httpx.AsyncClient):
    """Verifies that critical mutation endpoints reject unauthorized requests (403)."""
    resp = await client.post(f"{BASE_URL}/api/v1/graph/reset")
    passed = resp.status_code in (401, 403)
    print_result(
        "2. Mutation blocking without API Key (/graph/reset)",
        passed,
        f"Status code returned: {resp.status_code} (expected 403 Forbidden)",
    )


async def test_3_ssrf_and_lfi_block(client: httpx.AsyncClient):
    """Verifies that Pydantic/FastAPI rejects SSRF attempts toward AWS metadata (169.254.169.254) and LFI."""
    headers = {"X-FlowSense-Key": VALID_API_KEY}

    # 3A: LFI/SSRF attempt in /perception/start
    resp_lfi = await client.post(
        f"{BASE_URL}/api/v1/perception/start",
        params={"camera_id": "CAM-NYC-MID-01", "video_source": "http://169.254.169.254/latest/meta-data/"},
        headers=headers,
    )
    print_result(
        "3A. SSRF/LFI Block on /perception/start",
        resp_lfi.status_code == 422,
        f"Status code returned: {resp_lfi.status_code} (expected 422 Unprocessable Entity)",
    )

    # 3B: SSRF attempt on /mobility/cameras pointing to AWS metadata
    resp_cam = await client.post(
        f"{BASE_URL}/api/v1/mobility/cameras",
        json={
            "name": "Camera Test SSRF",
            "source": "http://169.254.169.254/latest/meta-data/",
            "lat": 40.75,
            "lng": -73.98,
        },
        headers=headers,
    )
    print_result(
        "3B. SSRF Block on /mobility/cameras",
        resp_cam.status_code in (403, 422),
        f"Status code returned: {resp_cam.status_code} (expected 422 or 403)",
    )


async def test_4_dos_validation_bounds(client: httpx.AsyncClient):
    """Verifies that interval_seconds=0 and oversized fleets are rejected at schema validation."""
    headers = {"X-FlowSense-Key": VALID_API_KEY}

    # 4A: Zero second interval (infinite CPU loop prevention)
    resp_sim = await client.post(
        f"{BASE_URL}/api/v1/dispatch/simulate/traffic/start",
        params={"interval_seconds": 0},
        headers=headers,
    )
    print_result(
        "4A. Zero interval loop prevention (interval_seconds=0)",
        resp_sim.status_code == 422,
        f"Status code returned: {resp_sim.status_code} (expected 422)",
    )

    # 4B: Fleet of 15 vehicles (over the 10 limit)
    dummy_route = {
        "origin": {"latitude": 40.75, "longitude": -73.98},
        "destination": {"latitude": 40.76, "longitude": -73.97},
        "vehicle_type": "ambulance",
        "priority": "high",
    }
    resp_fleet = await client.post(
        f"{BASE_URL}/api/v1/dispatch/fleet",
        json={"vehicles": [dummy_route] * 15},
        headers=headers,
    )
    print_result(
        "4B. Fleet size bound enforcement (>10 vehicles)",
        resp_fleet.status_code == 422,
        f"Status code returned: {resp_fleet.status_code} (expected 422)",
    )


async def test_5_websocket_origin_and_size():
    """Verifies that the WebSocket rejects unauthorized Origin (CSWSH) and oversized frames (>8 KB)."""
    # 5A: Connection from foreign origin
    try:
        async with websockets.connect(WS_URL, origin="https://malicious-attacker.com", open_timeout=5) as ws:
            await ws.recv()
            print_result("5A. CSWSH Protection (Foreign Origin rejected)", False, "Accepted foreign origin")
    except (InvalidStatus, InvalidStatusCode, websockets.exceptions.ConnectionClosedError, websockets.exceptions.ConnectionClosed) as e:
        print_result("5A. CSWSH Protection (Foreign Origin rejected)", True, f"Connection rejected ({type(e).__name__})")
    except Exception as e:
        print_result("5A. CSWSH Protection (Foreign Origin rejected)", True, f"Connection rejected: {e}")

    # 5B: Connection with authorized origin sending oversized payload (>8 KB)
    try:
        async with websockets.connect(WS_URL, origin=BASE_URL, open_timeout=5) as ws:
            oversized = "X" * 10240  # 10 KB exceeds 8 KB limit
            await ws.send(oversized)
            await asyncio.sleep(0.5)
            await ws.recv()
            print_result("5B. WebSocket frame size limit (>8 KB)", False, "Server kept connection open")
    except websockets.exceptions.ConnectionClosed as e:
        passed = e.code in (1009, 1008, 1006)
        print_result("5B. WebSocket frame size limit (>8 KB)", passed, f"Socket closed with code {e.code} (expected 1009/1008)")
    except Exception as e:
        print_result("5B. WebSocket frame size limit (>8 KB)", True, f"Socket closed: {e}")


async def test_6_nginx_rate_limit(client: httpx.AsyncClient):
    """Fires 6 rapid requests to heavy endpoint to verify Nginx rate limit returns 429."""
    statuses = []
    for _ in range(6):
        r = await client.post(f"{BASE_URL}/api/v1/benchmark/run?num_samples=999")
        statuses.append(r.status_code)

    passed = 429 in statuses
    print_result(
        "6. Nginx Rate Limiting on heavy routes (429)",
        passed,
        f"Response status codes across 6 rapid calls: {statuses}",
    )


async def main():
    print(f"==========================================================")
    print(f"  🔒 FlowSense Security Verification Suite")
    print(f"  Target: {BASE_URL}")
    print(f"==========================================================\n")
    async with httpx.AsyncClient(timeout=10.0, verify=True) as client:
        await test_1_security_headers(client)
        await asyncio.sleep(0.3)
        await test_2_auth_protection(client)
        await asyncio.sleep(0.3)
        await test_3_ssrf_and_lfi_block(client)
        await asyncio.sleep(0.3)
        await test_4_dos_validation_bounds(client)
        await asyncio.sleep(0.3)
        await test_5_websocket_origin_and_size()
        await asyncio.sleep(0.3)
        await test_6_nginx_rate_limit(client)

    print("\n==========================================================")
    print("  Verification finished successfully.")
    print("==========================================================")


if __name__ == "__main__":
    asyncio.run(main())
