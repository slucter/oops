const { WebSocketServer } = require('ws');
const { URL } = require('url');
const clientStore = require('../services/clientStore');
const clientDataService = require('../services/clientDataService');
const { validateMetricPayload, validateCommandResultPayload, validateUpdateResultPayload } = require('../services/payloadValidator');

const MAX_MESSAGE_BYTES = 8 * 1024;
const STALE_THRESHOLD_SECONDS = Number(process.env.CLIENT_STALE_SECONDS || 90);
const STALE_CHECK_INTERVAL_MS = 15000;
const COMMAND_TIMEOUT_MS = 10000;
// Update melibatkan unduh berkas + npm install, jauh lebih lama daripada
// command biasa. Timeout pendek akan melaporkan gagal padahal update masih
// berjalan dan akan berhasil.
const UNINSTALL_TIMEOUT_MS = Number(process.env.AGENT_UNINSTALL_TIMEOUT_MS || 20000);
const UPDATE_TIMEOUT_MS = Number(process.env.AGENT_UPDATE_TIMEOUT_MS || 240000);
const PING_INTERVAL_MS = Number(process.env.CLIENT_PING_INTERVAL_MS || 15000);

// clientId -> WebSocket, hanya untuk client yang sedang terkoneksi.
const activeConnections = new Map();
// requestId -> { resolve, reject, timer }, permintaan command yang menunggu balasan.
const pendingCommands = new Map();
// requestId -> { resolve, reject, timer }, permintaan update yang menunggu balasan.
const pendingUpdates = new Map();
// requestId -> { resolve, timer }, permintaan uninstall yang menunggu balasan.
const pendingUninstalls = new Map();
// clientId -> latency RTT terakhir (ms) dari ping/pong WebSocket. Hanya di
// memori: nilainya ikut disimpan ke DB saat payload metrik berikutnya masuk,
// supaya tidak bikin baris/tabel sendiri untuk angka yang berubah terus.
const lastLatency = new Map();

function attach(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host}`);
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname !== '/agent') {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token');
    const client = token ? clientStore.getClientByToken(token) : null;
    if (!client) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, client);
    });
  });

  wss.on('connection', (ws, client) => {
    activeConnections.set(client.id, ws);
    console.log(`[ws] client "${client.name}" (id=${client.id}) terkoneksi`);

    // Ping/pong pakai frame bawaan protokol WebSocket (bukan pesan JSON
    // sendiri): library `ws` di sisi agent otomatis membalas pong tanpa
    // perlu kode tambahan, jadi RTT ini mengukur jalur jaringannya saja.
    ws.on('pong', () => {
      if (ws.pingSentAt) {
        lastLatency.set(client.id, Date.now() - ws.pingSentAt);
        ws.pingSentAt = null;
      }
    });

    sendPing(ws);
    const pingTimer = setInterval(() => sendPing(ws), PING_INTERVAL_MS);

    ws.on('message', (raw) => {
      if (raw.length > MAX_MESSAGE_BYTES) {
        ws.close(1009, 'payload too large');
        return;
      }
      handleMessage(client.id, raw);
    });

    ws.on('close', () => {
      // Tidak langsung tandai DOWN di sini — disconnect tidak selalu
      // sinyal jelas (bisa reconnect cepat). markStaleClientsDown() yang
      // memutuskan DOWN lewat timeout last_seen_at.
      clearInterval(pingTimer);
      activeConnections.delete(client.id);
      lastLatency.delete(client.id);

      // Agent yang sedang update akan memutus koneksi saat me-restart
      // dirinya. Itu justru tanda update berhasil — bukan kegagalan. Kalau
      // tidak diselesaikan di sini, promise-nya menggantung sampai timeout
      // 4 menit dan dashboard menampilkan "timeout" untuk update yang
      // sebenarnya sukses.
      for (const [id, pending] of pendingUpdates) {
        if (!id.startsWith(`${client.id}-update-`)) continue;
        clearTimeout(pending.timer);
        pendingUpdates.delete(id);
        pending.resolve({
          id,
          ok: true,
          message: 'Agent memutus koneksi untuk restart — tanda update diterapkan.',
          version: null,
        });
      }

      // Agent yang mencabut dirinya juga memutus koneksi. Sama seperti di
      // atas, itu tanda berhasil — bukan kegagalan yang perlu ditunggu
      // sampai timeout.
      for (const [id, pending] of pendingUninstalls) {
        if (!id.startsWith(`${client.id}-uninstall-`)) continue;
        clearTimeout(pending.timer);
        pendingUninstalls.delete(id);
        pending.resolve({ ok: true, message: 'Agent memutus koneksi — tanda pencabutan dijalankan.' });
      }
      console.log(`[ws] client "${client.name}" (id=${client.id}) terputus`);
    });

    ws.on('error', (err) => {
      console.error(`[ws] error dari client id=${client.id}:`, err.message);
    });
  });

  setInterval(() => {
    const n = clientDataService.markStaleClientsDown(STALE_THRESHOLD_SECONDS);
    if (n > 0) console.log(`[ws] ${n} client ditandai DOWN (tidak ada payload > ${STALE_THRESHOLD_SECONDS}s)`);
  }, STALE_CHECK_INTERVAL_MS);

  return wss;
}

function sendPing(ws) {
  if (ws.readyState !== ws.OPEN) return;
  ws.pingSentAt = Date.now();
  try {
    ws.ping();
  } catch {
    ws.pingSentAt = null;
  }
}

function handleMessage(clientId, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString('utf8'));
  } catch {
    return; // abaikan payload bukan JSON, jangan crash koneksi
  }

  if (msg.type === 'metric') {
    const result = validateMetricPayload(msg);
    if (!result.valid) {
      console.warn(`[ws] payload metric invalid dari client id=${clientId}: ${result.reason}`);
      return;
    }
    const latencyMs = lastLatency.has(clientId) ? lastLatency.get(clientId) : null;
    clientDataService.recordMetric(clientId, { ...result.data, latencyMs });
    return;
  }

  if (msg.type === 'command_result') {
    const result = validateCommandResultPayload(msg);
    if (!result.valid) {
      console.warn(`[ws] payload command_result invalid dari client id=${clientId}: ${result.reason}`);
      return;
    }
    clientDataService.recordCommandResult(clientId, result.data.command, {
      output: result.data.output,
      errorMessage: result.data.errorMessage,
    });
    const pending = pendingCommands.get(result.data.id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingCommands.delete(result.data.id);
      pending.resolve(result.data);
    }
    return;
  }

  if (msg.type === 'uninstall_result') {
    const pending = pendingUninstalls.get(msg.id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingUninstalls.delete(msg.id);
      pending.resolve({ ok: msg.ok !== false, message: typeof msg.message === 'string' ? msg.message.slice(0, 500) : null });
    }
    return;
  }

  if (msg.type === 'update_result') {
    const result = validateUpdateResultPayload(msg);
    if (!result.valid) {
      console.warn(`[ws] payload update_result invalid dari client id=${clientId}: ${result.reason}`);
      return;
    }
    const pending = pendingUpdates.get(result.data.id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingUpdates.delete(result.data.id);
      pending.resolve(result.data);
    }
    return;
  }
  // type tidak dikenal: diabaikan diam-diam, bukan error keras.
}

/**
 * Minta agent memperbarui dirinya sendiri.
 *
 * Timeout dibuat jauh lebih panjang daripada command biasa: agent harus
 * mengunduh beberapa berkas lalu menjalankan `npm install`, yang di koneksi
 * lambat bisa memakan waktu lama. Timeout pendek akan melaporkan gagal
 * padahal update sebenarnya sedang berjalan dan akan berhasil.
 */
function requestAgentUpdate(clientId) {
  const ws = activeConnections.get(clientId);
  if (!ws || ws.readyState !== ws.OPEN) {
    return Promise.reject(new Error('Client tidak sedang terkoneksi.'));
  }

  const id = `${clientId}-update-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingUpdates.delete(id);
      reject(new Error('Timeout menunggu balasan update dari client.'));
    }, UPDATE_TIMEOUT_MS);

    pendingUpdates.set(id, { resolve, reject, timer });
    try {
      ws.send(JSON.stringify({ type: 'update_agent', id }));
    } catch (err) {
      clearTimeout(timer);
      pendingUpdates.delete(id);
      reject(new Error(`Gagal mengirim perintah update: ${err.message}`));
    }
  });
}

