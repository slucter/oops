const db = require('../db');

const insertMetric = db.prepare(`
  INSERT INTO client_metrics (
    client_id, mem_total_mb, mem_used_mb, disk_total_gb, disk_used_gb,
    load_1m, load_5m, load_15m, uptime_seconds
  )
  VALUES (
    @clientId, @memTotalMb, @memUsedMb, @diskTotalGb, @diskUsedGb,
    @load1m, @load5m, @load15m, @uptimeSeconds
  )
`);

const updateClientSeen = db.prepare(`
  UPDATE clients SET status = 'up', hostname = @hostname, last_seen_at = datetime('now')
  WHERE id = @id
`);

const getClientStatus = db.prepare('SELECT status FROM clients WHERE id = ?');

const insertStatusHistory = db.prepare(`
  INSERT INTO status_history (client_id, from_status, to_status) VALUES (?, ?, ?)
`);

const setClientStatus = db.prepare('UPDATE clients SET status = ? WHERE id = ?');

const upsertCommandResult = db.prepare(`
  INSERT INTO client_command_results (client_id, command, output, error_message)
  VALUES (@clientId, @command, @output, @errorMessage)
  ON CONFLICT (client_id, command) DO UPDATE SET
    requested_at = datetime('now'), output = @output, error_message = @errorMessage
`);

function recordStatusChange(clientId, newStatus) {
  const current = getClientStatus.get(clientId);
  const oldStatus = current ? current.status : null;
  if (oldStatus === newStatus) return;
  insertStatusHistory.run(clientId, oldStatus, newStatus);
}

/**
 * Simpan payload metrik dari agent, tandai client UP, catat perubahan
 * status kalau sebelumnya bukan UP (mis. baru pertama kali connect, atau
 * baru pulih dari DOWN).
 */
function recordMetric(clientId, payload) {
  recordStatusChange(clientId, 'up');
  updateClientSeen.run({ id: clientId, hostname: payload.hostname || null });
  insertMetric.run({
    clientId,
    memTotalMb: payload.memTotalMb,
    memUsedMb: payload.memUsedMb,
    diskTotalGb: payload.diskTotalGb,
    diskUsedGb: payload.diskUsedGb,
    load1m: payload.load1m,
    load5m: payload.load5m,
    load15m: payload.load15m,
    uptimeSeconds: payload.uptimeSeconds,
  });
}

/** Simpan/replace hasil command on-demand (docker_ps / port_listen). */
function recordCommandResult(clientId, command, { output, errorMessage }) {
  upsertCommandResult.run({ clientId, command, output: output || null, errorMessage: errorMessage || null });
}

const findStaleUpClients = db.prepare(`
  SELECT id FROM clients
  WHERE status = 'up'
    AND (last_seen_at IS NULL OR last_seen_at < datetime('now', @cutoff))
`);

/**
 * Tandai client DOWN kalau tidak ada payload baru dalam ambang waktu
 * tertentu. Dipanggil berkala oleh timer server (bukan reaktif ke event
 * WebSocket close, karena disconnect tidak selalu terkirim bersih).
 */
function markStaleClientsDown(thresholdSeconds) {
  const cutoff = `-${thresholdSeconds} seconds`;
  const stale = findStaleUpClients.all({ cutoff });
  for (const row of stale) {
    recordStatusChange(row.id, 'down');
    setClientStatus.run('down', row.id);
  }
  return stale.length;
}

module.exports = { recordMetric, recordCommandResult, markStaleClientsDown };
