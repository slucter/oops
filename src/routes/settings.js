const express = require('express');
const settingsStore = require('../services/settingsStore');
const telegram = require('../services/telegramNotifier');
const pushNotifier = require('../services/pushNotifier');

const router = express.Router();

const NUMERIC_KEYS = [
  'alert_disk_percent',
  'alert_mem_percent',
  'alert_load_per_cpu',
  'alert_latency_ms',
  'alert_disk_forecast_hours',
];

const BOOL_KEYS = ['alert_on_offline', 'alert_on_recover', 'alert_on_new_client', 'telegram_enabled'];

function viewModel(req, extra = {}) {
  const s = settingsStore.getAll();
  // Web Push butuh secure context. Di balik reverse proxy, protokol asli
  // ada di X-Forwarded-Proto — req.protocol sendiri akan bilang "http"
  // karena koneksi nginx->app memang plain.
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.hostname || '';
  const httpsOk = proto === 'https' || host === 'localhost' || host === '127.0.0.1';

  return {
    settings: s,
    tokenMasked: settingsStore.maskSecret(s.telegram_bot_token),
    hasToken: !!s.telegram_bot_token,
    pushCount: pushNotifier.countSubscriptions(),
    httpsOk,
    error: null,
    notice: null,
    ...extra,
  };
}

router.get('/settings', (req, res) => {
  res.render('settings', viewModel(req));
});

router.post('/settings', (req, res) => {
  const updates = {};

  for (const key of NUMERIC_KEYS) {
    const raw = req.body[key];
    if (raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).render('settings', viewModel(req, { error: `Nilai "${key}" harus berupa angka positif.` }));
    }
    updates[key] = String(n);
  }

  // Checkbox tidak dikirim browser kalau tidak dicentang — jadi ketiadaannya
  // berarti "0", bukan "jangan ubah".
  for (const key of BOOL_KEYS) {
    updates[key] = req.body[key] ? '1' : '0';
  }

  if (req.body.telegram_chat_id !== undefined) {
    updates.telegram_chat_id = String(req.body.telegram_chat_id).trim();
  }

  // Token hanya ditimpa kalau field diisi — dibiarkan kosong berarti
  // "pertahankan token yang sudah tersimpan", supaya membuka halaman lalu
  // menyimpan tidak menghapus token tanpa sengaja.
  const tokenInput = (req.body.telegram_bot_token || '').trim();
  if (tokenInput) updates.telegram_bot_token = tokenInput;

  settingsStore.setMany(updates);
  res.render('settings', viewModel(req, { notice: 'Pengaturan tersimpan.' }));
});

/**
 * Kirim pesan uji ke Telegram. Token/chat ID yang sedang diketik di form
 * dipakai langsung (tanpa harus menyimpan dulu) supaya pengguna bisa
 * memverifikasi sebelum menyimpan — kalau field token dibiarkan kosong,
 * jatuh kembali ke token yang sudah tersimpan.
 */
router.post('/settings/test-telegram', async (req, res) => {
  const token = (req.body.telegram_bot_token || '').trim() || settingsStore.get('telegram_bot_token');
  const chatId = (req.body.telegram_chat_id || '').trim() || settingsStore.get('telegram_chat_id');

  const result = await telegram.sendMessage(
    '🔔 <b>Test notifikasi Oops</b>\nKalau pesan ini sampai, notifikasi alert sudah siap dipakai.',
    { token, chatId }
  );

  if (result.ok) {
    return res.render('settings', viewModel(req, {
      notice: 'Pesan uji terkirim. Cek grup Telegram Anda. Jangan lupa Simpan kalau token/chat ID diubah.',
    }));
  }
  res.status(400).render('settings', viewModel(req, { error: `Gagal mengirim: ${result.error}` }));
});

module.exports = router;
