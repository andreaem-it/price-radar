#!/usr/bin/env bash
set -euo pipefail

# VM2 — priceradar-scraper
# IP control: 192.168.0.189 | IP scraper: 192.168.0.12

CONTROL_IP="${CONTROL_IP:-192.168.0.189}"
SCRAPER_IP="${SCRAPER_IP:-192.168.0.12}"
APP_DIR="${APP_DIR:-/opt/price-radar}"
REPO_URL="${REPO_URL:-git@github.com:andreaem-it/price-radar.git}"

log() { echo "[setup-scraper] $*"; }

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Esegui con: sudo bash scripts/setup-scraper.sh"
  exit 1
fi

REAL_USER="${SUDO_USER:-andreaem}"

log "Aggiornamento sistema..."
apt-get update -qq
apt-get install -y curl git build-essential python3 nfs-common

log "Node.js 20..."
if ! node -v 2>/dev/null | grep -qE '^v20\.'; then
  apt-get remove -y nodejs npm 2>/dev/null || true
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

log "pnpm 9.15.4..."
corepack disable 2>/dev/null || true
npm install -g pnpm@9.15.4

log "Repository..."
mkdir -p "$(dirname "$APP_DIR")"
chown "$REAL_USER:$REAL_USER" "$(dirname "$APP_DIR")"
if [[ ! -d "$APP_DIR/.git" ]]; then
  if [[ -d "$APP_DIR" ]] && [[ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]]; then
    log "Pulizia $APP_DIR incompleto..."
    rm -rf "$APP_DIR"
  fi
  sudo -u "$REAL_USER" git clone "$REPO_URL" "$APP_DIR"
else
  sudo -u "$REAL_USER" git -C "$APP_DIR" pull --ff-only || true
fi

log "Mount NFS da control ($CONTROL_IP)..."
mkdir -p "$APP_DIR/data"
FSTAB_LINE="$CONTROL_IP:$APP_DIR/data $APP_DIR/data nfs defaults,_netdev 0 0"
grep -qF "$CONTROL_IP:$APP_DIR/data" /etc/fstab 2>/dev/null || echo "$FSTAB_LINE" >> /etc/fstab
mount -a || mount "$CONTROL_IP:$APP_DIR/data" "$APP_DIR/data" || {
  log "ERRORE: NFS non montato. Esegui prima setup-control.sh su VM1."
  exit 1
}

log "Test Redis remoto..."
if ! redis-cli -h "$CONTROL_IP" ping 2>/dev/null | grep -q PONG; then
  log "WARN: Redis su $CONTROL_IP non raggiungibile. Controlla firewall/setup VM1."
fi

log "Env VM2..."
sudo -u "$REAL_USER" cp -f "$APP_DIR/env.vm2.example" "$APP_DIR/.env"
sudo -u "$REAL_USER" sed -i \
  "s|REDIS_URL=.*|REDIS_URL=redis://$CONTROL_IP:6379|" \
  "$APP_DIR/.env"
sudo -u "$REAL_USER" sed -i \
  "s|DATA_DIR=.*|DATA_DIR=$APP_DIR/data|" \
  "$APP_DIR/.env"
sudo -u "$REAL_USER" sed -i \
  "s|DATABASE_PATH=.*|DATABASE_PATH=$APP_DIR/data/price-radar.db|" \
  "$APP_DIR/.env"

log "pnpm install + build..."
sudo -u "$REAL_USER" bash -lc "cd '$APP_DIR' && find . -name '*.tsbuildinfo' -delete && pnpm install && pnpm build"

log "Playwright Chromium..."
sudo -u "$REAL_USER" bash -lc "cd '$APP_DIR' && pnpm exec playwright install chromium"
npx playwright install-deps chromium

log "Verifica..."
sudo -u "$REAL_USER" bash -lc "cd '$APP_DIR' && node -v && pnpm -v"

cat <<EOF

=== VM2 SCRAPER CONFIGURATA ===

Avvia worker:
  cd $APP_DIR && pnpm dev:scraper

Verifica connessione Redis:
  redis-cli -h $CONTROL_IP ping

EOF
