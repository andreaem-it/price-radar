#!/usr/bin/env bash
set -euo pipefail

# VM1 — priceradar-control
# IP control: 192.168.0.189 | IP scraper: 192.168.0.12

CONTROL_IP="${CONTROL_IP:-192.168.0.189}"
SCRAPER_IP="${SCRAPER_IP:-192.168.0.12}"
APP_DIR="${APP_DIR:-/opt/price-radar}"
REPO_URL="${REPO_URL:-git@github.com:andreaem-it/price-radar.git}"

log() { echo "[setup-control] $*"; }

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Esegui con: sudo bash scripts/setup-control.sh"
  exit 1
fi

REAL_USER="${SUDO_USER:-andreaem}"

log "Aggiornamento sistema..."
apt-get update -qq
apt-get install -y curl git build-essential python3 redis-server nfs-kernel-server

log "Node.js 20..."
if ! node -v 2>/dev/null | grep -qE '^v20\.'; then
  apt-get remove -y nodejs npm 2>/dev/null || true
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

log "pnpm 9.15.4..."
corepack disable 2>/dev/null || true
npm install -g pnpm@9.15.4

log "Redis — accesso da scraper ($SCRAPER_IP)..."
sed -i 's/^supervised no/supervised systemd/' /etc/redis/redis.conf 2>/dev/null || true
grep -q '^bind 0.0.0.0' /etc/redis/redis.conf || echo 'bind 0.0.0.0' >> /etc/redis/redis.conf
grep -q '^protected-mode no' /etc/redis/redis.conf || echo 'protected-mode no' >> /etc/redis/redis.conf
systemctl enable redis-server
systemctl restart redis-server

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow from "$SCRAPER_IP" to any port 6379 comment 'price-radar redis' || true
fi

log "Directory dati e NFS export..."
mkdir -p "$APP_DIR/data"/{screenshots,html-failures,logs}
chown -R "$REAL_USER:$REAL_USER" "$APP_DIR"

EXPORT_LINE="$APP_DIR/data $SCRAPER_IP(rw,sync,no_subtree_check,no_root_squash)"
grep -qF "$APP_DIR/data" /etc/exports 2>/dev/null || echo "$EXPORT_LINE" >> /etc/exports
exportfs -ra
systemctl enable nfs-kernel-server
systemctl restart nfs-kernel-server

log "Repository..."
if [[ ! -d "$APP_DIR/.git" ]]; then
  if [[ -d "$APP_DIR" ]] && [[ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]]; then
    log "Pulizia $APP_DIR incompleto..."
    rm -rf "$APP_DIR"
  fi
  sudo -u "$REAL_USER" git clone "$REPO_URL" "$APP_DIR"
else
  sudo -u "$REAL_USER" git -C "$APP_DIR" pull --ff-only || true
fi

log "Env VM1..."
sudo -u "$REAL_USER" cp -f "$APP_DIR/env.vm1.example" "$APP_DIR/.env"
sudo -u "$REAL_USER" sed -i \
  "s|DATA_DIR=.*|DATA_DIR=$APP_DIR/data|" \
  "$APP_DIR/.env"
sudo -u "$REAL_USER" sed -i \
  "s|DATABASE_PATH=.*|DATABASE_PATH=$APP_DIR/data/price-radar.db|" \
  "$APP_DIR/.env"
INTERNAL_KEY="${INTERNAL_API_KEY:-change-me-internal-key}"
if grep -q '^INTERNAL_API_KEY=' "$APP_DIR/.env"; then
  sudo -u "$REAL_USER" sed -i "s|INTERNAL_API_KEY=.*|INTERNAL_API_KEY=$INTERNAL_KEY|" "$APP_DIR/.env"
else
  echo "INTERNAL_API_KEY=$INTERNAL_KEY" | sudo -u "$REAL_USER" tee -a "$APP_DIR/.env" >/dev/null
fi

log "pnpm install + build..."
sudo -u "$REAL_USER" bash -lc "cd '$APP_DIR' && find . -name '*.tsbuildinfo' -delete && pnpm install && pnpm build"

log "Ollama (opzionale)..."
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh || log "Ollama non installato — fallback euristico OK"
fi
if command -v ollama >/dev/null 2>&1; then
  sudo -u "$REAL_USER" ollama pull llama3.2:1b 2>/dev/null || ollama pull llama3.2:1b || true
fi

log "Verifica..."
redis-cli ping
sudo -u "$REAL_USER" bash -lc "cd '$APP_DIR' && node -v && pnpm -v"

log "systemd (restart automatico)..."
bash "$APP_DIR/scripts/install-systemd.sh" control

cat <<EOF

=== VM1 CONTROL CONFIGURATA ===

Servizi systemd attivi (Restart=always):
  sudo systemctl status price-radar-api price-radar-scheduler price-radar-ai

Health check:
  curl http://localhost:3000/health

Poi configura VM2 scraper ($SCRAPER_IP):
  sudo bash scripts/setup-scraper.sh

EOF
