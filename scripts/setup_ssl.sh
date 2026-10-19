#!/bin/bash
# ==============================================================================
# FlowSense - Automated Free SSL Certificate Setup (Let's Encrypt / Certbot)
# Domain: flowsense.duckdns.org
# ==============================================================================
set -e

DOMAIN="flowsense.duckdns.org"

echo "=========================================================="
echo "  🔒 Setting up Let's Encrypt SSL Certificate for:        "
echo "     https://$DOMAIN                                      "
echo "=========================================================="

# 1. Stop frontend container temporarily to free port 80 for ACME challenge
echo "[1/4] Stopping frontend container to free port 80..."
docker compose stop frontend 2>/dev/null || sudo docker compose stop frontend 2>/dev/null || true

# 2. Run official Certbot container to obtain the certificate
echo "[2/4] Requesting SSL Certificate from Let's Encrypt..."
sudo docker run --rm -p 80:80 \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/lib/letsencrypt:/var/lib/letsencrypt \
  certbot/certbot certonly --standalone \
  -d "$DOMAIN" \
  --agree-tos \
  --register-unsafely-without-email \
  --non-interactive

# 3. Apply SSL Nginx configuration
echo "[3/4] Activating SSL Nginx configuration..."
cp -f frontend/nginx_ssl.conf frontend/nginx.conf

# 4. Rebuild and launch frontend with HTTPS and port 443
echo "[4/4] Starting frontend with HTTPS enabled..."
docker compose up -d --build frontend || sudo docker compose up -d --build frontend

echo ""
echo "=========================================================="
echo "  🎉 HTTPS successfully activated for $DOMAIN!           "
echo "=========================================================="
echo "  🔒 Secure Web Dashboard: https://$DOMAIN"
echo "  🔒 Secure API Docs:      https://$DOMAIN/docs"
echo "  ⚡ Secure Telemetry WS:   wss://$DOMAIN/ws/telemetry"
echo "=========================================================="
