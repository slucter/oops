#!/usr/bin/env node
'use strict';

/**
 * Agent sxops — dijalankan di server client. Connect ke server monitoring
 * lewat WebSocket, kirim payload metrik berkala, dan merespons permintaan
 * command (docker ps -a / ss -tulnp) dari server.
 *
 * Konfigurasi lewat environment variable (diset oleh install.sh ke unit
 * systemd): SXOPS_SERVER_URL, SXOPS_TOKEN, SXOPS_INTERVAL_MS (opsional).
 */

const WebSocket = require('ws');
const { execSync } = require('child_process');
const { RESOURCE_COMMAND, parseResourceOutput } = require('./resourceParser');

const SERVER_URL = process.env.SXOPS_SERVER_URL;
const TOKEN = process.env.SXOPS_TOKEN;
const INTERVAL_MS = Number(process.env.SXOPS_INTERVAL_MS || 30000);
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60000;

if (!SERVER_URL || !TOKEN) {
  console.error('[agent] SXOPS_SERVER_URL dan SXOPS_TOKEN wajib diset.');
  process.exit(1);
}

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

  ws.on('close', () => {
    console.log('[agent] koneksi terputus, reconnect dalam', reconnectDelay, 'ms');
    clearInterval(metricTimer);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[agent] error koneksi:', err.message);
  });
}

function scheduleReconnect() {
  setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

function sendMetric() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
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
    }));
  } catch (err) {
    console.error('[agent] gagal kirim metric:', err.message);
  }
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
