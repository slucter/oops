#!/usr/bin/env node
'use strict';

/**
 * Agent Oops — dijalankan di server client. Connect ke server monitoring
 * lewat WebSocket, kirim payload metrik berkala, dan merespons permintaan
 * command (docker ps -a / ss -tulnp) dari server.
 *
 * Konfigurasi lewat environment variable (diset oleh install.sh ke unit
 * systemd): OOPS_SERVER_URL, OOPS_TOKEN, OOPS_INTERVAL_MS (opsional).
 */

const WebSocket = require('ws');
const os = require('os');
const https = require('https');
const { execSync } = require('child_process');
const { RESOURCE_COMMAND, parseResourceOutput } = require('./resourceParser');
const { AGENT_VERSION } = require('./version');

const SERVER_URL = process.env.OOPS_SERVER_URL;
const TOKEN = process.env.OOPS_TOKEN;
const INTERVAL_MS = Number(process.env.OOPS_INTERVAL_MS || 30000);
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60000;

// Berapa kali token boleh ditolak (HTTP 401) sebelum agent menyimpulkan
// dirinya memang sudah dicabut lalu berhenti. Tidak langsung di penolakan
// pertama: database server bisa saja sedang di-restore dari backup, dan
// agent yang menghapus dirinya karena gangguan sesaat tidak bisa dibatalkan
// dari jarak jauh — harus datang ke server itu lagi secara manual.
const MAX_TOKEN_REJECTIONS = Number(process.env.OOPS_MAX_TOKEN_REJECTIONS || 10);

let rejectedCount = 0;

if (!SERVER_URL || !TOKEN) {
  console.error('[agent] OOPS_SERVER_URL dan OOPS_TOKEN wajib diset.');
  process.exit(1);
}

// Jaring pengaman terakhir: kalau ada bug tak terduga yang lolos dari try/
// catch, jangan mati diam-diam — log lalu exit dengan kode error supaya
// systemd (Restart=always) yang menghidupkan lagi, bukan proses zombie
// yang tidak pernah reconnect maupun ter-restart.
process.on('uncaughtException', (err) => {
  console.error('[agent] uncaught exception, keluar supaya systemd restart:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[agent] unhandled rejection, keluar supaya systemd restart:', err);
  process.exit(1);
});

let ws = null;
let metricTimer = null;
let reconnectDelay = RECONNECT_BASE_MS;

function wsUrl() {
  const url = new URL('/agent', SERVER_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', TOKEN);
  return url.toString();
}

function connect() {
  ws = new WebSocket(wsUrl());

  ws.on('open', () => {
    console.log('[agent] terkoneksi ke server monitoring');
    reconnectDelay = RECONNECT_BASE_MS;
    rejectedCount = 0; // koneksi berhasil: penolakan sebelumnya tidak relevan lagi
    sendMetric();
    metricTimer = setInterval(sendMetric, INTERVAL_MS);
  });

  // Server menolak token sebelum handshake selesai (HTTP 401). Ini satu-satunya
  // sinyal bahwa client sudah dihapus dari dashboard — `close` biasa tidak bisa
  // membedakannya dari server yang sedang restart.
  ws.on('unexpected-response', (_req, res) => {
    if (res.statusCode === 401) {
      rejectedCount++;
      console.error(`[agent] token ditolak server (401), percobaan ke-${rejectedCount}`);
      if (rejectedCount >= MAX_TOKEN_REJECTIONS) {
        selfUninstall('token sudah dicabut dari dashboard');
        return;
      }
    }
    res.resume(); // buang body, kalau tidak socket-nya menggantung
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }
    if (msg.type === 'command' && msg.id && msg.command) {
      handleCommand(msg.id, msg.command);
      return;
    }
    if (msg.type === 'update_agent' && msg.id) {
      handleSelfUpdate(msg.id);
      return;
    }
    if (msg.type === 'uninstall_agent' && msg.id) {
      handleUninstallCommand(msg.id);
      return;
    }
    if (msg.type === 'optimize' && msg.id) {
      handleOptimize(msg.id, !!msg.docker);
    }
  });

  let reconnectScheduled = false;

  function handleDisconnect(reason) {
    // 'close' dan 'error' bisa dua-duanya terpicu untuk kejadian yang sama
    // (mis. connection refused) — pastikan reconnect cuma dijadwalkan
    // sekali, bukan dobel.
    if (reconnectScheduled) return;
    reconnectScheduled = true;
    console.log(`[agent] ${reason}, reconnect dalam ${reconnectDelay} ms`);
    clearInterval(metricTimer);
    scheduleReconnect();
  }

  ws.on('close', () => handleDisconnect('koneksi terputus'));
  ws.on('error', (err) => {
    console.error('[agent] error koneksi:', err.message);
    handleDisconnect('error koneksi');
  });
}

