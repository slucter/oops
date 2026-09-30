const express = require('express');
const clientStore = require('../services/clientStore');

const router = express.Router();

/**
 * Endpoint publik (tanpa login) yang menghasilkan script instalasi agent.
 * Dipanggil lewat `curl -fsSL <url>?token=... | bash` dari server client.
 * Token divalidasi di sini SEBELUM script dikirim — token invalid dapat
 * script yang langsung exit dengan pesan jelas, bukan silent fail.
 */
router.get('/install.sh', (req, res) => {
  res.type('text/x-shellscript');

  const token = req.query.token;
  const client = token ? clientStore.getClientByToken(token) : null;

  if (!client) {
    res.status(400).send('#!/usr/bin/env bash\necho "Token tidak valid atau sudah dicabut." >&2\nexit 1\n');
    return;
  }

  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const interval = process.env.CLIENT_METRIC_INTERVAL_MS || '30000';

  res.send(buildInstallScript({ base, token, interval }));
});

function buildInstallScript({ base, token, interval }) {
  return `#!/usr/bin/env bash
set -euo pipefail

SXOPS_DIR="$HOME/.sxops-agent"
SERVICE_NAME="sxops-agent"

echo "[sxops-install] menyiapkan direktori agent di $SXOPS_DIR"
mkdir -p "$SXOPS_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[sxops-install] node tidak ditemukan, mencoba install..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y && sudo apt-get install -y nodejs npm
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y nodejs npm
  elif command -v apk >/dev/null 2>&1; then
    sudo apk add --no-cache nodejs npm
  else
    echo "[sxops-install] tidak bisa deteksi package manager. Install node manual lalu jalankan ulang command ini." >&2
    exit 1
  fi
fi

echo "[sxops-install] mendownload agent..."
curl -fsSL "${base}/agent-files/agent.js" -o "$SXOPS_DIR/agent.js"
curl -fsSL "${base}/agent-files/resourceParser.js" -o "$SXOPS_DIR/resourceParser.js"
curl -fsSL "${base}/agent-files/package.json" -o "$SXOPS_DIR/package.json"

echo "[sxops-install] install dependencies..."
cd "$SXOPS_DIR"
npm install --production --silent

echo "[sxops-install] mendaftarkan systemd user service..."
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/$SERVICE_NAME.service" <<UNIT
[Unit]
Description=sxops monitoring agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=SXOPS_SERVER_URL=${base}
Environment=SXOPS_TOKEN=${token}
Environment=SXOPS_INTERVAL_MS=${interval}
ExecStart=$(command -v node) $SXOPS_DIR/agent.js
Restart=always
RestartSec=5
StartLimitIntervalSec=0

[Install]
WantedBy=default.target
UNIT

echo "[sxops-install] mengaktifkan lingering supaya agent tetap jalan setelah reboot tanpa perlu login..."
LINGER_OK=0
if loginctl enable-linger "$(whoami)" 2>/dev/null; then
  LINGER_OK=1
elif sudo -n loginctl enable-linger "$(whoami)" 2>/dev/null; then
  LINGER_OK=1
fi

if [ "$LINGER_OK" -ne 1 ]; then
  echo "[sxops-install] GAGAL mengaktifkan lingering (loginctl enable-linger)." >&2
  echo "[sxops-install] Tanpa ini, agent TIDAK akan otomatis jalan lagi setelah server di-reboot" >&2
  echo "[sxops-install] sampai ada yang login manual sebagai user ini. Jalankan manual:" >&2
  echo "[sxops-install]   sudo loginctl enable-linger $(whoami)" >&2
  echo "[sxops-install] lalu ulangi instalasi ini." >&2
  exit 1
fi

# XDG_RUNTIME_DIR bisa belum ter-set di sesi non-interaktif (mis. lewat curl | bash
# dari SSH tanpa pty penuh) - systemctl --user butuh ini untuk connect ke bus user.
export XDG_RUNTIME_DIR="/run/user/$(id -u)"

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"

sleep 2
if systemctl --user is-active --quiet "$SERVICE_NAME"; then
  echo "[sxops-install] selesai. Agent aktif dan akan otomatis jalan lagi setelah restart proses maupun reboot server."
else
  echo "[sxops-install] service terdaftar tapi belum aktif. Cek detail: systemctl --user status $SERVICE_NAME" >&2
  exit 1
fi
`;
}

module.exports = router;
