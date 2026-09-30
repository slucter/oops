const express = require('express');
const { getDashboardClients, getClientDetail } = require('../services/clientDashboardData');
const { LATEST_AGENT_VERSION } = require('../services/agentVersion');

const router = express.Router();

function formatUptime(seconds) {
  if (seconds == null) return '-';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}h`);
  if (hours > 0) parts.push(`${hours}j`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

router.get('/', (req, res) => {
  const grouped = getDashboardClients();
  res.render('dashboard', {
    grouped,
    username: req.session.username,
    latestAgentVersion: LATEST_AGENT_VERSION,
    dihapus: typeof req.query.dihapus === 'string' ? req.query.dihapus.slice(0, 80) : null,
    adaSisa: req.query.sisa === '1',
  });
});

router.get('/client/:id', (req, res) => {
  const detail = getClientDetail(req.params.id);
  if (!detail) return res.status(404).render('not-found', { id: req.params.id });
  // Locals bernama "client" bentrok dengan opsi reserved EJS (opts.client) —
  // pakai "item" sebagai nama locals view.
  res.render('client-detail', { item: detail, username: req.session.username, formatUptime });
});

/**
 * Data live untuk halaman detail: dipanggil berkala oleh browser supaya
 * angka RAM/load/latency dan grafiknya ikut bergerak tanpa reload penuh.
 */
router.get('/client/:id/live', (req, res) => {
  const detail = getClientDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'Client tidak ditemukan.' });

  res.json({
    status: detail.status,
    hostname: detail.hostname,
    privateIp: detail.privateIp,
    publicIp: detail.publicIp,
    lastSeenAt: detail.lastSeenAt,
    lastLatencyMs: detail.lastLatencyMs,
    latencyStats: detail.latencyStats,
    metric: detail.metric,
    metricHistory: detail.metricHistory,
    alerts: detail.alerts,
    uptimeText: detail.metric ? formatUptime(detail.metric.uptime_seconds) : '-',
  });
});

module.exports = router;