function scheduleReconnect() {
  setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

function sendMetric() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  refreshPublicIp();
  try {
    const output = execSync(RESOURCE_COMMAND, { encoding: 'utf8', timeout: 10000 });
    const parsed = parseResourceOutput(output);
    const hostname = execSync('hostname', { encoding: 'utf8', timeout: 5000 }).trim();

    ws.send(JSON.stringify({
      type: 'metric',
      memTotalMb: parsed.memTotalMb,
      memUsedMb: parsed.memUsedMb,
      diskTotalGb: parsed.diskTotalGb,
      diskUsedGb: parsed.diskUsedGb,
      load1m: parsed.load1m,
      load5m: parsed.load5m,
      load15m: parsed.load15m,
      cpuCount: parsed.cpuCount,
      uptimeSeconds: parseUptimeSeconds(),
      hostname,
      privateIp: getPrivateIp(),
      publicIp: publicIpCache,
      agentVersion: AGENT_VERSION,
    }));
  } catch (err) {
    console.error('[agent] gagal kirim metric:', err.message);
  }
}

/**
 * IP internal: alamat IPv4 non-loopback pertama dari interface aktif.
 * Dibaca dari os.networkInterfaces() (bukan shell) supaya tidak bergantung
 * pada `ip`/`ifconfig` yang belum tentu ada di image minimal.
 */
function getPrivateIp() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
  } catch {
    // diabaikan: IP bukan data kritis, biar null saja
  }
  return null;
}

/**
 * IP publik di-cache dan hanya di-refresh sesekali — memanggil layanan luar
 * tiap siklus metrik (default 30 detik) boros dan bisa kena rate limit.
 */
let publicIpCache = null;
let publicIpFetchedAt = 0;
const PUBLIC_IP_TTL_MS = 30 * 60 * 1000;

function refreshPublicIp() {
  if (Date.now() - publicIpFetchedAt < PUBLIC_IP_TTL_MS) return;
  publicIpFetchedAt = Date.now();

  https.get('https://api.ipify.org?format=text', { timeout: 8000 }, (res) => {
    if (res.statusCode !== 200) { res.resume(); return; }
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { body += c; if (body.length > 64) res.destroy(); });
    res.on('end', () => {
      const ip = body.trim();
      if (/^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]{2,45})$/.test(ip)) publicIpCache = ip;
    });
  }).on('error', () => {
    // offline / diblokir firewall: biarkan null, bukan kesalahan fatal
  }).on('timeout', function () { this.destroy(); });
}

function parseUptimeSeconds() {
  try {
    const raw = execSync('cat /proc/uptime', { encoding: 'utf8', timeout: 5000 });
    const seconds = parseFloat(raw.split(' ')[0]);
    return Number.isFinite(seconds) ? Math.round(seconds) : null;
  } catch {
    return null;
  }
}

const COMMANDS = {
  docker_ps: 'docker ps -a',
  port_listen: 'ss -tulnp',
};

function handleCommand(id, command) {
  const shellCommand = COMMANDS[command];
  if (!shellCommand) return;

  try {
    const output = execSync(shellCommand, { encoding: 'utf8', timeout: 15000 });
    ws.send(JSON.stringify({ type: 'command_result', id, command, output, errorMessage: null }));
  } catch (err) {
    const errorMessage = err.stderr ? err.stderr.toString() : err.message;
    ws.send(JSON.stringify({ type: 'command_result', id, command, output: null, errorMessage }));
  }
}

// ===================== Optimasi =====================

const fsMod = require('fs');

