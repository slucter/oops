const db = require('../db');
const { connect, execCommand, JumpHostUnreachableError } = require('./sshClient');
const { getServerById } = require('./serverStore');

const insertCheckResult = db.prepare(`
  INSERT INTO check_results (server_id, status, latency_ms, error_message)
  VALUES (@serverId, @status, @latencyMs, @errorMessage)
`);

const getLastStatus = db.prepare(`
  SELECT status FROM check_results
  WHERE server_id = ?
  ORDER BY checked_at DESC
  LIMIT 1 OFFSET 1
`);

const insertStatusHistory = db.prepare(`
  INSERT INTO status_history (server_id, from_status, to_status)
  VALUES (@serverId, @fromStatus, @toStatus)
`);

/**
 * Cek satu server: UP kalau berhasil connect (atau, untuk server dengan
 * `via`, berhasil di-probe lewat jump host), UNREACHABLE kalau jump
 * host-nya sendiri yang gagal (bukan berarti server ini mati), DOWN kalau
 * server ini sendiri menolak koneksi/timeout/auth.
 *
 * Balikan termasuk handle koneksi kalau berhasil, supaya pemanggil bisa
 * reuse untuk collectServerInfo tanpa handshake SSH kedua.
 */
async function checkServer(server) {
  const startedAt = Date.now();
  try {
    const handle = await connect(server);
    const latencyMs = Date.now() - startedAt;
    recordResult(server.id, 'up', latencyMs, null);
    return { status: 'up', latencyMs, handle };
  } catch (err) {
    const status = err instanceof JumpHostUnreachableError ? 'unreachable' : 'down';
    recordResult(server.id, status, null, err.message);
    return { status, error: err.message };
  }
}

function recordResult(serverId, status, latencyMs, errorMessage) {
  insertCheckResult.run({ serverId, status, latencyMs, errorMessage });

  const prev = getLastStatus.get(serverId);
  const prevStatus = prev ? prev.status : null;
  if (prevStatus !== status) {
    insertStatusHistory.run({ serverId, fromStatus: prevStatus, toStatus: status });
  }
}

/**
 * Jalankan docker ps -a dan ss -tulnp lewat handle koneksi yang sudah ada
 * (hasil checkServer), supaya tidak perlu koneksi/probe kedua. Untuk
 * server dengan `via`, execCommand otomatis menjalankan command ini
 * lewat `ssh` di dalam shell jump host (lihat sshClient.js).
 *
 * ss dijalankan TANPA sudo dengan sengaja: untuk kebutuhan monitoring
 * (server hidup, port apa yang kebuka), itu cukup — nama proses/PID
 * untuk service yang jalan sebagai root memang tidak akan terlihat,
 * tapi port dan statusnya tetap ada. Ini menghindari kebutuhan setup
 * sudoers NOPASSWD di tiap server target.
 */
async function collectServerInfo(server, handle) {
  const portResult = await execCommand(handle, 'ss -tulnp');
  savePortSnapshot(server.id, portResult);

  // Docker dideteksi otomatis, bukan lewat konfigurasi manual: exit code
  // 127 dari shell berarti command "docker" tidak ditemukan sama sekali
  // (server tidak punya Docker) — dalam kasus itu snapshot tidak disimpan
  // supaya halaman detail tidak menampilkan section Docker sama sekali.
  // Kegagalan lain (mis. daemon mati, permission denied) tetap disimpan
  // sebagai error, karena itu berarti Docker ADA tapi bermasalah.
  const dockerResult = await execCommand(handle, 'docker ps -a');
  if (dockerResult.code !== 127) {
    saveDockerSnapshot(server.id, dockerResult);
  }
}

const insertPortSnapshot = db.prepare(`
  INSERT INTO port_snapshots (server_id, raw_output, error_message)
  VALUES (@serverId, @rawOutput, @errorMessage)
`);

const insertDockerSnapshot = db.prepare(`
  INSERT INTO docker_snapshots (server_id, raw_output, error_message)
  VALUES (@serverId, @rawOutput, @errorMessage)
`);

function savePortSnapshot(serverId, result) {
  if (result.code === 0) {
    insertPortSnapshot.run({ serverId, rawOutput: result.stdout, errorMessage: null });
  } else {
    insertPortSnapshot.run({ serverId, rawOutput: null, errorMessage: result.stderr || `exit code ${result.code}` });
  }
}

function saveDockerSnapshot(serverId, result) {
  if (result.code === 0) {
    insertDockerSnapshot.run({ serverId, rawOutput: result.stdout, errorMessage: null });
  } else {
    insertDockerSnapshot.run({ serverId, rawOutput: null, errorMessage: result.stderr || `exit code ${result.code}` });
  }
}

module.exports = { checkServer, collectServerInfo, getServerById };
