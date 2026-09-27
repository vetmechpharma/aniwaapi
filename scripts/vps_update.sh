#!/usr/bin/env bash
# WA_API SaaS — one-shot VPS update script.
# Assumes the app is installed at /opt/wa_api, owned by user "wa_api",
# supervisor programs named wa_api_backend + wa_api_sidecar.
# Usage: sudo /opt/wa_api/scripts/vps_update.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wa_api}"
APP_USER="${APP_USER:-wa_api}"

echo "▸ Pulling latest code…"
sudo -iu "$APP_USER" bash -lc "
  set -e
  cd '$APP_DIR' && git pull
"

echo "▸ Backend deps…"
sudo -iu "$APP_USER" bash -lc "
  set -e
  cd '$APP_DIR/backend'
  source .venv/bin/activate
  pip install -q -r requirements.txt
  deactivate
"

echo "▸ Sidecar deps…"
sudo -iu "$APP_USER" bash -lc "
  set -e
  cd '$APP_DIR/wa-sidecar' && yarn install --production=false
"

echo "▸ Rebuilding frontend…"
sudo -iu "$APP_USER" bash -lc "
  set -e
  cd '$APP_DIR/frontend' && yarn install && yarn build
"

echo "▸ Restarting services…"
supervisorctl restart wa_api_backend wa_api_sidecar
systemctl reload nginx

echo "▸ Status:"
supervisorctl status wa_api_backend wa_api_sidecar
echo "✔ Update complete."
