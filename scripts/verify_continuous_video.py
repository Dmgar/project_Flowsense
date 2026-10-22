"""Measure actual WebRTC delivery using an explicitly synthetic traffic fixture.

The installed YOLO model runs normally. Synthetic rectangles are not evidence
of vehicle detection accuracy. Public-camera accuracy needs a separate review.
Run: python -m scripts.verify_continuous_video --seconds 300 --cameras 4
"""
import argparse
import asyncio
import json
from pathlib import Path
import time

import cv2
import numpy as np
from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription

from src.services.video_service import VideoService


def fixture(path, seconds):
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 25, (1280, 720))
    if not writer.isOpened():
        raise RuntimeError("Could not create the QA video fixture.")
    road = np.full((720, 1280, 3), 40, np.uint8)
    for x in (320, 640, 960):
        cv2.line(road, (x, 80), (x, 720), (140, 140, 140), 3)
    try:
        for index in range((seconds + 15) * 25):
            frame = road.copy()
            for lane in range(4):
                x, y = 100 + lane * 320, 140 + (index * (lane + 2)) % 520
                cv2.rectangle(frame, (x, y), (x + 100, y + 65), (80 + lane * 30, 170, 100), -1)
            # 16-bit source sequence, large blocks survive lossy encoding.
            for bit in range(16):
                color = 240 if index & (1 << bit) else 10
                cv2.rectangle(frame, (bit * 20 + 20, 45), (bit * 20 + 35, 65), (color,) * 3, -1)
            cv2.putText(frame, f"SYNTHETIC VIDEO TEST | {index / 25:.2f}s", (400, 62), 0, .8, (230,) * 3, 1)
            writer.write(frame)
    finally:
        writer.release()


async def verify(seconds, count, output):
    service = VideoService()
    clients, consumers, measurements = [], [], []
    origin = time.monotonic()
    try:
        for index in range(count):
            camera = {"id": f"synthetic-qa-{index}", "stream_url": str(output / "synthetic-720p.mp4"), "playback_mode": "recorded"}
            client = RTCPeerConnection(RTCConfiguration(iceServers=[]))
            client.addTransceiver("video", direction="recvonly")
            clients.append(client)
            measurement = {"camera": camera["id"], "frames_received": 0, "first_at": None, "last_at": None,
                           "max_delivery_gap_seconds": 0, "latency_samples_seconds": [], "pts_regressions": 0}
            measurements.append(measurement)

            @client.on("track")
            def on_track(track, measurement=measurement, camera=camera):
                async def consume():
                    previous = None
                    while True:
                        frame = await track.recv()
                        now = time.monotonic()
                        if measurement["last_at"]:
                            measurement["max_delivery_gap_seconds"] = max(measurement["max_delivery_gap_seconds"], now - measurement["last_at"])
                        measurement["first_at"] = measurement["first_at"] or now
                        measurement["last_at"] = now
                        measurement["frames_received"] += 1
                        if previous is not None and frame.pts <= previous:
                            measurement["pts_regressions"] += 1
                        previous = frame.pts
                        if measurement["frames_received"] % 25 == 0:
                            bgr = frame.to_ndarray(format="bgr24")
                            sequence = sum(1 << bit for bit in range(16) if float(np.mean(bgr[50:60, bit * 20 + 24:bit * 20 + 31])) > 120)
                            measurement["latency_samples_seconds"].append(max(0, (service.sessions[camera["id"]].sequence - 1 - sequence) / 25))
                consumers.append(asyncio.create_task(consume()))

            await client.setLocalDescription(await client.createOffer())
            answer = await service.offer(camera, client.localDescription.sdp, "offer")
            await client.setRemoteDescription(RTCSessionDescription(answer["sdp"], answer["type"]))
        deadline = time.monotonic() + seconds
        status_samples = []
        while time.monotonic() < deadline:
            await asyncio.sleep(1)
            for viewer in list(service.peers):
                status = service.reading(viewer)
                if len(status_samples) < 1 or int(time.monotonic() - origin) % 30 == 0:
                    status_samples.append(status)
        results = []
        for measurement in measurements:
            duration = (measurement["last_at"] or 0) - (measurement["first_at"] or 0)
            latencies = measurement.pop("latency_samples_seconds")
            results.append({**measurement, "received_fps": round((measurement["frames_received"] - 1) / max(.001, duration), 2),
                            "latency_p95_seconds": round(float(np.percentile(latencies, 95)), 3) if latencies else None,
                            "final_status": service.sessions[measurement["camera"]].status()})
        report = {"fixture": "Synthetic 1280x720 / 25 FPS, real YOLO inference, real encoded WebRTC to aiortc receivers",
                  "browser_validation": False, "vehicle_accuracy_validation": False,
                  "requested_seconds": seconds, "camera_count": count, "results": results, "samples": status_samples}
        path = output / f"capacity-{count}-cameras-{seconds}s.json"
        path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({"report": str(path), "results": [{k: v for k, v in item.items() if k not in {"final_status", "first_at", "last_at"}} for item in results]}, indent=2))
    finally:
        for task in consumers:
            task.cancel()
        await asyncio.gather(*consumers, return_exceptions=True)
        await asyncio.gather(*(client.close() for client in clients))
        await service.shutdown()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=int, default=300)
    parser.add_argument("--cameras", type=int, choices=range(1, 5), default=1)
    args = parser.parse_args()
    output = Path("output/continuous-video").resolve()
    output.mkdir(parents=True, exist_ok=True)
    path = output / "synthetic-720p.mp4"
    if not path.exists():
        fixture(path, max(300, args.seconds))
    asyncio.run(verify(args.seconds, args.cameras, output))


if __name__ == "__main__":
    main()
