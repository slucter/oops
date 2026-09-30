const express = require('express');
const serverStore = require('../services/serverStore');
const { keyUpload, assertValidKeyFile, removeKeyFile } = require('../middleware/keyUpload');

const router = express.Router();

function parseHasDocker(body) {
  return body.has_docker === 'on' || body.has_docker === 'true';
}

function parseViaServerId(body) {
  if (!body.via_server_id) return null;
  const n = Number(body.via_server_id);
  return Number.isInteger(n) ? n : null;
}

router.get('/servers/new', (req, res) => {
  const servers = serverStore.listServers();
  res.render('server-form', { server: null, servers, error: null });
});

router.post('/servers', keyUpload.single('ssh_key'), (req, res) => {
  const servers = serverStore.listServers();

  if (!req.file) {
    return res.status(400).render('server-form', {
      server: null,
      servers,
      error: 'File private key wajib diupload.',
    });
  }

  try {
    assertValidKeyFile(req.file.path);

    serverStore.createServer({
      name: req.body.name,
      groupName: req.body.group_name,
      host: req.body.host,
      port: Number(req.body.port) || 22,
      user: req.body.user,
      sshKeyPath: req.file.path,
      viaServerId: parseViaServerId(req.body),
      hasDocker: parseHasDocker(req.body),
    });
    res.redirect('/');
  } catch (err) {
    removeKeyFile(req.file.path);
    res.status(400).render('server-form', { server: null, servers, error: err.message });
  }
});

router.get('/servers/:id/edit', (req, res) => {
  const server = serverStore.getServerById(Number(req.params.id));
  if (!server) return res.status(404).render('not-found', { id: req.params.id });

  const servers = serverStore.listServers().filter((s) => s.id !== server.id);
  res.render('server-form', { server, servers, error: null });
});

router.post('/servers/:id/edit', keyUpload.single('ssh_key'), (req, res) => {
  const id = Number(req.params.id);
  const existing = serverStore.getServerById(id);
  const servers = serverStore.listServers().filter((s) => s.id !== id);

  if (!existing) {
    if (req.file) removeKeyFile(req.file.path);
    return res.status(404).render('not-found', { id: req.params.id });
  }

  try {
    if (req.file) {
      assertValidKeyFile(req.file.path);
    }

    serverStore.updateServer(id, {
      name: req.body.name,
      groupName: req.body.group_name,
      host: req.body.host,
      port: Number(req.body.port) || 22,
      user: req.body.user,
      viaServerId: parseViaServerId(req.body),
      hasDocker: parseHasDocker(req.body),
    });

    if (req.file) {
      serverStore.updateServerKeyPath(id, req.file.path);
      removeKeyFile(existing.sshKey);
    }

    res.redirect('/');
  } catch (err) {
    if (req.file) removeKeyFile(req.file.path);
    res.status(400).render('server-form', { server: existing, servers, error: err.message });
  }
});

router.post('/servers/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  const server = serverStore.getServerById(id);
  if (!server) return res.status(404).render('not-found', { id: req.params.id });

  const dependents = serverStore.countDependents(id);
  if (dependents > 0) {
    const servers = serverStore.listServers();
    return res.status(400).render('server-form', {
      server,
      servers: servers.filter((s) => s.id !== id),
      error: `Tidak bisa dihapus: ${dependents} server lain memakai ini sebagai jump host. Ubah jump host mereka dulu.`,
    });
  }

  removeKeyFile(server.sshKey);
  serverStore.deleteServer(id);
  res.redirect('/');
});

module.exports = router;
