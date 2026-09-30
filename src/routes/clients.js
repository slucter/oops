const express = require('express');
const clientStore = require('../services/clientStore');
const groupStore = require('../services/groupStore');
const wsServer = require('../ws/server');

const router = express.Router();

function parseGroupId(body) {
  if (!body.group_id) return null;
  const n = Number(body.group_id);
  return Number.isInteger(n) ? n : null;
}

function installCommandFor(token) {
  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  return `curl -fsSL "${base}/install.sh?token=${token}" | bash`;
}

// Catatan: key locals EJS sengaja dinamai "item" (bukan "client") karena
// "client" adalah nama opsi reserved di EJS (opts.client) — kalau dipakai
// sebagai locals, EJS salah mengira ini minta mode compile "client-side"
// dan fungsi include() jadi tidak terpasang, melempar "include is not a
// function". Ditemukan lewat debugging langsung ke internal EJS.

router.get('/clients/new', (req, res) => {
  const groups = groupStore.listGroups();
  res.render('client-form', { item: null, groups, error: null, installCommand: null });
});

router.post('/clients', (req, res) => {
  const groups = groupStore.listGroups();
  try {
    const client = clientStore.createClient({ name: req.body.name, groupId: parseGroupId(req.body) });
    res.redirect(`/clients/${client.id}/edit?created=1`);
  } catch (err) {
    res.status(400).render('client-form', { item: null, groups, error: err.message, installCommand: null });
  }
});

router.get('/clients/:id/edit', (req, res) => {
  const client = clientStore.getClientById(Number(req.params.id));
  if (!client) return res.status(404).render('not-found', { id: req.params.id });

  const groups = groupStore.listGroups();
  res.render('client-form', {
    item: client,
    groups,
    error: null,
    installCommand: installCommandFor(client.token),
  });
});

router.post('/clients/:id/edit', (req, res) => {
  const id = Number(req.params.id);
  const existing = clientStore.getClientById(id);
  const groups = groupStore.listGroups();

  if (!existing) {
    return res.status(404).render('not-found', { id: req.params.id });
  }

  try {
    const client = clientStore.updateClient(id, { name: req.body.name, groupId: parseGroupId(req.body) });
    res.render('client-form', { item: client, groups, error: null, installCommand: installCommandFor(client.token) });
  } catch (err) {
    res.status(400).render('client-form', {
      item: existing,
      groups,
      error: err.message,
      installCommand: installCommandFor(existing.token),
    });
  }
});

router.post('/clients/:id/regenerate-token', (req, res) => {
  const id = Number(req.params.id);
  const client = clientStore.getClientById(id);
  if (!client) return res.status(404).render('not-found', { id: req.params.id });

  clientStore.regenerateToken(id);
  res.redirect(`/clients/${id}/edit?regenerated=1`);
});

router.post('/clients/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  const client = clientStore.getClientById(id);
  if (!client) return res.status(404).render('not-found', { id: req.params.id });

  clientStore.deleteClient(id);
  res.redirect('/');
});

/** Minta agent jalankan docker ps -a atau ss -tulnp, tunggu balasan (AJAX). */
router.post('/clients/:id/command/:command', async (req, res) => {
  const id = Number(req.params.id);
  const command = req.params.command;
  if (!['docker_ps', 'port_listen'].includes(command)) {
    return res.status(400).json({ error: 'Command tidak dikenal.' });
  }

  const client = clientStore.getClientById(id);
  if (!client) return res.status(404).json({ error: 'Client tidak ditemukan.' });

  try {
    const result = await wsServer.requestCommand(id, command);
    res.json({ ok: true, output: result.output, errorMessage: result.errorMessage });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
