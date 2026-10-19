# FlowSense — AWS Cloud Deployment & Operational Runbook

Technical documentation of the production deployment architecture for **FlowSense** on **AWS EC2 (Free Tier)**.

---

## 🏛️ Cloud Architecture Overview

FlowSense is containerized and orchestrated via Docker Compose, engineered specifically to operate reliably within the strict memory constraints of an **AWS Free Tier EC2 instance (`t2.micro` or `t3.micro`, 1 vCPU, 1 GiB RAM)**.

```
                           Internet (Client Browser)
                                      │
                         HTTP Port 80 (or 5173)
                                      ▼
                        ┌───────────────────────────┐
                        │    AWS EC2 (t3.micro)     │
                        │    Amazon Linux 2023      │
                        │    (20 GB EBS + 2GB SWAP) │
                        └─────────────┬─────────────┘
                                      │
                     ┌────────────────┴────────────────┐
                     │     Docker Bridge Network       │
                     │         (flowsense-net)         │
                     ▼                                 ▼
         ┌───────────────────────┐         ┌───────────────────────┐
         │  flowsense-frontend   │         │   flowsense-backend   │
         │  (Nginx 1.31 Alpine)  │         │  (FastAPI + Uvicorn)  │
         │   RAM: ~12 MB         │         │   RAM: ~180 MB        │
         ├───────────────────────┤         ├───────────────────────┤
         │ • React 19 SPA        │         │ • Dynamic Urban Graph │
         │ • Gzip compression    │─/api/──▶│ • OpenCV 5 Ingestion  │
         │ • Asset caching (1yr) │─/docs/─▶│ • YOLOv8 Perception   │
         │ • WebSocket Upgrade   │─/ws/───▶│ • Telemetry Streamer  │
         └───────────────────────┘         └───────────┬───────────┘
                                                       │
                                                Mounted Volumes:
                                         • ./data/processed (SQLite, Graphs)
                                         • ./models (YOLOv8n ONNX)
```

---

## ⚙️ Key Architectural Components

### 1. Frontend: Multi-Stage Production Nginx (`< 15 MB RAM`)
* **Previous State:** Running Vite development server (`npm run dev`) inside Node.js consumed ~200 MB of RAM and lacked production compression and caching.
* **Production State:** 
  * **Stage 1 (Builder):** `node:24-alpine` builds the TypeScript and Vite assets into `dist/`.
  * **Stage 2 (Runner):** `nginx:alpine` serves static assets with Gzip enabled and acts as a high-performance reverse proxy for `/api/`, `/docs`, `/openapi.json`, and `/ws/`.
  * **WebSocket Resilience:** `proxy_read_timeout 86400s;` and `proxy_send_timeout 86400s;` prevent telemetry disconnections.
  * **Memory footprint:** Reduced to less than **15 MB of RAM**.

### 2. Backend: FastAPI Single-Worker Engine (`< 180 MB RAM`)
* **Base:** `python:3.13-slim` with minimal native libraries (`libglib2.0-0`, `libgl1`, `libgomp1`, `curl`).
* **Container Entrypoint (`scripts/docker-entrypoint.sh`):**
  * Verifies local presence of the base urban graph (`manhattan_graph.graphml`).
  * Checks for `models/yolov8n.onnx` and auto-downloads the model weights if missing without blocking startup upon network interruption.
* **Worker Optimization:** 1 Uvicorn worker pinned to prevent multi-process memory multiplication on 1 GiB host instances.

### 3. Host Memory Resilience: 2 GB SWAP File
* Without swap memory, running Docker builds on a 1 GiB RAM EC2 instance causes the Linux kernel OOM Killer to terminate processes or freeze the instance.
* The deployment script automatically checks and activates a **2 GB Swapfile** at `/swapfile`.

---

## 🚀 Quick Deployment Guide

### Prerequisites
1. An AWS EC2 instance running **Amazon Linux 2023** or **Ubuntu 24.04 LTS** (`t3.micro`).
2. Security Group with the following inbound rules:
   * **TCP 80 (HTTP):** `0.0.0.0/0` (Web application and API proxy).
   * **TCP 22 (SSH):** Your administrative IP.
   * *(Optional)* **TCP 8000:** Direct backend access.

### 1-Command Automated Deployment
Connect to your EC2 instance via SSH or EC2 Instance Connect and run:

```bash
sudo dnf install -y git   # (Amazon Linux) or sudo apt update && sudo apt install -y git (Ubuntu)
git clone https://github.com/Dmgar/project_Flowsense.git
cd project_Flowsense
chmod +x scripts/deploy_aws.sh
./scripts/deploy_aws.sh
```

---

## 📊 Verification & Health Checks

Verify your deployment with standard curl probes against your instance's public IP:

```bash
# 1. Frontend Web Interface
curl -I http://<EC2_PUBLIC_IP>/
# Expected: HTTP/1.1 200 OK (Server: nginx)

# 2. Dynamic Graph & City Status
curl -s http://<EC2_PUBLIC_IP>/api/v1/graph/status
# Expected: JSON containing node_count, edge_count, and operational status

# 3. Interactive Swagger Documentation
curl -I http://<EC2_PUBLIC_IP>/docs
# Expected: HTTP/1.1 200 OK
```

---

## 🛠️ Operations & Maintenance

| Action | Command |
| :--- | :--- |
| **Stream container logs** | `docker compose logs -f` |
| **Backend logs only** | `docker compose logs -f backend` |
| **Frontend logs only** | `docker compose logs -f frontend` |
| **Inspect resource consumption** | `docker stats` |
| **Restart services** | `docker compose restart` |
| **Stop stack** | `docker compose down` |
| **Rebuild & restart in background** | `docker compose up -d --build` |
