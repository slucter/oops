const db = require('../db');
const { connect, execCommand } = require('./sshClient');
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
 * Cek satu server: UP kalau berhasil connect SSH, UNREACHABLE kalau jump
 * host-nya sendiri yang gagal (bukan berarti server ini mati), DOWN kalau
 * server ini sendiri menolak koneksi/timeout.
 *
 * Balikan termasuk `conn`/`close` kalau berhasil, supaya pemanggil bisa
 * reuse koneksi yang sama untuk collectServerInfo tanpa handshake SSH
 * kedua (lebih cepat, lebih kecil peluang timeout).
 */
async function checkServer(server) {
  const startedAt = Date.now();
  try {
    const { conn, close } = await connect(server);
    const latencyMs = Date.now() - startedAt;
    recordResult(server.id, 'up', latencyMs, null);
    return { status: 'up', latencyMs, conn, close };
  } catch (err) {
    const status = server.via && isJumpHostFailure(err) ? 'unreachable' : 'down';
    recordResult(server.id, status, null, err.message);
    return { status, error: err.message };
  }
}

function isJumpHostFailure(err) {
  return /jump host/i.test(err.message);
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
 * Jalankan docker ps -a dan sudo ss -tulnp lewat koneksi SSH yang sudah
 * terbuka (hasil checkServer), supaya tidak perlu handshake SSH kedua.
 */
async function collectServerInfo(server, conn) {
  const portResult = await execCommand(conn, 'sudo ss -tulnp');
  savePortSnapshot(server.id, portResult);

  if (server.hasDocker) {
    const dockerResult = await execCommand(conn, 'docker ps -a');
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
