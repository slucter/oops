const express = require('express');
const shareStore = require('../services/shareStore');
const clientStore = require('../services/clientStore');
const groupStore = require('../services/groupStore');

const router = express.Router();

/**
 * Pengelolaan link share — semuanya butuh login (didaftarkan di belakang
 * requireAuth). Halaman publiknya sendiri ada di routes/share.js.
 */

function baseUrl(req) {
  // Di balik reverse proxy, req.protocol selalu "http" karena koneksi
  // nginx->app memang plain. Link yang dibagikan harus https, jadi protokol
  // aslinya dibaca dari X-Forwarded-Proto.
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return process.env.PUBLIC_BASE_URL || `${proto}://${req.get('host')}`;
}

function parseMenit(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined; // undefined = tidak valid
  if (n === 0) return null; // 0 = tanpa batas
  // Batas atas 10 tahun: angka di luar itu hampir pasti salah ketik, dan
  // link yang berlaku berabad-abad tidak pernah benar-benar dimaksudkan.
  if (n > 5256000) return undefined;
  return Math.floor(n);
}

/** Halaman kelola: buat share baru + daftar share aktif. */
router.get('/shares', (req, res) => {
  res.render('shares', {
    clients: clientStore.listClients(),
    groups: groupStore.listGroups(),
    shares: shareStore.listShares(),
    baseUrl: baseUrl(req),
    tokenBaru: null,
    error: null,
    notice: null,
  });
});

function render(req, res, extra, status = 200) {
  res.status(status).render('shares', {
    clients: clientStore.listClients(),
    groups: groupStore.listGroups(),
    shares: shareStore.listShares(),
    baseUrl: baseUrl(req),
    tokenBaru: null,
    error: null,
    notice: null,
    ...extra,
  });
}

/** Buat share dashboard (beberapa client sekaligus). */
router.post('/shares', (req, res) => {
  const menit = parseMenit(req.body.expires_minutes);
  if (menit === undefined) {
    return render(req, res, { error: 'Masa berlaku harus berupa angka menit (0 = tanpa batas).' }, 400);
  }

  // Checkbox bernama sama dikirim sebagai array kalau lebih dari satu, dan
  // sebagai string tunggal kalau cuma satu — samakan bentuknya dulu.
  const mentah = req.body.client_ids;
  const daftar = (Array.isArray(mentah) ? mentah : mentah ? [mentah] : [])
    .map(Number)
    .filter(Number.isInteger);

  // Hanya id yang benar-benar ada yang diterima, supaya share tidak menyimpan
  // rujukan ke client yang sudah dihapus.
  const valid = daftar.filter((id) => clientStore.getClientById(id));
  if (valid.length === 0) {
    return render(req, res, { error: 'Pilih minimal satu client untuk dibagikan.' }, 400);
  }

  try {
    const { token } = shareStore.createShare({
      scope: 'dashboard',
      clientIds: valid,
      label: req.body.label,
      createdBy: req.session ? req.session.userId : null,
      expiresMinutes: menit,
    });
    render(req, res, {
      tokenBaru: { token, url: `${baseUrl(req)}/share/${token}`, jumlah: valid.length },
      notice: 'Link share dibuat. Salin sekarang — token tidak bisa dilihat lagi setelah halaman ini ditutup.',
    });
  } catch (err) {
    render(req, res, { error: err.message }, 400);
  }
});

/** Buat share untuk satu client — dipicu tombol share di baris tabel / halaman detail. */
router.post('/clients/:id/share', (req, res) => {
  const id = Number(req.params.id);
  const client = clientStore.getClientById(id);
  if (!client) return res.status(404).json({ error: 'Client tidak ditemukan.' });

  const menit = parseMenit(req.body.expires_minutes);
  if (menit === undefined) {
    return res.status(400).json({ error: 'Masa berlaku harus berupa angka menit (0 = tanpa batas).' });
  }

  try {
    const { token } = shareStore.createShare({
      scope: 'client',
      clientId: id,
      label: req.body.label || client.name,
      createdBy: req.session ? req.session.userId : null,
      expiresMinutes: menit,
    });
    res.json({
      ok: true,
      url: `${baseUrl(req)}/share/${token}`,
      expiresMinutes: menit,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Cabut share — berlaku seketika, tidak menunggu kedaluwarsa. */
router.post('/shares/:id/revoke', (req, res) => {
  const id = Number(req.params.id);
  const share = shareStore.getById(id);
  if (!share) {
    return render(req, res, { error: 'Link share tidak ditemukan.' }, 404);
  }
  shareStore.revokeShare(id);
  render(req, res, { notice: 'Link dicabut. Mulai sekarang tidak bisa dibuka lagi.' });
});

module.exports = router;
