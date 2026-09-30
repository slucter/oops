const express = require('express');
const clientStore = require('../services/clientStore');
const groupStore = require('../services/groupStore');
const wsServer = require('../ws/server');
const agentVersion = require('../services/agentVersion');
const optimizeJobs = require('../services/optimizeJobs');

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

/**
 * Update semua client yang tertinggal versi, sekaligus.
 *
 * Dijalankan berurutan, bukan paralel: kalau ada versi agent yang rusak,
 * kegagalan pertama menghentikan sisanya, sehingga yang terlanjur rusak
 * hanya satu client — bukan semuanya sekaligus. Client yang sedang tidak
 * terkoneksi dilewati (bukan dianggap gagal); ia akan ditawari update lagi
 * begitu terhubung kembali.
 *
 * Didaftarkan SEBELUM route `/clients/:id/...` dengan sengaja, supaya
 * "update-agent-all" tidak pernah ada kemungkinan tertangkap sebagai `:id`.
 */
router.post('/clients/update-agent-all', async (req, res) => {
  const targets = clientStore.listClients()
    .filter((c) => agentVersion.needsUpdate(c) && wsServer.isClientConnected(c.id));

  const results = [];
  for (const client of targets) {
    try {
      const r = await wsServer.requestAgentUpdate(client.id);
      results.push({ id: client.id, name: client.name, ok: r.ok, message: r.message });
      if (!r.ok) break;
    } catch (err) {
      results.push({ id: client.id, name: client.name, ok: false, message: err.message });
      break;
    }
  }

  const berhasil = results.filter((r) => r.ok).length;
  const gagal = results.find((r) => !r.ok);

  res.json({
    ok: !gagal,
    total: targets.length,
    berhasil,
    message: gagal
      ? `${berhasil} dari ${targets.length} berhasil. Berhenti di "${gagal.name}": ${gagal.message}`
      : targets.length === 0
        ? 'Tidak ada client terkoneksi yang perlu di-update.'
        : `${berhasil} client berhasil di-update.`,
  });
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

/**
 * Hapus client: cabut agent di server target lebih dulu, lalu hapus datanya.
 *
 * Kalau agent tidak dicabut, ia akan terus mencoba reconnect ke server
 * monitoring selamanya dengan token yang sudah tidak berlaku, dan folder
 * ~/.oops-agent beserta service systemd-nya tertinggal di server target.
 *
 * Kegagalan uninstall TIDAK membatalkan penghapusan. Client yang tidak bisa
 * dihapus dari dashboard hanya karena agent-nya sedang offline adalah
 * kemunduran, bukan pengaman — pemilik projek diberi tahu lewat pesan di
 * dashboard supaya tahu ada sisa yang perlu dibersihkan manual.
 */
router.post('/clients/:id/delete', async (req, res) => {
  const id = Number(req.params.id);
  const client = clientStore.getClientById(id);
  if (!client) return res.status(404).render('not-found', { id: req.params.id });

  let hasil = { ok: false, offline: true, message: null };
  try {
    hasil = await wsServer.requestUninstall(id);
  } catch (err) {
    // requestUninstall dirancang tidak melempar, tapi kalau toh terjadi,
    // penghapusan tetap harus jalan.
    hasil = { ok: false, message: err.message };
  }

  clientStore.deleteClient(id);

  if (hasil.ok) {
    return res.redirect('/?dihapus=' + encodeURIComponent(client.name));
  }
  // Agent tertinggal di server target — beri perintah pembersihannya.
  res.redirect('/?dihapus=' + encodeURIComponent(client.name) + '&sisa=1');
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

/** Minta satu agent memperbarui dirinya (AJAX). */
router.post('/clients/:id/update-agent', async (req, res) => {
  const id = Number(req.params.id);
  const client = clientStore.getClientById(id);
  if (!client) return res.status(404).json({ error: 'Client tidak ditemukan.' });

  try {
    const result = await wsServer.requestAgentUpdate(id);
    if (!result.ok) {
      return res.status(502).json({ error: result.message || 'Agent melaporkan update gagal.' });
    }
    res.json({ ok: true, message: result.message || 'Update diterapkan.' });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/**
 * Mulai optimasi untuk satu atau beberapa client.
 *
 * Membalas SEGERA dengan id job, tidak menunggu optimasinya selesai.
 * Optimasi bisa memakan belasan menit (journal 3.5GB, cache docker 2GB) —
 * jauh melewati timeout nginx yang bawaannya 60 detik. Kemajuannya diambil
 * lewat GET /optimize/:jobId.
 */
router.post('/optimize', (req, res) => {
  const mentah = req.body.client_ids;
  const daftar = (Array.isArray(mentah) ? mentah : mentah ? [mentah] : [])
    .map(Number)
    .filter(Number.isInteger);

  const valid = daftar.filter((id) => clientStore.getClientById(id));
  if (valid.length === 0) {
    return res.status(400).json({ error: 'Pilih minimal satu client.' });
  }

  const job = optimizeJobs.buatJob(valid, !!req.body.docker);
  // Sengaja tanpa await: job berjalan di latar, permintaan ini langsung selesai.
  optimizeJobs.jalankan(job).catch((err) => {
    console.error('[optimize] job gagal:', err.message);
  });

  res.json({ ok: true, jobId: job.id, jumlah: valid.length });
});

/** Kemajuan job optimasi — dipanggil berkala oleh dashboard. */
router.get('/optimize/:jobId', (req, res) => {
  const job = optimizeJobs.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job tidak ditemukan atau sudah kedaluwarsa.' });
  }
  res.json(optimizeJobs.ringkas(job));
});

module.exports = router;
