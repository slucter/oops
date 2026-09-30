const express = require('express');
const serverStore = require('../services/serverStore');

const router = express.Router();

function parseViaServerId(body) {
  if (!body.via_server_id) return null;
  const n = Number(body.via_server_id);
  return Number.isInteger(n) ? n : null;
}

/**
 * Server yang boleh dipilih sebagai jump host: hanya server root (tidak
 * punya `via` sendiri). Server yang sudah jadi "anak" tidak ditawarkan
 * sebagai jump host lagi, supaya dropdown tetap ringkas — bastion nyata
 * di setup pemilik projek selalu diakses langsung, tidak berlapis.
 */
function jumpHostCandidates(excludeId) {
  return serverStore.listServers().filter((s) => s.via == null && s.id !== excludeId);
}

router.get('/servers/new', (req, res) => {
  const servers = jumpHostCandidates(null);
  res.render('server-form', { server: null, servers, error: null });
});

router.post('/servers', (req, res) => {
  const servers = jumpHostCandidates(null);

  try {
    serverStore.createServer({
      name: req.body.name,
      groupName: req.body.group_name,
      host: req.body.host,
      port: Number(req.body.port) || 22,
      user: req.body.user,
      viaServerId: parseViaServerId(req.body),
    });
    res.redirect('/');
  } catch (err) {
    res.status(400).render('server-form', { server: null, servers, error: err.message });
  }
});

router.get('/servers/:id/edit', (req, res) => {
  const server = serverStore.getServerById(Number(req.params.id));
  if (!server) return res.status(404).render('not-found', { id: req.params.id });

  const servers = jumpHostCandidates(server.id);
  res.render('server-form', { server, servers, error: null });
});

router.post('/servers/:id/edit', (req, res) => {
  const id = Number(req.params.id);
  const existing = serverStore.getServerById(id);
  const servers = jumpHostCandidates(id);

  if (!existing) {
    return res.status(404).render('not-found', { id: req.params.id });
  }

  try {
    serverStore.updateServer(id, {
      name: req.body.name,
      groupName: req.body.group_name,
      host: req.body.host,
      port: Number(req.body.port) || 22,
      user: req.body.user,
      viaServerId: parseViaServerId(req.body),
    });
    res.redirect('/');
  } catch (err) {
    res.status(400).render('server-form', { server: existing, servers, error: err.message });
  }
});

router.post('/servers/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  const server = serverStore.getServerById(id);
  if (!server) return res.status(404).render('not-found', { id: req.params.id });

  const dependents = serverStore.countDependents(id);
  if (dependents > 0) {
    return res.status(400).render('server-form', {
      server,
      servers: jumpHostCandidates(id),
      error: `Tidak bisa dihapus: ${dependents} server lain memakai ini sebagai jump host. Ubah jump host mereka dulu.`,
    });
  }

  serverStore.deleteServer(id);
  res.redirect('/');
});

module.exports = router;
