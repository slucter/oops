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

const getLatestResourceSnapshot = db.prepare(`
  SELECT mem_total_mb, mem_used_mb, disk_total_gb, disk_used_gb,
         load_1m, load_5m, load_15m, uptime_text, cpu_count,
         error_message, checked_at
  FROM resource_snapshots
  WHERE server_id = ?
  ORDER BY checked_at DESC
  LIMIT 1
`);

const RESOURCE_POINTS = 100;

const getResourceHistoryDesc = db.prepare(`
  SELECT checked_at, mem_total_mb, mem_used_mb, load_1m, cpu_count
  FROM resource_snapshots
  WHERE server_id = ? AND error_message IS NULL
  ORDER BY checked_at DESC
  LIMIT ?
`);

const LATENCY_POINTS = 100;

const getLatencyHistoryDesc = db.prepare(`
  SELECT checked_at, status, latency_ms
  FROM check_results
  WHERE server_id = ?
  ORDER BY checked_at DESC
  LIMIT ?
`);

function withResourcePercent(snapshot) {
  if (!snapshot) return null;
  const memPercent = snapshot.mem_total_mb
    ? Math.round((snapshot.mem_used_mb / snapshot.mem_total_mb) * 100)
    : null;
  const diskPercent = snapshot.disk_total_gb
    ? Math.round((snapshot.disk_used_gb / snapshot.disk_total_gb) * 100)
    : null;
  return { ...snapshot, memPercent, diskPercent };
}

function getDashboardServers() {
  const servers = listServers();
  const byId = new Map(servers.map((s) => [s.id, s]));
  const withData = servers.map((s) => ({
    ...s,
    viaName: s.via != null ? (byId.get(s.via) || {}).name || null : null,
    lastCheck: getLatestCheck.get(s.id) || null,
    resources: withResourcePercent(getLatestResourceSnapshot.get(s.id)),
  }));
  return sortAsTree(withData);
}

/**
 * Urutkan server jadi bentuk pohon: server yang jadi jump host (root)
 * muncul duluan, lalu server yang `via`-nya menunjuk ke dia langsung
 * menyusul di bawahnya (rekursif untuk jump host berlapis), dengan
 * `depth` untuk indentasi visual. Server root diurutkan alfabetis by
 * nama; anak-anak dari root yang sama juga alfabetis.
 */
function sortAsTree(servers) {
  const byId = new Map(servers.map((s) => [s.id, s]));
  const childrenOf = new Map();
  for (const s of servers) {
    if (s.via != null && byId.has(s.via)) {
      if (!childrenOf.has(s.via)) childrenOf.set(s.via, []);
      childrenOf.get(s.via).push(s);
    }
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const roots = servers
    .filter((s) => s.via == null || !byId.has(s.via))
    .sort((a, b) => a.name.localeCompare(b.name));

  const result = [];
  const visited = new Set();

  function visit(server, depth) {
    if (visited.has(server.id)) return; // jaga-jaga kalau ada siklus data lama
    visited.add(server.id);
    result.push({ ...server, depth });
    for (const child of childrenOf.get(server.id) || []) {
      visit(child, depth + 1);
    }
  }

  for (const root of roots) {
    visit(root, 0);
  }

  return result;
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
    latencyHistory: getLatencyHistoryDesc.all(id, LATENCY_POINTS).reverse(),
    resources: withResourcePercent(getLatestResourceSnapshot.get(id)),
    resourceHistory: getResourceHistoryDesc.all(id, RESOURCE_POINTS).reverse(),
  };
}

module.exports = { getDashboardServers, getServerDetail };
