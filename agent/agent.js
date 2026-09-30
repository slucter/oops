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
    sendMetric();
    metricTimer = setInterval(sendMetric, INTERVAL_MS);
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

connect();
