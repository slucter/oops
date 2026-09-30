const fs = require('fs');
const { Client } = require('ssh2');
const { getServerById } = require('./serverStore');
const { keysToTryForHost } = require('./sshKeyDiscovery');

const CONNECT_TIMEOUT_MS = Number(process.env.SSH_CONNECT_TIMEOUT_MS || 8000);
const COMMAND_TIMEOUT_MS = Number(process.env.SSH_COMMAND_TIMEOUT_MS || 10000);

/** Jump host itu sendiri yang tidak terjangkau — beda dari target di baliknya yang down. */
class JumpHostUnreachableError extends Error {}

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
 * Buka koneksi ke sebuah server untuk keperluan cek status/exec command.
 *
 * Server tanpa `via`: koneksi SSH langsung, auto-discovery key dari
 * ~/.ssh/. Balikan `{ conn, close, execRemote }` — `execRemote` menjalankan
 * command langsung di server ini.
 *
 * Server dengan `via`: banyak setup nyata menyimpan private key untuk
 * server internal DI DALAM jump host itu sendiri (bukan di mesin tempat
 * app berjalan) — sama seperti cara kerja SSH manual: SSH ke bastion,
 * lalu DARI DALAM bastion baru SSH lagi ke target pakai key yang cuma
 * ada di situ. Karena itu, alih-alih ProxyJump murni (forward + auth
 * ulang dari app), pendekatannya adalah connect ke jump host seperti
 * biasa, lalu jalankan command `ssh <target> -- <command>` DI DALAM
 * shell jump host itu. Status UP/DOWN diperiksa lewat exit code `ssh ...
 * true` yang dijalankan di jump host.
 */
async function connect(server) {
  if (server.via) {
    const jumpServer = getServerById(server.via);
    if (!jumpServer) {
      throw new Error(`Jump host "${server.via}" untuk server "${server.id}" tidak ditemukan.`);
    }

    let jump;
    try {
      jump = await connect(jumpServer);
    } catch (err) {
      throw new JumpHostUnreachableError(`Jump host "${jumpServer.name}" tidak bisa dihubungi: ${err.message}`);
    }

    const probe = await jump.execRemoteVia(server, 'true');
    if (probe.code !== 0) {
      jump.close();
      throw new Error(
        `Tidak bisa SSH ke ${server.user}@${server.host}:${server.port} dari jump host "${jumpServer.name}": ` +
        (probe.stderr || `exit code ${probe.code}`)
      );
    }

    return {
      conn: null,
      close: jump.close,
      execRemote: (command) => jump.execRemoteVia(server, command),
    };
  }

  const conn = await connectWithKeyDiscovery({ host: server.host, port: server.port }, server);
  return {
    conn,
    close: () => conn.end(),
    execRemote: (command) => execOnConn(conn, command),
    execRemoteVia: (targetServer, command) => execOnConn(conn, buildRemoteSshCommand(targetServer, command)),
  };
}

/**
 * Bangun command `ssh` yang dijalankan di jump host untuk mengeksekusi
 * `command` di `targetServer`. BatchMode supaya tidak pernah nunggu
 * prompt password (auth harus lewat key yang sudah ada di jump host),
 * StrictHostKeyChecking=accept-new supaya tidak macet di prompt host key
 * pertama kali (app jalan unattended).
 */
function buildRemoteSshCommand(targetServer, command) {
  const target = `${shellQuote(targetServer.user)}@${shellQuote(targetServer.host)}`;
  return [
    'ssh',
    '-o BatchMode=yes',
    '-o StrictHostKeyChecking=accept-new',
    `-o ConnectTimeout=${Math.ceil(CONNECT_TIMEOUT_MS / 1000)}`,
    `-p ${Number(targetServer.port) || 22}`,
    target,
    '--',
    command,
  ].join(' ');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Coba tiap key kandidat dari ~/.ssh/ satu per satu sampai ada yang
 * berhasil autentikasi. Kegagalan koneksi TCP (host mati/timeout) dilempar
 * langsung tanpa mencoba key lain — itu bukan masalah key.
 */
async function connectWithKeyDiscovery(targetOpts, server) {
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

function execOnConn(conn, command) {
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

/** Dipanggil pemanggil eksternal sebagai execCommand(handle, command). */
function execCommand(handle, command) {
  return handle.execRemote(command);
}

module.exports = { connect, execCommand, JumpHostUnreachableError };
