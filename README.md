# FlowSense

**Real-Time Traffic Perception for Public Transit Route Optimization**

Proposal for the [OpenCV AI Competition 2026, powered by AWS](https://opencv.org/)

---

## One-line pitch

FlowSense uses **OpenCV 5** to read traffic cameras and turn vehicle and pedestrian flow into dynamic weights on an urban graph, allowing a multi-objective optimizer to reroute buses in real time as congestion appears — all processed on **AWS**.

## Problem

Public transit route optimization systems almost always rely on static data: fixed distances, historical average travel times, OpenStreetMap maps with no time-of-day variability. The result is routes that are "optimal on paper" but don't react to an accident, a large event, or a traffic jam forming right now.

The real problem isn't just optimizing routes — it's knowing what's happening on the streets *right now* and turning that into a signal the optimizer can actually use.

## Solution architecture

FlowSense combines three layers:

### a) Perception (OpenCV 5 — core component)
- Video ingestion from traffic cameras (public DOT/municipal feeds, or urban traffic video datasets such as **UA-DETRAC** / **BDD100K** for the initial development and validation phase).
- Vehicle and pedestrian detection and tracking using OpenCV 5's `dnn` module (a lightweight YOLO-type model exported to ONNX) plus `cv2.Tracker` / optical flow for frame-to-frame tracking.
- Traffic density estimation per intersection/road segment (vehicle counts, estimated average speed, congestion level).

### b) Urban model
- The city is modeled as a directed graph using `osmnx` + `networkx`, importing real streets from OpenStreetMap.
- Edge weights (travel time) are updated dynamically from the congestion signal produced by OpenCV, instead of using fixed values.
- Multi-objective optimization with `pymoo` (NSGA-II): passenger travel time, passengers served, and vehicle distance traveled.

### c) Visualization and delivery
- **FastAPI** backend with **WebSockets** streaming the graph state and recalculated routes in real time.
- **Leaflet.js** frontend showing a "digital twin" of the city: streets colored by detected congestion, plus bus routes re-optimizing live.
- This web dashboard is the accessible endpoint for judges.

## AWS usage

> **Note:** No AWS credits were assigned to the team for this competition. The plan below is scoped to fit within **AWS Free Tier** limits, with GPU-backed inference deferred to local development (or a free alternative like Google Colab) until deployment.

- **Video processing (dev phase):** Vehicle/pedestrian detection with OpenCV/ONNX runs **locally** on recorded datasets (UA-DETRAC/BDD100K) rather than on paid EC2 GPU instances.
- **Video processing (deployment, if credits become available):** EC2 instances (GPU-backed) running OpenCV/ONNX inference on live video feeds.
- **Stream ingestion:** S3 + batch processing for recorded datasets initially; Amazon Kinesis Video Streams considered only if credits/budget allow.
- **Orchestration:** FastAPI backend deployed on a Free Tier–eligible EC2 instance (e.g. `t2.micro`/`t3.micro`), with graph state persisted in a lightweight store (Redis/DynamoDB, within free-tier limits).
- A **billing alert** is configured from day one with a low threshold to avoid unexpected charges.
- The full vision pipeline (capture → inference → congestion signal) is designed to run on AWS for the final deployment, but development stays local/free wherever possible given the lack of assigned credits.

## Work plan (Aug 26 – Oct 26)

| Weeks | Milestone |
|-------|-----------|
| 1–2   | Base graph for a pilot city using `osmnx`/`networkx`; vehicle detection pipeline with OpenCV 5 on recorded video |
| 3–4   | Tracking + congestion estimation per segment; deployment of the inference pipeline on AWS |
| 5–6   | Integration: congestion signal → dynamic graph weights; reactive NSGA-II optimization |
| 7–8   | Real-time dashboard (FastAPI + WebSockets + Leaflet); polish for demo and mid-point checkpoint |
| 9–10  | Testing with a live feed (if feasible) or additional datasets; documentation and final submission |

## Tech stack

- **Computer Vision:** OpenCV 5, ONNX, YOLO-type detector
- **Graph & Optimization:** `osmnx`, `networkx`, `pymoo` (NSGA-II)
- **Backend:** FastAPI, WebSockets
- **Frontend:** Leaflet.js, HTML/JS
- **Cloud:** AWS (EC2, Kinesis Video Streams, ECS, Redis/DynamoDB, S3)

## Team

- **Dariem Garcia** — Python backend + lightweight frontend architecture (FastAPI/HTML-JS)
- **Thomas Cristhancho**
- **Jesus Campo Yuunes** — Full stack developer
- **Daniel Franco**

## Responsible use & licensing

- Video datasets used in development (UA-DETRAC, BDD100K, or others) are public for research purposes; they are cited and their licenses respected.
- If live traffic camera feeds are used, priority is given to official public sources (DOT/municipal) designed for public consumption, avoiding any feed with an expectation of privacy.
- The system does not identify individual people or license plates — it only counts and classifies objects in aggregate (vehicle/pedestrian), avoiding surveillance or privacy risks.

---

## Getting started

> _Setup instructions coming soon as the pipeline components are built out._

```bash
git clone https://github.com/Dmgar/project_Flowsense.git
cd project_Flowsense
```

## License

TBD
