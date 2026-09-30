const express = require('express');
const shareStore = require('../services/shareStore');
const clientStore = require('../services/clientStore');
const { getDashboardClients, getClientDetail } = require('../services/clientDashboardData');

const router = express.Router();

/**
 * Halaman share read-only — TANPA LOGIN.
 *
 * Router ini didaftarkan sebelum requireAuth, jadi semua yang ada di sini
 * bisa diakses publik oleh siapa pun yang memegang token. Tiga aturan yang
 * tidak boleh dilanggar di berkas ini:
 *
 * 1. **Hanya GET.** Tidak ada satu pun rute yang mengubah data. Bahkan kalau
 *    seseorang menebak URL aksi dashboard, tidak ada padanannya di sini.
 * 2. **Token menentukan apa yang terlihat**, bukan parameter dari URL.
 *    `/share/:token/client/:id` memeriksa bahwa id itu memang termasuk dalam
 *    share tersebut — tanpa itu, siapa pun yang punya satu token bisa
 *    menelusuri seluruh client hanya dengan mengubah angka di URL.
 * 3. **Tidak membocorkan keberadaan token.** Token tidak dikenal, sudah
 *    dicabut, dan sudah kedaluwarsa semuanya menghasilkan halaman yang sama.
 */

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

/** Ambil share yang valid, atau render halaman "tidak berlaku" dan kembalikan null. */
function ambilShare(req, res) {
  const share = shareStore.findValidByToken(req.params.token);
  if (!share) {
    res.status(404).render('share-invalid');
    return null;
  }
  return share;
}

/** Client mana saja yang boleh dilihat lewat share ini. */
function idYangBoleh(share) {
  return share.scope === 'client'
    ? new Set([share.client_id])
    : new Set(shareStore.getClientIds(share.id));
}

router.get('/share/:token', (req, res) => {
  const share = ambilShare(req, res);
  if (!share) return;

  // Share per-client langsung diarahkan ke halaman detailnya, supaya satu
  // bentuk URL cukup untuk kedua jenis share.
  if (share.scope === 'client') {
    return res.redirect(`/share/${req.params.token}/client/${share.client_id}`);
  }

  shareStore.catatKunjungan(share.id);

  const boleh = idYangBoleh(share);
  const semua = getDashboardClients();
  const grouped = {};
  for (const [namaGrup, daftar] of Object.entries(semua)) {
    const tersaring = daftar.filter((c) => boleh.has(c.id));
    if (tersaring.length) grouped[namaGrup] = tersaring;
  }

  res.render('share-dashboard', {
    grouped,
    token: req.params.token,
    label: share.label,
    expiresAt: share.expires_at,
  });
});

router.get('/share/:token/client/:id', (req, res) => {
  const share = ambilShare(req, res);
  if (!share) return;

  const id = Number(req.params.id);
  // Pemeriksaan ini yang mencegah satu token dipakai menelusuri seluruh
  // client dengan mengubah angka di URL.
  if (!idYangBoleh(share).has(id)) {
    return res.status(404).render('share-invalid');
  }

  const detail = getClientDetail(id);
  if (!detail) return res.status(404).render('share-invalid');

  shareStore.catatKunjungan(share.id);

  res.render('share-detail', {
    item: detail,
    formatUptime,
    token: req.params.token,
    // Tombol kembali hanya masuk akal kalau share-nya memang mencakup
    // beberapa client; untuk share satu client, tidak ada tujuan kembali.
    adaDaftar: share.scope === 'dashboard',
    label: share.label,
    expiresAt: share.expires_at,
  });
});

/** Data live untuk halaman detail share — angka bergerak tanpa reload penuh. */
router.get('/share/:token/client/:id/live', (req, res) => {
  const share = shareStore.findValidByToken(req.params.token);
  if (!share) return res.status(404).json({ error: 'Link tidak berlaku.' });

  const id = Number(req.params.id);
  if (!idYangBoleh(share).has(id)) {
    return res.status(404).json({ error: 'Tidak ditemukan.' });
  }

  const detail = getClientDetail(id);
  if (!detail) return res.status(404).json({ error: 'Tidak ditemukan.' });

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

/** Data live untuk tabel share — dipakai auto-refresh halaman dashboard share. */
router.get('/share/:token/live', (req, res) => {
  const share = shareStore.findValidByToken(req.params.token);
  if (!share || share.scope !== 'dashboard') {
    return res.status(404).json({ error: 'Link tidak berlaku.' });
  }

  const boleh = idYangBoleh(share);
  const ringkas = [];
  for (const daftar of Object.values(getDashboardClients())) {
    for (const c of daftar) {
      if (!boleh.has(c.id)) continue;
      ringkas.push({
        id: c.id,
        status: c.status,
        lastSeenAt: c.lastSeenAt,
        lastLatencyMs: c.lastLatencyMs,
        memPercent: c.metric ? c.metric.memPercent : null,
        diskPercent: c.metric ? c.metric.diskPercent : null,
        alerts: c.alerts ? c.alerts.length : 0,
        worstSeverity: c.worstSeverity,
      });
    }
  }
  res.json({ clients: ringkas });
});

module.exports = router;
