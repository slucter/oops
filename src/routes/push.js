const express = require('express');
const pushNotifier = require('../services/pushNotifier');

const router = express.Router();

/** Kunci publik VAPID untuk browser saat mendaftarkan langganan. */
router.get('/push/public-key', (req, res) => {
  try {
    res.json({ publicKey: pushNotifier.getPublicKey() });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyiapkan kunci push: ' + err.message });
  }
});

router.post('/push/subscribe', express.json({ limit: '8kb' }), (req, res) => {
  try {
    pushNotifier.saveSubscription(req.body, req.session.userId, req.get('user-agent'));
    res.json({ ok: true, count: pushNotifier.countSubscriptions() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/push/unsubscribe', express.json({ limit: '8kb' }), (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!endpoint) return res.status(400).json({ error: 'endpoint wajib diisi.' });
  pushNotifier.removeSubscription(endpoint);
  res.json({ ok: true, count: pushNotifier.countSubscriptions() });
});

/** Cek apakah browser ini (berdasarkan endpoint-nya) sudah terdaftar. */
router.post('/push/status', express.json({ limit: '8kb' }), (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  res.json({
    registered: endpoint ? pushNotifier.hasSubscription(endpoint) : false,
    count: pushNotifier.countSubscriptions(),
  });
});

router.post('/push/test', async (req, res) => {
  const result = await pushNotifier.sendToAll({
    title: '🔔 Test notifikasi Oops',
    body: 'Kalau ini muncul, push notification sudah siap dipakai.',
    severity: 'info',
    tag: 'oops-test',
    url: '/',
    timestamp: Date.now(),
  });

  if (result.sent > 0) {
    return res.json({ ok: true, message: `Terkirim ke ${result.sent} browser.` });
  }
  res.status(400).json({
    error: result.failed > 0
      ? `Gagal mengirim ke ${result.failed} browser. Cek log server untuk detail.`
      : 'Belum ada browser yang mengaktifkan notifikasi.',
  });
});

module.exports = router;
