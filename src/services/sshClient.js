const fs = require('fs');
const { Client } = require('ssh2');
const { getServerById } = require('./serverConfig');

const CONNECT_TIMEOUT_MS = Number(process.env.SSH_CONNECT_TIMEOUT_MS || 8000);
const COMMAND_TIMEOUT_MS = Number(process.env.SSH_COMMAND_TIMEOUT_MS || 10000);

const keyCache = new Map();
function readKey(keyPath) {
  if (!keyCache.has(keyPath)) {
    keyCache.set(keyPath, fs.readFileSync(keyPath));
  }
  return keyCache.get(keyPath);
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

      const targetConn = await connectOverStream(server, stream);
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

  const conn = await connectDirect(server);
  return { conn, close: () => conn.end() };
}

function connectDirect(server) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error('Timeout saat koneksi SSH'));
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
        host: server.host,
        port: server.port,
        username: server.user,
        privateKey: readKey(server.sshKey),
        readyTimeout: CONNECT_TIMEOUT_MS,
      });
  });
}

function connectOverStream(server, stream) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error('Timeout saat koneksi SSH lewat jump host'));
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
        sock: stream,
        username: server.user,
        privateKey: readKey(server.sshKey),
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
