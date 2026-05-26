#!/usr/bin/env bash
set -euo pipefail

# Ricrea SQLite corrotto (solo VM control).
# Uso: sudo bash scripts/recover-database.sh

APP_DIR="${APP_DIR:-/opt/price-radar}"
REAL_USER="${SUDO_USER:-andreaem}"

log() { echo "[recover-database] $*"; }

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Esegui con: sudo bash scripts/recover-database.sh"
  exit 1
fi

log "Stop servizi control..."
systemctl stop price-radar-api price-radar-scheduler price-radar-ai 2>/dev/null || true

TS="$(date +%s)"
BACKUP_DIR="$APP_DIR/data/backups"
mkdir -p "$BACKUP_DIR"
chown -R "$REAL_USER:$REAL_USER" "$BACKUP_DIR"

for f in price-radar.db price-radar.db-wal price-radar.db-shm; do
  if [[ -f "$APP_DIR/data/$f" ]]; then
    cp -a "$APP_DIR/data/$f" "$BACKUP_DIR/${f%.db}.corrupt.${TS}" 2>/dev/null || \
      cp -a "$APP_DIR/data/$f" "$BACKUP_DIR/${f}.corrupt.${TS}"
    log "Backup: data/$f -> backups/"
  fi
done

rm -f "$APP_DIR/data/price-radar.db" "$APP_DIR/data/price-radar.db-wal" "$APP_DIR/data/price-radar.db-shm"

log "Migrazioni + seed..."
sudo -u "$REAL_USER" bash -lc "cd '$APP_DIR' && node --input-type=module -e \"
import { loadConfig } from '@price-radar/shared';
import { runMigrations, seedRetailers } from '@price-radar/db';
import { join } from 'node:path';
const config = loadConfig();
runMigrations(config.databasePath, join('$APP_DIR', 'packages/db/drizzle'));
await seedRetailers(config.databasePath);
import Database from 'better-sqlite3';
const db = new Database(config.databasePath);
console.log(JSON.stringify(db.pragma('integrity_check')));
db.close();
\""

log "Restart servizi control..."
systemctl start price-radar-api price-radar-scheduler price-radar-ai

cat <<EOF

=== Database ricreato ===

Backup in: $BACKUP_DIR
Il scheduler risincronizzerà i prodotti da tj-api entro ~60s.

Su VM scraper assicurati:
  CONTROL_API_URL=http://<control-ip>:3000
  INTERNAL_API_KEY=<stesso valore di VM control>

EOF
