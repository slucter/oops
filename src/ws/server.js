const { WebSocketServer } = require('ws');
const { URL } = require('url');
const clientStore = require('../services/clientStore');
const clientDataService = require('../services/clientDataService');
const { validateMetricPayload, validateCommandResultPayload, validateUpdateResultPayload } = require('../services/payloadValidator');

// Batas ukuran pesan dari agent.
//
// Metrik dan balasan biasa hanya beberapa ratus byte, tapi dua jenis pesan
// jauh lebih besar dan batasnya harus memuat keduanya:
//   - hasil optimasi : ~17 KB pada batas validator (30 langkah)
//   - hasil pemetaan : ~130 KB pada batas validator (400 folder + 50 file,
//                      path sampai 300 char). Kasus nyata di KST Lab: 5 KB.
//
// Batas yang terlalu ketat memutus agent yang jujur di tengah pelaporan —
// pernah terjadi saat batasnya 8 KB. 256 KB memberi ruang cukup sambil tetap
// membatasi pemakaian memori, dan validator memotong isinya setelah itu.
const MAX_MESSAGE_BYTES = 256 * 1024;
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
// requestId -> { resolve, onProgress, timer, ... }, optimasi yang menunggu balasan.
const pendingOptimize = new Map();
// requestId -> { resolve, onProgress, timer, ... }, pemetaan yang menunggu balasan.
const pendingPeta = new Map();
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

      // Optimasi dan pemetaan: BERBEDA dari update dan uninstall di atas.
      // Di sana putusnya koneksi adalah tanda berhasil (agent memang
      // me-restart dirinya). Di sini agent tidak seharusnya putus — kalau
      // terjadi, pekerjaannya benar-benar terhenti di tengah.
      //
      // Tanpa pembersihan ini, permintaannya menggantung sampai timeout 15
      // menit sementara dashboard menampilkan "memulai…" tanpa perubahan.
      // Persis itu yang terjadi saat agent di-restart oleh Update semua
      // beberapa saat setelah optimasi dimulai.
      for (const [id, pending] of pendingOptimize) {
        if (!id.startsWith(`${client.id}-opt-`)) continue;
        clearTimeout(pending.timer);
        pendingOptimize.delete(id);
        pending.resolve({
          ok: false,
          pesan: 'Agent terputus di tengah optimasi (mungkin restart). Coba lagi setelah client tersambung.',
        });
      }

      for (const [id, pending] of pendingPeta) {
        if (!id.startsWith(`${client.id}-peta-`)) continue;
        clearTimeout(pending.timer);
        pendingPeta.delete(id);
        pending.resolve({
          ok: false,
          pesan: 'Agent terputus di tengah pemindaian (mungkin restart). Coba lagi setelah client tersambung.',
        });
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

  if (msg.type === 'peta_progress') {
    const p = pendingPeta.get(msg.id);
    if (p && p.onProgress) {
      clearTimeout(p.timer);
      p.timer = setTimeout(p.onTimeout, p.timeoutMs);
      try {
        p.onProgress({ tahap: typeof msg.tahap === 'string' ? msg.tahap.slice(0, 120) : null });
      } catch {
        // kabar kemajuan tidak boleh menjatuhkan koneksi
      }
    }
    return;
  }

  if (msg.type === 'peta_result') {
    const p = pendingPeta.get(msg.id);
    if (p) {
      clearTimeout(p.timer);
      pendingPeta.delete(msg.id);
      p.resolve(validatePetaResult(msg));
    }
    return;
  }

  if (msg.type === 'optimize_progress') {
    const p = pendingOptimize.get(msg.id);
    if (p && p.onProgress) {
      // Tiap kabar kemajuan memperpanjang timeout: selama agent masih
      // melapor, ia jelas masih bekerja. Tanpa ini, langkah tunggal yang
      // lama (journal 3.5GB) bisa menembus batas waktu meski sehat.
      clearTimeout(p.timer);
      p.timer = setTimeout(p.onTimeout, p.timeoutMs);
      try {
        p.onProgress({ nomor: Number(msg.nomor) || 0, total: Number(msg.total) || 0, nama: typeof msg.nama === 'string' ? msg.nama.slice(0, 120) : null });
      } catch {
        // kabar kemajuan tidak boleh menjatuhkan koneksi
      }
    }
    return;
  }

  if (msg.type === 'optimize_result') {
    const p = pendingOptimize.get(msg.id);
    if (p) {
      clearTimeout(p.timer);
      pendingOptimize.delete(msg.id);
      p.resolve(validateOptimizeResult(msg));
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

/**
 * Minta agent menjalankan optimasi.
 *
 * **Tidak pernah melempar** untuk kegagalan yang wajar — selalu mengembalikan
 * { ok, ... } supaya satu client bermasalah tidak menghentikan job untuk
 * client lain.
 *
 * `onProgress` dipanggil tiap agent melapor, dan tiap laporan memperpanjang
 * timeout. Optimasi bisa memakan belasan menit di server dengan journal atau
 * cache docker besar.
 */
function requestOptimize(clientId, sertakanDocker, onProgress, timeoutMs) {
  const ws = activeConnections.get(clientId);
  if (!ws || ws.readyState !== ws.OPEN) {
    return Promise.resolve({ ok: false, pesan: 'Client tidak sedang terkoneksi.' });
  }

  const id = `${clientId}-opt-${Date.now()}`;
  const batas = Number(timeoutMs) || 15 * 60 * 1000;

  return new Promise((resolve) => {
    const onTimeout = () => {
      pendingOptimize.delete(id);
      resolve({ ok: false, pesan: 'Agent berhenti melapor — optimasi mungkin masih berjalan di server itu.' });
    };
    const entry = {
      resolve,
      onProgress,
      onTimeout,
      timeoutMs: batas,
      timer: setTimeout(onTimeout, batas),
    };
    pendingOptimize.set(id, entry);

    try {
      ws.send(JSON.stringify({ type: 'optimize', id, docker: !!sertakanDocker }));
    } catch (err) {
      clearTimeout(entry.timer);
      pendingOptimize.delete(id);
      resolve({ ok: false, pesan: `Gagal mengirim perintah: ${err.message}` });
    }
  });
}

/**
 * Bersihkan hasil optimasi dari agent sebelum dipakai.
 *
 * Isinya datang dari kode yang berjalan di mesin lain dan akan ditampilkan di
 * dashboard, jadi tipe dan panjangnya dibatasi di sini — bukan dipercaya
 * apa adanya.
 */
function validateOptimizeResult(msg) {
  const angka = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const teks = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

  return {
    ok: msg.ok !== false,
    pesan: teks(msg.pesan, 500),
    hematBytes: angka(msg.hematBytes),
    butuhSudo: !!msg.butuhSudo,
    dockerTersedia: !!msg.dockerTersedia,
    memTotalMb: angka(msg.memTotalMb),
    memTersediaMb: angka(msg.memTersediaMb),
    memCacheMb: angka(msg.memCacheMb),
    langkah: Array.isArray(msg.langkah)
      ? msg.langkah.slice(0, 30).map((l) => ({
        nama: teks(l && l.nama, 120) || '(tanpa nama)',
        ok: !!(l && l.ok),
        pesan: teks(l && l.pesan, 300),
      }))
      : [],
    dilewati: Array.isArray(msg.dilewati)
      ? msg.dilewati.slice(0, 30).map((d) => teks(d, 120)).filter(Boolean)
      : [],
  };
}

/**
 * Minta agent memetakan pemakaian disknya.
 *
 * Timeout panjang dan diperpanjang tiap kabar kemajuan: `du` seluruh disk
 * bisa memakan menit di server dengan jutaan file.
 */
function requestPeta(clientId, onProgress, timeoutMs) {
  const ws = activeConnections.get(clientId);
  if (!ws || ws.readyState !== ws.OPEN) {
    return Promise.resolve({ ok: false, pesan: 'Client tidak sedang terkoneksi.' });
  }

  const id = `${clientId}-peta-${Date.now()}`;
  const batas = Number(timeoutMs) || 20 * 60 * 1000;

  return new Promise((resolve) => {
    const onTimeout = () => {
      pendingPeta.delete(id);
      resolve({ ok: false, pesan: 'Agent berhenti melapor — pemindaian mungkin masih berjalan di server itu.' });
    };
    const entry = { resolve, onProgress, onTimeout, timeoutMs: batas, timer: setTimeout(onTimeout, batas) };
    pendingPeta.set(id, entry);
    try {
      ws.send(JSON.stringify({ type: 'peta_disk', id }));
    } catch (err) {
      clearTimeout(entry.timer);
      pendingPeta.delete(id);
      resolve({ ok: false, pesan: `Gagal mengirim perintah: ${err.message}` });
    }
  });
}

/**
 * Bersihkan hasil pemetaan dari agent.
 *
 * Path dibatasi panjangnya dan jumlah barisnya dibatasi keras: isinya datang
 * dari mesin lain dan akan dirender di dashboard.
 */
function validatePetaResult(msg) {
  const angka = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const teks = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

  const baris = (arr, maks) => (Array.isArray(arr) ? arr.slice(0, maks) : [])
    .map((f) => ({
      path: teks(f && f.path, 300),
      kb: angka(f && f.kb),
      level: angka(f && f.level) || 0,
    }))
    .filter((f) => f.path && f.kb != null);

  return {
    ok: msg.ok !== false,
    pesan: teks(msg.pesan, 500),
    root: teks(msg.root, 200) || '/',
    totalKb: angka(msg.totalKb),
    ambangKb: angka(msg.ambangKb),
    terpotong: !!msg.terpotong,
    folder: baris(msg.folder, 400),
    file: baris(msg.file, 50),
    catatan: Array.isArray(msg.catatan)
      ? msg.catatan.slice(0, 10).map((c) => teks(c, 200)).filter(Boolean)
      : [],
  };
}

function isClientConnected(clientId) {
  const ws = activeConnections.get(clientId);
  return !!ws && ws.readyState === ws.OPEN;
}

module.exports = { attach, requestCommand, requestAgentUpdate, requestUninstall, requestOptimize, requestPeta, isClientConnected };
