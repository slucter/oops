const db = require('../db');
const { listServers, getServerById } = require('./serverStore');

const getLatestCheck = db.prepare(`
  SELECT status, checked_at, latency_ms, error_message
  FROM check_results
  WHERE server_id = ?
  ORDER BY checked_at DESC
  LIMIT 1
`);

const getLatestDockerSnapshot = db.prepare(`
  SELECT raw_output, error_message, checked_at
  FROM docker_snapshots
  WHERE server_id = ?
  ORDER BY checked_at DESC
  LIMIT 1
`);

const getLatestPortSnapshot = db.prepare(`
  SELECT raw_output, error_message, checked_at
  FROM port_snapshots
  WHERE server_id = ?
  ORDER BY checked_at DESC
  LIMIT 1
`);

const getHistory = db.prepare(`
  SELECT from_status, to_status, changed_at
  FROM status_history
  WHERE server_id = ?
  ORDER BY changed_at DESC
  LIMIT 20
`);

function getDashboardServers() {
  const servers = listServers();
  const byId = new Map(servers.map((s) => [s.id, s]));
  return servers.map((s) => ({
    ...s,
    viaName: s.via != null ? (byId.get(s.via) || {}).name || null : null,
    lastCheck: getLatestCheck.get(s.id) || null,
  }));
}

function getServerDetail(serverId) {
  const id = Number(serverId);
  const server = getServerById(id);
  if (!server) return null;

  const viaServer = server.via != null ? getServerById(server.via) : null;

  return {
    ...server,
    viaName: viaServer ? viaServer.name : null,
    lastCheck: getLatestCheck.get(id) || null,
    docker: getLatestDockerSnapshot.get(id) || null,
    ports: getLatestPortSnapshot.get(id) || null,
    history: getHistory.all(id),
  };
}

module.exports = { getDashboardServers, getServerDetail };
