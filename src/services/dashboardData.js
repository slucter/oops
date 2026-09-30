const db = require('../db');
const { loadServers } = require('./serverConfig');

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
  const servers = loadServers();
  return servers.map((s) => ({
    ...s,
    lastCheck: getLatestCheck.get(s.id) || null,
  }));
}

function getServerDetail(serverId) {
  const server = loadServers().find((s) => s.id === serverId);
  if (!server) return null;

  return {
    ...server,
    lastCheck: getLatestCheck.get(serverId) || null,
    docker: getLatestDockerSnapshot.get(serverId) || null,
    ports: getLatestPortSnapshot.get(serverId) || null,
    history: getHistory.all(serverId),
  };
}

module.exports = { getDashboardServers, getServerDetail };
