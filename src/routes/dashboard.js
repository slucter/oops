const express = require('express');
const { getDashboardServers, getServerDetail } = require('../services/dashboardData');

const router = express.Router();

router.get('/', (req, res) => {
  const servers = getDashboardServers();
  res.render('dashboard', { servers, username: req.session.username });
});

router.get('/server/:id', (req, res) => {
  const detail = getServerDetail(req.params.id);
  if (!detail) return res.status(404).render('not-found', { id: req.params.id });
  res.render('server-detail', { server: detail, username: req.session.username });
});

module.exports = router;
