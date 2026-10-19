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

# 2. Check and Install Docker, Docker Compose & Docker Buildx
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
    fi
fi

# Ensure docker service is running and enabled
sudo systemctl enable --now docker 2>/dev/null || true
sudo systemctl start docker 2>/dev/null || true
sudo usermod -aG docker "$USER" 2>/dev/null || true
sudo chmod 666 /var/run/docker.sock 2>/dev/null || true

# Ensure docker-compose plugin is available system-wide
if ! docker compose version &> /dev/null; then
    echo "  -> Installing docker-compose plugin..."
    COMPOSE_ARCH=$(uname -m)
    sudo mkdir -p /usr/local/lib/docker/cli-plugins /usr/libexec/docker/cli-plugins "$HOME/.docker/cli-plugins"
    sudo curl -sSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${COMPOSE_ARCH}" -o /usr/local/lib/docker/cli-plugins/docker-compose
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    sudo ln -sf /usr/local/lib/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose
    sudo cp -f /usr/local/lib/docker/cli-plugins/docker-compose /usr/libexec/docker/cli-plugins/docker-compose 2>/dev/null || true
    cp -f /usr/local/lib/docker/cli-plugins/docker-compose "$HOME/.docker/cli-plugins/docker-compose" 2>/dev/null || true
fi

# Ensure docker-buildx plugin is available system-wide (Required by modern compose build)
if ! docker buildx version &> /dev/null; then
    echo "  -> Installing docker-buildx plugin..."
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64) BUILDX_ARCH="amd64" ;;
        aarch64) BUILDX_ARCH="arm64" ;;
        *) BUILDX_ARCH="$ARCH" ;;
    esac
    BUILDX_TAG=$(curl -sI https://github.com/docker/buildx/releases/latest | grep -i '^Location:' | sed -E 's/.*tag\/(.*)/\1/' | tr -d '\r\n' || true)
    [ -z "$BUILDX_TAG" ] && BUILDX_TAG="v0.38.0"
    sudo mkdir -p /usr/local/lib/docker/cli-plugins /usr/libexec/docker/cli-plugins "$HOME/.docker/cli-plugins"
    sudo curl -sSL "https://github.com/docker/buildx/releases/download/${BUILDX_TAG}/buildx-${BUILDX_TAG}.linux-${BUILDX_ARCH}" -o /usr/local/lib/docker/cli-plugins/docker-buildx
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx
    sudo ln -sf /usr/local/lib/docker/cli-plugins/docker-buildx /usr/local/bin/docker-buildx
    sudo cp -f /usr/local/lib/docker/cli-plugins/docker-buildx /usr/libexec/docker/cli-plugins/docker-buildx 2>/dev/null || true
    cp -f /usr/local/lib/docker/cli-plugins/docker-buildx "$HOME/.docker/cli-plugins/docker-buildx" 2>/dev/null || true
fi

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
