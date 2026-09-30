const { WebSocketServer } = require('ws');
const { URL } = require('url');
const clientStore = require('../services/clientStore');
const clientDataService = require('../services/clientDataService');
const { validateMetricPayload, validateCommandResultPayload } = require('../services/payloadValidator');

const MAX_MESSAGE_BYTES = 8 * 1024;
const STALE_THRESHOLD_SECONDS = Number(process.env.CLIENT_STALE_SECONDS || 90);
const STALE_CHECK_INTERVAL_MS = 15000;
const COMMAND_TIMEOUT_MS = 10000;

// clientId -> WebSocket, hanya untuk client yang sedang terkoneksi.
const activeConnections = new Map();
// requestId -> { resolve, reject, timer }, permintaan command yang menunggu balasan.
const pendingCommands = new Map();

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
      activeConnections.delete(client.id);
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
    clientDataService.recordMetric(clientId, result.data);
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
  // type tidak dikenal: diabaikan diam-diam, bukan error keras.
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

function isClientConnected(clientId) {
  const ws = activeConnections.get(clientId);
  return !!ws && ws.readyState === ws.OPEN;
}

module.exports = { attach, requestCommand, isClientConnected };
