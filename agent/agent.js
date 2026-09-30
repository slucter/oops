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
      uptimeSeconds: parseUptimeSeconds(),
      hostname,
      privateIp: getPrivateIp(),
      publicIp: publicIpCache,
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

connect();
