#!/bin/sh
set -e

# ==============================================================================
# FlowSense Backend - Docker Entrypoint Script
# Prepares directories and caches before starting Uvicorn
# ==============================================================================

# Ensure data and models directories exist
mkdir -p /app/data/processed /app/models

# Verify or download YOLOv8n ONNX perception model
if [ ! -f "/app/models/yolov8n.onnx" ]; then
    echo "[FlowSense] YOLOv8n ONNX model not found in /app/models."
    echo "[FlowSense] Attempting automatic download from mirror..."
    python3 scripts/download_model.py || echo "[FlowSense] Warning: Automatic model download skipped/failed. Perception fallback mode will be active."
else
    echo "[FlowSense] Perception model verified at /app/models/yolov8n.onnx."
fi

# Hand over execution to container CMD
exec "$@"
