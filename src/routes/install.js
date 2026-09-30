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

  // Di balik reverse proxy, req.protocol selalu "http" karena koneksi
  // nginx->app memang plain. Protokol asli ada di X-Forwarded-Proto, dan
  // salah di sini berarti agent memakai ws:// alih-alih wss://.
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const base = process.env.PUBLIC_BASE_URL || `${proto}://${req.get('host')}`;
  const interval = process.env.CLIENT_METRIC_INTERVAL_MS || '30000';

  res.send(buildInstallScript({ base, token, interval }));
});

function buildInstallScript({ base, token, interval }) {
  return `#!/usr/bin/env bash
set -euo pipefail

OOPS_DIR="$HOME/.oops-agent"
SERVICE_NAME="oops-agent"

echo "[oops-install] menyiapkan direktori agent di $OOPS_DIR"
mkdir -p "$OOPS_DIR"

# ============================================================
# Pilih runtime yang SUDAH ADA di server ini.
#
# Prinsipnya: jangan pernah memasang paket ke sistem server orang lain.
#
# Python didahulukan, bukan Node. Alasannya bukan selera: agent Python
# adalah satu berkas ~24 KB tanpa dependensi apa pun (protokol WebSocket
# diimplementasikan langsung di atas soket standar), sementara agent Node
# masih membutuhkan paket 'ws' lewat npm yang belum tentu ada. Fiturnya
# identik — metrik, latency ping/pong, command, dan self-update semuanya
# sama. Diuji berdampingan di server produksi.
#
# Node dipakai kalau Python tidak ada. Kalau dua-duanya tidak ada, Node
# portable diunduh ke dalam $OOPS_DIR: ~168 MB dan tanpa sudo — berat,
# karena itu benar-benar upaya terakhir.
# ============================================================

RUNTIME=""
NODE_BIN=""
PYTHON_BIN=""

# Python 3.6+ untuk sintaks dan subprocess.run yang dipakai agent.py.
for CANDIDATE in python3 python; do
  if command -v "$CANDIDATE" >/dev/null 2>&1; then
    if "$CANDIDATE" -c 'import sys; sys.exit(0 if sys.version_info >= (3,6) else 1)' 2>/dev/null; then
      RUNTIME="python"
      PYTHON_BIN="$(command -v "$CANDIDATE")"
      echo "[oops-install] runtime: $("$PYTHON_BIN" --version 2>&1) — sudah ada, tanpa dependensi tambahan"
      break
    fi
  fi
done

# Node >= 14 dibutuhkan agent.js (optional chaining, dll).
if [ -z "$RUNTIME" ] && command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  if [ "$NODE_MAJOR" -ge 14 ] 2>/dev/null; then
    RUNTIME="node"
    NODE_BIN="$(command -v node)"
    echo "[oops-install] runtime: Node.js v$NODE_MAJOR (sudah ada di server ini)"
  else
    echo "[oops-install] Node ada tapi terlalu tua (v$NODE_MAJOR), mencari alternatif..."
  fi
fi

# Tidak ada keduanya: unduh Node portable ke dalam folder agent.
if [ -z "$RUNTIME" ]; then
  echo "[oops-install] Python 3 maupun Node.js tidak ditemukan di server ini."
  echo "[oops-install] Jalan terakhir: mengunduh Node portable ke $OOPS_DIR"
  echo "[oops-install] (tanpa sudo, tidak mengubah paket sistem) — sekitar 168 MB."
  echo "[oops-install] TIP: memasang Python 3 jauh lebih ringan, agent-nya cuma"
  echo "[oops-install] satu berkas ~24 KB tanpa dependensi. Batalkan dengan Ctrl-C"
  echo "[oops-install] kalau ingin memasang Python 3 dulu."
  sleep 5

  case "$(uname -m)" in
    x86_64|amd64) NODE_ARCH="x64" ;;
    aarch64|arm64) NODE_ARCH="arm64" ;;
    armv7l) NODE_ARCH="armv7l" ;;
    *) echo "[oops-install] arsitektur $(uname -m) tidak didukung Node portable." >&2
       echo "[oops-install] Pasang Node.js atau Python 3 di server ini, lalu ulangi." >&2
       exit 1 ;;
  esac

  # Versi LTS yang dipatok, bukan "latest": instalasi harus menghasilkan
  # hal yang sama hari ini dan enam bulan lagi. Build musl untuk Alpine —
  # binary glibc akan gagal start di sana dengan pesan yang membingungkan.
  NODE_VER="v20.18.1"
  if [ -f /etc/alpine-release ] || (command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl); then
    echo "[oops-install] sistem berbasis musl (Alpine) terdeteksi." >&2
    echo "[oops-install] Node resmi tidak menyediakan build musl." >&2
    echo "[oops-install] Pasang salah satu dulu:  apk add nodejs   ATAU   apk add python3" >&2
    echo "[oops-install] lalu jalankan ulang command instalasi ini." >&2
    exit 1
  fi

  NODE_PKG="node-\${NODE_VER}-linux-\${NODE_ARCH}"
  NODE_URL="https://nodejs.org/dist/\${NODE_VER}/\${NODE_PKG}.tar.xz"

  if ! command -v tar >/dev/null 2>&1; then
    echo "[oops-install] 'tar' tidak tersedia, tidak bisa memasang Node portable." >&2
    exit 1
  fi

  echo "[oops-install] mengunduh \${NODE_PKG} (~25 MB terkompresi)..."
  rm -rf "$OOPS_DIR/node-runtime" "$OOPS_DIR/.node-tmp"
  mkdir -p "$OOPS_DIR/.node-tmp"
  if ! curl -fsSL --max-time 600 "$NODE_URL" | tar -xJ -C "$OOPS_DIR/.node-tmp" 2>/dev/null; then
    echo "[oops-install] gagal mengunduh/mengekstrak Node portable." >&2
    echo "[oops-install] Periksa koneksi ke nodejs.org, atau pasang Python 3 di server ini" >&2
    echo "[oops-install] (jauh lebih ringan) lalu ulangi instalasi." >&2
    rm -rf "$OOPS_DIR/.node-tmp"
    exit 1
  fi
  mv "$OOPS_DIR/.node-tmp/$NODE_PKG" "$OOPS_DIR/node-runtime"
  rm -rf "$OOPS_DIR/.node-tmp"

  NODE_BIN="$OOPS_DIR/node-runtime/bin/node"
  if [ ! -x "$NODE_BIN" ]; then
    echo "[oops-install] binary node portable tidak ditemukan setelah ekstrak." >&2
    exit 1
  fi
  RUNTIME="node"
  echo "[oops-install] Node portable siap: $("$NODE_BIN" --version)"
fi

# ============================================================
# Unduh berkas agent sesuai runtime terpilih
# ============================================================

if [ "$RUNTIME" = "node" ]; then
  echo "[oops-install] mendownload agent (Node)..."
  curl -fsSL "${base}/agent-files/agent.js" -o "$OOPS_DIR/agent.js"
  curl -fsSL "${base}/agent-files/resourceParser.js" -o "$OOPS_DIR/resourceParser.js"
  curl -fsSL "${base}/agent-files/version.js" -o "$OOPS_DIR/version.js"
  curl -fsSL "${base}/agent-files/package.json" -o "$OOPS_DIR/package.json"

  # npm ikut dalam paket Node portable; pada Node sistem belum tentu ada.
  NPM_BIN=""
  if [ -x "$OOPS_DIR/node-runtime/bin/npm" ]; then
    NPM_BIN="$OOPS_DIR/node-runtime/bin/npm"
  elif command -v npm >/dev/null 2>&1; then
    NPM_BIN="$(command -v npm)"
  fi

  if [ -n "$NPM_BIN" ]; then
    echo "[oops-install] memasang dependencies..."
    (cd "$OOPS_DIR" && PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" install --production --silent --no-audit --no-fund)
  else
    echo "[oops-install] npm tidak tersedia — agent Node butuh paket 'ws'." >&2
    echo "[oops-install] Pasang npm, atau pasang Python 3 lalu ulangi (agent Python tidak butuh dependensi)." >&2
    exit 1
  fi

  EXEC_START="$NODE_BIN $OOPS_DIR/agent.js"
else
  echo "[oops-install] mendownload agent (Python, tanpa dependensi)..."
  curl -fsSL "${base}/agent-files/agent.py" -o "$OOPS_DIR/agent.py"
  chmod +x "$OOPS_DIR/agent.py"
  # -u supaya log langsung masuk journal, tidak tertahan buffer.
  EXEC_START="$PYTHON_BIN -u $OOPS_DIR/agent.py"
fi

echo "[oops-install] mendaftarkan systemd user service..."
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/$SERVICE_NAME.service" <<UNIT
[Unit]
Description=oops monitoring agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=OOPS_SERVER_URL=${base}
Environment=OOPS_TOKEN=${token}
Environment=OOPS_INTERVAL_MS=${interval}
Environment=OOPS_SERVICE_NAME=$SERVICE_NAME
ExecStart=$EXEC_START
Restart=always
RestartSec=5
StartLimitIntervalSec=0

[Install]
WantedBy=default.target
UNIT

echo "[oops-install] mengaktifkan lingering supaya agent tetap jalan setelah reboot tanpa perlu login..."
LINGER_OK=0
if loginctl enable-linger "$(whoami)" 2>/dev/null; then
  LINGER_OK=1
elif sudo -n loginctl enable-linger "$(whoami)" 2>/dev/null; then
  LINGER_OK=1
fi

if [ "$LINGER_OK" -ne 1 ]; then
  echo "[oops-install] GAGAL mengaktifkan lingering (loginctl enable-linger)." >&2
  echo "[oops-install] Tanpa ini, agent TIDAK akan otomatis jalan lagi setelah server di-reboot" >&2
  echo "[oops-install] sampai ada yang login manual sebagai user ini. Jalankan manual:" >&2
  echo "[oops-install]   sudo loginctl enable-linger $(whoami)" >&2
  echo "[oops-install] lalu ulangi instalasi ini." >&2
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
  echo "[oops-install] selesai. Agent aktif (runtime: $RUNTIME) dan akan otomatis"
  echo "[oops-install] jalan lagi setelah restart proses maupun reboot server."
else
  echo "[oops-install] service terdaftar tapi belum aktif. Cek detail: systemctl --user status $SERVICE_NAME" >&2
  exit 1
fi
`;
}

module.exports = router;
