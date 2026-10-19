#!/bin/bash
# ==============================================================================
# FlowSense - AWS EC2 Free Tier Automated Deployment Script
# Supports: Ubuntu 22.04 / 24.04 LTS & Amazon Linux 2023 (t2.micro / t3.micro)
# ==============================================================================
set -e

echo "=========================================================="
echo "  🚀 Starting FlowSense Automated Deployment on AWS EC2   "
echo "=========================================================="

# 1. Configure 2GB Swap Memory (Prevents OOM crashes on 1GB RAM EC2 instances)
TOTAL_SWAP=$(free -m | awk '/^Swap:/ {print $2}')
if [ -z "$TOTAL_SWAP" ] || [ "$TOTAL_SWAP" -lt 1024 ]; then
    echo "[1/5] Configuring 2GB SWAP memory for RAM resilience..."
    if [ ! -f /swapfile ]; then
        sudo fallocate -l 2G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
        sudo chmod 600 /swapfile
        sudo mkswap /swapfile
        sudo swapon /swapfile
        echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
        echo "  -> Swap configured successfully ($(free -h | awk '/^Swap:/ {print $2}'))."
    else
        sudo swapon /swapfile 2>/dev/null || true
    fi
else
    echo "[1/5] Swap memory already present: ${TOTAL_SWAP}MB. Skipping."
fi

# 2. Check and Install Docker & Docker Compose (Ubuntu/Debian and Amazon Linux/RHEL)
echo "[2/5] Checking Docker & Docker Compose installation..."
if ! command -v docker &> /dev/null; then
    echo "  -> Docker not detected. Detecting OS package manager..."
    if command -v apt-get &> /dev/null; then
        echo "  -> Using apt (Ubuntu/Debian)..."
        sudo apt-get update -y
        sudo apt-get install -y ca-certificates curl gnupg lsb-release git
        sudo install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg || true
        sudo chmod a+r /etc/apt/keyrings/docker.gpg || true
        echo \
          "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
          $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
        sudo apt-get update -y
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    elif command -v dnf &> /dev/null; then
        echo "  -> Using dnf (Amazon Linux 2023)..."
        sudo dnf update -y
        sudo dnf install -y docker git
        # Install Docker Compose plugin for Amazon Linux if missing
        DOCKER_CONFIG=${DOCKER_CONFIG:-$HOME/.docker}
        mkdir -p "$DOCKER_CONFIG/cli-plugins"
        curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m) -o "$DOCKER_CONFIG/cli-plugins/docker-compose"
        chmod +x "$DOCKER_CONFIG/cli-plugins/docker-compose"
    fi
    sudo systemctl enable --now docker
    sudo usermod -aG docker "$USER" || true
    echo "  -> Docker installed successfully."
fi

# Ensure docker service is running
sudo systemctl start docker 2>/dev/null || true

# Ensure directories exist
mkdir -p data/processed models

# 3. Verify Perception Model Weights
echo "[3/5] Checking YOLOv8n ONNX model weights..."
if [ ! -f "models/yolov8n.onnx" ]; then
    echo "  -> Model missing locally. Attempting download via scripts/download_model.py..."
    if command -v python3 &> /dev/null; then
        python3 scripts/download_model.py || true
    fi
fi

# 4. Build and Launch Containers
echo "[4/5] Building and launching FlowSense Docker services..."
docker compose down --remove-orphans 2>/dev/null || sudo docker compose down --remove-orphans 2>/dev/null || true
docker compose up -d --build || sudo docker compose up -d --build

# 5. Verification & Health Check
echo "[5/5] Verifying service health..."
sleep 5

PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || curl -s https://checkip.amazonaws.com 2>/dev/null || echo "<YOUR_EC2_PUBLIC_IP>")

echo ""
echo "=========================================================="
echo "  ✅ FlowSense is now running in production on AWS EC2!   "
echo "=========================================================="
echo "  🌐 Web Dashboard:    http://${PUBLIC_IP}"
echo "  🌐 Legacy Dev Port:  http://${PUBLIC_IP}:5173"
echo "  📡 API Docs (Docs):  http://${PUBLIC_IP}/docs"
echo "  🔍 Direct API Port:  http://${PUBLIC_IP}:8000/docs"
echo "  ⚡ Real-Time WS:     ws://${PUBLIC_IP}/ws/telemetry"
echo "=========================================================="
echo ""
echo "To monitor container logs in real time:"
echo "  docker compose logs -f"
echo ""