/** Byte terpakai pada / — dipakai mengukur hasil optimasi, bukan klaim. */
function diskTerpakai() {
  try {
    const out = execSync("df -B1 --output=used / 2>/dev/null | tail -1", { encoding: 'utf8', timeout: 10000 });
    const n = parseInt(out.trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function memInfo() {
  const hasil = {};
  try {
    for (const baris of fsMod.readFileSync('/proc/meminfo', 'utf8').split('\n')) {
      const [k, v] = baris.split(':');
      if (['MemTotal', 'MemAvailable', 'Cached', 'Buffers', 'SReclaimable'].includes(k)) {
        hasil[k] = parseInt(v.trim(), 10);
      }
    }
  } catch {
    // /proc tidak tersedia; biarkan kosong
  }
  return hasil;
}

function punya(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'pipe', timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

/** Apakah sudo bisa dipakai tanpa kata sandi? Diperiksa dengan -n supaya tidak menggantung. */
function sudoTanpaSandi() {
  if (process.getuid && process.getuid() === 0) return true;
  if (!punya('sudo')) return false;
  try {
    execSync('sudo -n true', { stdio: 'pipe', timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

/** Langkah yang tidak menyentuh data aplikasi dan tidak merestart apa pun. */
function langkahAman() {
  const l = [];
  // Journal systemd sering jadi pemakan disk terbesar yang tidak disadari.
  // Dipangkas ke 200M, bukan dihapus: riwayat terbaru tetap ada.
  if (punya('journalctl')) l.push(['journal systemd dipangkas ke 200M', 'journalctl --vacuum-size=200M', true]);
  if (punya('apt-get')) l.push(['cache apt dibersihkan', 'apt-get clean', true]);
  else if (punya('yum')) l.push(['cache yum dibersihkan', 'yum clean all', true]);
  else if (punya('dnf')) l.push(['cache dnf dibersihkan', 'dnf clean all', true]);
  else if (punya('apk')) l.push(['cache apk dibersihkan', 'rm -rf /var/cache/apk/*', true]);

  // Batas 7 hari, bukan semua: proses yang berjalan bisa memakai file /tmp baru.
  l.push(['file /tmp lebih tua dari 7 hari dihapus', 'find /tmp -mindepth 1 -atime +7 -delete 2>/dev/null; true', false]);
  l.push(['log rotasi lama (>30 hari) dihapus',
    "find /var/log -type f \\( -name '*.gz' -o -name '*.[0-9]' -o -name '*.old' \\) -mtime +30 -delete 2>/dev/null; true", true]);
  l.push(['cache thumbnail/pip/npm milik user dibersihkan',
    'rm -rf ~/.cache/thumbnails/* ~/.cache/pip/* ~/.npm/_cacache 2>/dev/null; true', false]);
  return l;
}

/**
 * Docker: hanya yang benar-benar tidak terpakai.
 *
 * `image prune -f` TANPA -a hanya membuang image dangling. `-a` akan ikut
 * menghapus image bertag yang sedang tidak ada containernya — termasuk image
 * yang sengaja disimpan untuk rollback.
 */
function langkahDocker() {
  if (!punya('docker')) return [];
  return [
    ['cache build docker dibuang', 'docker builder prune -f', false],
    ['image docker dangling dibuang', 'docker image prune -f', false],
    ['container mati dibuang', 'docker container prune -f', false],
    ['network tak terpakai dibuang', 'docker network prune -f', false],
  ];
}

/**
 * Jalankan optimasi, laporkan kemajuan lewat `lapor`.
 *
 * RAM SENGAJA TIDAK DISENTUH — lihat penjelasan panjang di agent.py:
 * drop_caches membuat angka turun tapi memperlambat server.
 */
function jalankanOptimasi(sertakanDocker, lapor) {
  const diskAwal = diskTerpakai();
  const mem = memInfo();
  const isRoot = process.getuid && process.getuid() === 0;
  const bisaSudo = sudoTanpaSandi();

  const langkah = langkahAman().concat(sertakanDocker ? langkahDocker() : []);
  const akanJalan = langkah.filter(([, , perluSudo]) => !(perluSudo && !bisaSudo));
  const total = akanJalan.length;

  const hasil = [];
  const dilewati = [];
  let nomor = 0;

  for (const [nama, perintahAsli, perluSudo] of langkah) {
    if (perluSudo && !bisaSudo) { dilewati.push(nama); continue; }
    nomor++;
    if (lapor) { try { lapor(nomor, total, nama); } catch { /* kabar tidak boleh menggagalkan */ } }
    const perintah = (perluSudo && !isRoot) ? `sudo -n ${perintahAsli}` : perintahAsli;
    try {
      const out = execSync(perintah, { encoding: 'utf8', timeout: 120000, stdio: 'pipe' });
      hasil.push({ nama, ok: true, pesan: (out || '').trim().slice(0, 300) || null });
    } catch (err) {
      hasil.push({ nama, ok: false, pesan: (err.message || '').slice(0, 300) });
    }
  }

  const diskAkhir = diskTerpakai();
  const hemat = (diskAwal != null && diskAkhir != null) ? Math.max(0, diskAwal - diskAkhir) : null;
  const cacheKb = (mem.Cached || 0) + (mem.Buffers || 0) + (mem.SReclaimable || 0);

  return {
    hematBytes: hemat,
    langkah: hasil,
    dilewati,
    butuhSudo: !bisaSudo,
    dockerTersedia: punya('docker'),
    memTotalMb: mem.MemTotal ? Math.round(mem.MemTotal / 1024) : null,
    memTersediaMb: mem.MemAvailable ? Math.round(mem.MemAvailable / 1024) : null,
    memCacheMb: cacheKb ? Math.round(cacheKb / 1024) : null,
  };
}

let optimasiBerjalan = false;

/**
 * Optimasi dijalankan lewat setImmediate, bukan langsung di loop pesan.
 *
 * execSync memblokir event loop, jadi selama optimasi berjalan agent tidak
 * bisa mengirim metrik maupun membalas ping — server akan menandainya DOWN.
 * Node tidak punya thread seperti Python, jadi kemajuan dikirim di sela
 * antar-langkah: tiap langkah melepas kendali sejenak supaya pesan benar-benar
 * terkirim sebelum langkah berikutnya memblokir lagi.
 */
function handleOptimize(id, sertakanDocker) {
  const kirim = (payload) => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    } catch {
      // koneksi putus; optimasi tetap diselesaikan
    }
  };

  if (optimasiBerjalan) {
    kirim({ type: 'optimize_result', id, ok: false, pesan: 'Optimasi lain masih berjalan di server ini.' });
    return;
  }
  optimasiBerjalan = true;
  kirim({ type: 'optimize_progress', id, nomor: 0, total: 0, nama: 'memulai…' });

  setImmediate(() => {
    try {
      const hasil = jalankanOptimasi(sertakanDocker, (nomor, total, nama) => {
        kirim({ type: 'optimize_progress', id, nomor, total, nama });
      });
      kirim({ ...hasil, type: 'optimize_result', id, ok: true });
      console.log(`[agent] optimasi selesai, hemat ${hasil.hematBytes} byte`);
    } catch (err) {
      console.error('[agent] optimasi gagal:', err.message);
      kirim({ type: 'optimize_result', id, ok: false, pesan: err.message });
    } finally {
      optimasiBerjalan = false;
    }
  });
}

const SERVICE_NAME = process.env.OOPS_SERVICE_NAME || 'oops-agent';

/** Bungkus argumen untuk shell — URL/path tidak pernah jadi perintah. */
function shellEscape(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Perbarui agent ini sendiri: unduh ulang berkas dari server monitoring,
 * lalu minta systemd me-restart service supaya kode baru yang jalan.
 *
 * Tiga hal yang membuat ini tidak sesederhana "curl lalu restart":
 *
 * 1. **Unduh ke lokasi sementara dulu.** Kalau menimpa agent.js langsung
 *    lalu koneksi putus di tengah, yang tersisa adalah berkas terpotong dan
 *    agent tidak akan pernah hidup lagi — client hilang dari monitoring
 *    secara permanen, justru gara-gara mencoba update. Berkas baru hanya
 *    dipindahkan ke tempatnya setelah semuanya selesai terunduh.
 *
 * 2. **Simpan cadangan versi lama** sebagai `.bak`, supaya kalau kode baru
 *    gagal start masih ada yang bisa dikembalikan secara manual.
 *
 * 3. **Balas SEBELUM restart.** Proses ini akan dimatikan systemd beberapa
 *    saat lagi; kalau balasan dikirim setelah perintah restart, dashboard
 *    tidak akan pernah menerimanya dan update yang sebenarnya berhasil
 *    terlihat seperti timeout.
 */
function handleSelfUpdate(id) {
  const fs = require('fs');
  const path = require('path');
  const dir = __dirname;

  // Berkas yang membentuk agent. Kalau nanti ada modul baru di folder
  // agent/, tambahkan di sini — kalau tidak, update menghasilkan campuran
  // berkas baru dan lama yang bisa saling tidak cocok.
  const FILES = ['agent.js', 'resourceParser.js', 'version.js', 'package.json'];

  const reply = (ok, message) => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'update_result', id, ok, message, version: AGENT_VERSION }));
      }
    } catch {
      // koneksi sudah tidak bisa dipakai; restart di bawah tetap jalan
    }
  };

  console.log('[agent] menerima perintah update, mengunduh berkas baru...');
  const tmpDir = path.join(dir, '.update-tmp');

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const name of FILES) {
      const url = new URL(`/agent-files/${name}`, SERVER_URL).toString();
      // Lewat curl, bukan https.get, supaya perilaku redirect, proxy, dan
      // sertifikat sama persis dengan yang dipakai install.sh — kalau curl
      // bisa menjangkau server saat instalasi, ia juga bisa di sini.
      execSync(`curl -fsSL --max-time 30 ${shellEscape(url)} -o ${shellEscape(path.join(tmpDir, name))}`, {
        timeout: 40000,
        stdio: 'pipe',
      });
      if (fs.statSync(path.join(tmpDir, name)).size === 0) {
        throw new Error(`berkas ${name} kosong`);
      }
    }

    // Semua berkas sudah lengkap di tmp. Baru sekarang menyentuh yang asli.
    for (const name of FILES) {
      const target = path.join(dir, name);
      if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`);
      fs.renameSync(path.join(tmpDir, name), target);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Dependensi bisa berubah antar versi. Kegagalan di sini sengaja tidak
    // membatalkan update: kalau node_modules lama masih memenuhi kebutuhan,
    // agent tetap bisa jalan — lebih baik daripada menggagalkan update yang
    // berkasnya sudah terpasang.
    try {
      execSync('npm install --production --silent --no-audit --no-fund', {
        cwd: dir, timeout: 180000, stdio: 'pipe',
      });
    } catch (err) {
      console.error('[agent] npm install gagal, lanjut dengan dependensi yang ada:', err.message);
    }

    console.log('[agent] berkas diperbarui, restart service...');
    reply(true, 'Berkas agent diperbarui, service sedang restart.');

    // Jeda supaya balasan di atas benar-benar terkirim lewat socket sebelum
    // proses ini dimatikan.
    setTimeout(() => {
      try {
        execSync(`systemctl --user restart ${shellEscape(SERVICE_NAME)}`, {
          timeout: 20000,
          stdio: 'pipe',
          env: { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}` },
        });
      } catch (err) {
        // systemctl tidak bisa dipanggil (mis. agent dijalankan manual,
        // bukan sebagai service). Keluar dengan kode error — kalau dia
        // memang service, Restart=always yang menghidupkan kembali.
        console.error('[agent] systemctl restart gagal, keluar supaya di-restart:', err.message);
        process.exit(1);
      }
    }, 500);
  } catch (err) {
    console.error('[agent] update gagal:', err.message);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* sudah bersih */ }
    // Kalau gagal di tahap unduh, berkas asli belum tersentuh sama sekali —
    // agent tetap jalan dengan versi lama, tidak ada yang perlu dipulihkan.
    reply(false, `Update gagal: ${err.message}`);
  }
}

