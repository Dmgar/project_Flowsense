# ==============================================================================
# FlowSense Backend - Dockerfile
# Optimized for low memory footprint on AWS EC2 Free Tier (t2.micro / t3.micro)
# ==============================================================================

FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install minimal system dependencies required for OpenCV, GIS math and health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Ensure storage directories exist
RUN mkdir -p /app/data/processed /app/models

# Copy application source, scripts and datasets
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY data/ ./data/

# Make entrypoint script executable
RUN chmod +x ./scripts/docker-entrypoint.sh

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/ || exit 1

EXPOSE 8000

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]

# Single worker and hardened socket buffers minimize RAM consumption on AWS t3.micro (1 GB RAM total)
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--ws-max-size", "8192", "--ws-ping-interval", "20", "--ws-ping-timeout", "20", "--limit-concurrency", "80"]
