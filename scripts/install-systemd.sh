#!/usr/bin/env bash
set -euo pipefail

# Installa unit systemd PriceRadar con Restart=always.
# Uso:
#   sudo bash scripts/install-systemd.sh control
#   sudo bash scripts/install-systemd.sh scraper

PLANE="${1:-}"
APP_DIR="${APP_DIR:-/opt/price-radar}"
REAL_USER="${SUDO_USER:-andreaem}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_SRC="${SCRIPT_DIR}/systemd"

log() { echo "[install-systemd] $*"; }

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Esegui con: sudo bash scripts/install-systemd.sh {control|scraper}"
  exit 1
fi

if [[ "$PLANE" != "control" && "$PLANE" != "scraper" ]]; then
  echo "Uso: sudo bash scripts/install-systemd.sh {control|scraper}"
  exit 1
fi

if [[ ! -d "$APP_DIR" ]]; then
  log "ERRORE: $APP_DIR non trovato"
  exit 1
fi

mkdir -p "$APP_DIR/data/logs"
chown -R "$REAL_USER:$REAL_USER" "$APP_DIR/data/logs"

install_unit() {
  local unit_name="$1"
  local src="${UNIT_SRC}/${unit_name}.service"
  local dest="/etc/systemd/system/${unit_name}.service"

  if [[ ! -f "$src" ]]; then
    log "ERRORE: unit mancante $src"
    exit 1
  fi

  sed \
    -e "s|__APP_DIR__|${APP_DIR}|g" \
    -e "s|__PRICE_RADAR_USER__|${REAL_USER}|g" \
    "$src" > "$dest"

  log "Installata $dest"
}

stop_manual_processes() {
  local pattern="$1"
  pkill -u "$REAL_USER" -f "$pattern" 2>/dev/null || true
}

case "$PLANE" in
  control)
    install_unit price-radar-api
    install_unit price-radar-scheduler
    install_unit price-radar-ai
    stop_manual_processes "apps/api-service/dist/index.js"
    stop_manual_processes "apps/scheduler-service/dist/index.js"
    stop_manual_processes "apps/ai-worker/dist/index.js"
    systemctl daemon-reload
    systemctl enable price-radar-api price-radar-scheduler price-radar-ai
    systemctl restart price-radar-api price-radar-scheduler price-radar-ai
    ;;
  scraper)
    install_unit price-radar-scraper
    stop_manual_processes "apps/scraper-worker/dist/index.js"
    systemctl daemon-reload
    systemctl enable price-radar-scraper
    systemctl restart price-radar-scraper
    ;;
esac

log "Stato servizi ($PLANE):"
systemctl --no-pager --full status "price-radar-*" 2>/dev/null | sed -n '1,40p' || true

cat <<EOF

=== systemd installato ($PLANE) ===

Restart automatico: Restart=always (attesa 10s)

Comandi utili:
  sudo systemctl status price-radar-scheduler
  sudo journalctl -u price-radar-scheduler -f
  tail -f $APP_DIR/data/logs/scheduler-service.log

EOF