/**
 * Hapus agent ini dari server tempatnya berjalan: matikan service, cabut
 * dari systemd, lalu hapus direktori kerjanya.
 *
 * Urutannya penting. `disable` dijalankan SEBELUM proses ini mati, karena
 * setelah itu tidak ada lagi yang bisa menjalankan perintah apa pun — kalau
 * dibalik, unit-nya tetap enabled dan agent hidup lagi begitu server
 * di-reboot, justru setelah "berhasil" di-uninstall.
 *
 * Direktori dihapus paling akhir lewat proses terpisah yang detached: kita
 * sedang menghapus folder tempat berkas yang sedang dieksekusi berada, jadi
 * penghapusnya tidak boleh ikut mati bersama proses ini.
 */
function selfUninstall(alasan) {
  const fs = require('fs');
  const { spawn } = require('child_process');
  const dir = __dirname;

  console.log(`[agent] uninstall: ${alasan}`);

  const env = { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}` };
  const jalankan = (cmd) => {
    try {
      execSync(cmd, { timeout: 15000, stdio: 'pipe', env });
      return true;
    } catch {
      return false; // systemd mungkin tidak dipakai; bukan alasan berhenti
    }
  };

  // Disable dulu — lihat penjelasan di atas.
  jalankan(`systemctl --user disable ${shellEscape(SERVICE_NAME)}`);

  const home = process.env.HOME || '';
  const unitFile = `${home}/.config/systemd/user/${SERVICE_NAME}.service`;
  try {
    if (home && fs.existsSync(unitFile)) fs.unlinkSync(unitFile);
  } catch (err) {
    console.error('[agent] gagal menghapus unit file:', err.message);
  }

  // Penghapus dijalankan detached dengan jeda: ia harus tetap hidup setelah
  // proses ini mati, karena yang dihapus adalah folder berkas yang sedang
  // berjalan. `stop` dipanggil di dalamnya supaya systemd tidak menganggap
  // ini crash lalu me-restart kita di tengah penghapusan.
  // Pembersih HARUS lepas dari cgroup service ini.
  //
  // Ditemukan lewat pengujian di Linux, bukan dugaan: proses anak biasa —
  // bahkan yang detached — tetap berada di cgroup unit systemd, dan systemd
  // membunuh seluruh cgroup saat unit berhenti. Jadi pembersih ikut mati
  // sebelum sempat menghapus apa pun, lalu Restart=always menghidupkan agent
  // kembali. Hasilnya: agent mencoba mencabut diri berulang-ulang tanpa
  // pernah berhasil.
  //
  // `systemd-run` menjalankan perintah sebagai unit transient miliknya
  // sendiri, di luar cgroup kita, sehingga selamat saat unit ini dimatikan.
  const perintah = [
    'sleep 1',
    `systemctl --user stop ${shellEscape(SERVICE_NAME)} 2>/dev/null || true`,
    `systemctl --user reset-failed ${shellEscape(SERVICE_NAME)} 2>/dev/null || true`,
    'systemctl --user daemon-reload 2>/dev/null || true',
    `rm -rf ${shellEscape(dir)}`,
  ].join('; ');

  let dijadwalkan = false;
  try {
    execSync(
      `systemd-run --user --collect --quiet --unit oops-cleanup-${Date.now()} ` +
      `/bin/sh -c ${shellEscape(perintah)}`,
      { timeout: 15000, stdio: 'pipe', env }
    );
    dijadwalkan = true;
  } catch (err) {
    console.error('[agent] systemd-run tidak tersedia:', err.message);
  }

  if (!dijadwalkan) {
    // Tanpa systemd-run (mis. agent dijalankan manual, bukan sebagai
    // service), tidak ada cgroup yang membunuh kita — proses terpisah biasa
    // sudah cukup.
    try {
      const anak = spawn('/bin/sh', ['-c', perintah], { detached: true, stdio: 'ignore', env });
      anak.unref();
    } catch (err) {
      console.error('[agent] gagal menjadwalkan pembersihan direktori:', err.message);
    }
  }

  console.log('[agent] service dicabut, direktori akan dihapus. Selamat tinggal.');
  // Exit 0, bukan bukan-nol: ini penghentian yang disengaja. Kode error akan
  // membuat systemd menganggapnya crash lalu me-restart kita.
  process.exit(0);
}

/** Uninstall atas perintah dashboard — balas dulu, baru bersihkan. */
function handleUninstallCommand(id) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'uninstall_result', id, ok: true,
        message: 'Agent dicabut dari server ini.',
      }));
    }
  } catch {
    // koneksi sudah mati; pembersihan di bawah tetap jalan
  }
  // Jeda supaya balasan benar-benar terkirim sebelum socket ikut mati.
  setTimeout(() => selfUninstall('diperintahkan dari dashboard'), 500);
}

connect();
