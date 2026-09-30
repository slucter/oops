const express = require('express');
const { getDashboardClients, getClientDetail } = require('../services/clientDashboardData');

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
  res.render('dashboard', { grouped, username: req.session.username });
});

router.get('/client/:id', (req, res) => {
  const detail = getClientDetail(req.params.id);
  if (!detail) return res.status(404).render('not-found', { id: req.params.id });
  // Locals bernama "client" bentrok dengan opsi reserved EJS (opts.client) —
  // pakai "item" sebagai nama locals view.
  res.render('client-detail', { item: detail, username: req.session.username, formatUptime });
});

module.exports = router;