/**
 * Minta agent client menjalankan command, tunggu balasan dengan timeout.
 * Melempar error kalau client sedang tidak terkoneksi atau timeout.
 */
function requestCommand(clientId, command) {
  const ws = activeConnections.get(clientId);
  if (!ws || ws.readyState !== ws.OPEN) {
    return Promise.reject(new Error('Client tidak sedang terkoneksi.'));
  }

  const id = `${clientId}-${command}-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(id);
      reject(new Error('Timeout menunggu balasan dari client.'));
    }, COMMAND_TIMEOUT_MS);

    pendingCommands.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ type: 'command', id, command }));
  });
}

/**
 * Minta agent mencabut dirinya dari server tempatnya berjalan.
 *
 * **Tidak pernah melempar.** Selalu mengembalikan { ok, message } supaya
 * pemanggil bisa tetap menghapus client walau uninstall gagal — client yang
 * tidak bisa dihapus dari dashboard hanya karena agent-nya offline adalah
 * kemunduran, bukan pengaman.
 *
 * Agent memutus koneksi begitu selesai mencabut diri, jadi putusnya koneksi
 * di sini dibaca sebagai sukses, bukan kegagalan.
 */
function requestUninstall(clientId) {
  const ws = activeConnections.get(clientId);
  if (!ws || ws.readyState !== ws.OPEN) {
    return Promise.resolve({ ok: false, offline: true, message: 'Client sedang tidak terkoneksi.' });
  }

  const id = `${clientId}-uninstall-${Date.now()}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingUninstalls.delete(id);
      resolve({ ok: false, message: 'Timeout menunggu balasan dari agent.' });
    }, UNINSTALL_TIMEOUT_MS);

    pendingUninstalls.set(id, { resolve, timer });
    try {
      ws.send(JSON.stringify({ type: 'uninstall_agent', id }));
    } catch (err) {
      clearTimeout(timer);
      pendingUninstalls.delete(id);
      resolve({ ok: false, message: `Gagal mengirim perintah: ${err.message}` });
    }
  });
}

function isClientConnected(clientId) {
  const ws = activeConnections.get(clientId);
  return !!ws && ws.readyState === ws.OPEN;
}

module.exports = { attach, requestCommand, requestAgentUpdate, requestUninstall, isClientConnected };
