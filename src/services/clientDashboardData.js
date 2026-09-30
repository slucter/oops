const db = require('../db');
const clientStore = require('./clientStore');
const alertEngine = require('./alertEngine');

const getLatestMetric = db.prepare(`
  SELECT received_at, mem_total_mb, mem_used_mb, disk_total_gb, disk_used_gb,
         load_1m, load_5m, load_15m, uptime_seconds, latency_ms
  FROM client_metrics
  WHERE client_id = ?
  ORDER BY received_at DESC
  LIMIT 1
`);

const METRIC_POINTS = 100;

const getMetricHistoryDesc = db.prepare(`
  SELECT received_at, mem_total_mb, mem_used_mb, load_1m, latency_ms
  FROM client_metrics
  WHERE client_id = ?
  ORDER BY received_at DESC
  LIMIT ?
`);

const getLatencyStats = db.prepare(`
  SELECT AVG(latency_ms) AS avg_ms, MIN(latency_ms) AS min_ms, MAX(latency_ms) AS max_ms
  FROM (
    SELECT latency_ms FROM client_metrics
    WHERE client_id = ? AND latency_ms IS NOT NULL
    ORDER BY received_at DESC LIMIT ?
  )
`);

const getHistory = db.prepare(`
  SELECT from_status, to_status, changed_at
  FROM status_history
  WHERE client_id = ?
  ORDER BY changed_at DESC
  LIMIT 20
`);

const getCommandResult = db.prepare(`
  SELECT command, requested_at, output, error_message
  FROM client_command_results
  WHERE client_id = ? AND command = ?
`);

function withMetricPercent(metric) {
  if (!metric) return null;
  const memPercent = metric.mem_total_mb
    ? Math.round((metric.mem_used_mb / metric.mem_total_mb) * 100)
    : null;
  const diskPercent = metric.disk_total_gb
    ? Math.round((metric.disk_used_gb / metric.disk_total_gb) * 100)
    : null;
  return { ...metric, memPercent, diskPercent };
}

function getDashboardClients() {
  const clients = clientStore.listClients();
  const grouped = {};
  for (const c of clients) {
    const groupName = c.groupName || 'Belum dikelompokkan';
    grouped[groupName] = grouped[groupName] || [];
    const alerts = alertEngine.getActiveForClient(c.id);
    grouped[groupName].push({
      ...c,
      metric: withMetricPercent(getLatestMetric.get(c.id)),
      alerts,
      worstSeverity: worstOf(alerts),
    });
  }
  return grouped;
}

/** Tingkat keparahan tertinggi dari daftar alert aktif. */
function worstOf(alerts) {
  if (!alerts || alerts.length === 0) return null;
  if (alerts.some((a) => a.severity === 'critical')) return 'critical';
  if (alerts.some((a) => a.severity === 'warning')) return 'warning';
  return 'info';
}

function getClientDetail(clientId) {
  const id = Number(clientId);
  const client = clientStore.getClientById(id);
  if (!client) return null;

  const stats = getLatencyStats.get(id, METRIC_POINTS) || {};

  return {
    ...client,
    metric: withMetricPercent(getLatestMetric.get(id)),
    metricHistory: getMetricHistoryDesc.all(id, METRIC_POINTS).reverse(),
    latencyStats: stats.avg_ms == null ? null : {
      avg: Math.round(stats.avg_ms),
      min: stats.min_ms,
      max: stats.max_ms,
    },
    history: getHistory.all(id),
    alerts: alertEngine.getActiveForClient(id),
    alertHistory: alertEngine.getRecentForClient(id),
    dockerResult: getCommandResult.get(id, 'docker_ps') || null,
    portResult: getCommandResult.get(id, 'port_listen') || null,
  };
}

module.exports = { getDashboardClients, getClientDetail };
