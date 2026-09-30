const fs = require('fs');
const { Client } = require('ssh2');
const { getServerById } = require('./serverStore');
const { keysToTryForHost } = require('./sshKeyDiscovery');

const CONNECT_TIMEOUT_MS = Number(process.env.SSH_CONNECT_TIMEOUT_MS || 8000);
const COMMAND_TIMEOUT_MS = Number(process.env.SSH_COMMAND_TIMEOUT_MS || 10000);

// Key mana yang terakhir berhasil untuk sebuah host, supaya polling
// berikutnya tidak perlu coba-coba ulang semua key dari awal.
// Key: `${host}:${port}:${user}`. Direset saat proses app restart.
const workingKeyCache = new Map();

function readKey(keyPath) {
  return fs.readFileSync(keyPath);
}

function cacheKeyFor(server, keyPath) {
  workingKeyCache.set(`${server.host}:${server.port}:${server.user}`, keyPath);
}

function orderedKeysFor(server) {
  const cached = workingKeyCache.get(`${server.host}:${server.port}:${server.user}`);
  const all = keysToTryForHost(server.host);
  if (cached && all.includes(cached)) {
    return [cached, ...all.filter((k) => k !== cached)];
  }
  return all;
}

/**
 * Buka koneksi SSH ke sebuah server. Kalau server punya `via`, koneksi
 * dibuka dulu ke jump host-nya lalu di-forward (netTunnel) ke target —
 * setara `ssh -J`, tanpa shell interaktif berantai.
 * Balikan: { conn, close } — pemanggil wajib panggil close() setelah selesai.
 */
async function connect(server) {
  if (server.via) {
    const jumpServer = getServerById(server.via);
    if (!jumpServer) {
      throw new Error(`Jump host "${server.via}" untuk server "${server.id}" tidak ditemukan.`);
    }
    const { conn: jumpConn, close: closeJump } = await connect(jumpServer);

    try {
      const stream = await new Promise((resolve, reject) => {
        jumpConn.forwardOut('127.0.0.1', 0, server.host, server.port, (err, stream) => {
          if (err) reject(err);
          else resolve(stream);
        });
      });

      const targetConn = await connectWithKeyDiscovery(server, { sock: stream });
      return {
        conn: targetConn,
        close: () => {
          targetConn.end();
          closeJump();
        },
      };
    } catch (err) {
      closeJump();
      throw err;
    }
  }

  const conn = await connectWithKeyDiscovery(server, { host: server.host, port: server.port });
  return { conn, close: () => conn.end() };
}

/**
 * Coba tiap key kandidat dari ~/.ssh/ satu per satu sampai ada yang
 * berhasil autentikasi. Kegagalan koneksi TCP (host mati/timeout) dilempar
 * langsung tanpa mencoba key lain — itu bukan masalah key.
 */
async function connectWithKeyDiscovery(server, targetOpts) {
  const keys = orderedKeysFor(server);
  if (keys.length === 0) {
    throw new Error(`Tidak ada private key ditemukan di ~/.ssh/ untuk mencoba koneksi ke ${server.host}.`);
  }

  let lastAuthError = null;
  const triedNames = [];

  for (const keyPath of keys) {
    try {
      const conn = await attemptConnect(targetOpts, server.user, readKey(keyPath));
      cacheKeyFor(server, keyPath);
      return conn;
    } catch (err) {
      if (err.level === 'client-timeout' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'EHOSTUNREACH') {
        throw err;
      }
      triedNames.push(keyPath.split(/[\\/]/).pop());
      lastAuthError = err;
    }
  }

  throw new Error(
    `Autentikasi gagal untuk ${server.user}@${server.host} setelah mencoba ${keys.length} key ` +
    `(${triedNames.join(', ')}). Error terakhir: ${lastAuthError ? lastAuthError.message : 'tidak diketahui'}`
  );
}

function attemptConnect(targetOpts, username, privateKey) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      conn.end();
      const err = new Error('Timeout saat koneksi SSH');
      err.level = 'client-timeout';
      reject(err);
    }, CONNECT_TIMEOUT_MS);

    conn
      .on('ready', () => {
        clearTimeout(timer);
        resolve(conn);
      })
      .on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      })
      .connect({
        ...targetOpts,
        username,
        privateKey,
        readyTimeout: CONNECT_TIMEOUT_MS,
      });
  });
}

function execCommand(conn, command) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout menjalankan command: ${command}`));
    }, COMMAND_TIMEOUT_MS);

    conn.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        return reject(err);
      }
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        })
        .on('data', (data) => {
          stdout += data.toString();
        })
        .stderr.on('data', (data) => {
          stderr += data.toString();
        });
    });
  });
}

module.exports = { connect, execCommand };
