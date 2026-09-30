const webpush = require('web-push');
const db = require('../db');
const settingsStore = require('./settingsStore');

/**
 * Web Push: notifikasi browser yang tetap sampai walau tab dashboard
 * tertutup (berbeda dari Notification API biasa yang butuh halaman
 * terbuka). Butuh sepasang kunci VAPID — di-generate sekali saat pertama
 * kali dipakai lalu disimpan di settings, supaya subscription yang sudah
 * terdaftar tidak invalid setiap kali server restart.
 */

const insertSub = db.prepare(`
  INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  VALUES (@userId, @endpoint, @p256dh, @auth, @userAgent)
  ON CONFLICT (endpoint) DO UPDATE SET
    user_id = @userId, p256dh = @p256dh, auth = @auth,
    user_agent = @userAgent, fail_count = 0
`);

const deleteByEndpoint = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
const listAll = db.prepare('SELECT * FROM push_subscriptions');
const countAll = db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions');
const markSuccess = db.prepare(`UPDATE push_subscriptions SET last_success_at = datetime('now'), fail_count = 0 WHERE id = ?`);
const bumpFail = db.prepare('UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = ?');
const findByEndpoint = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?');

const MAX_CONSECUTIVE_FAILURES = 5;

let configured = false;

/** Ambil kunci VAPID dari settings; generate dan simpan kalau belum ada. */
function ensureKeys() {
  let publicKey = settingsStore.get('vapid_public_key');
  let privateKey = settingsStore.get('vapid_private_key');

  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    settingsStore.setMany({ vapid_public_key: publicKey, vapid_private_key: privateKey });
    console.log('[push] kunci VAPID baru dibuat dan disimpan');
  }

  if (!configured) {
    // `subject` wajib diisi menurut spesifikasi VAPID — push service memakainya
    // untuk menghubungi pemilik server kalau ada masalah pengiriman.
    const subject = settingsStore.get('vapid_subject') || 'mailto:admin@localhost';
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  }

  return { publicKey, privateKey };
}

function getPublicKey() {
  return ensureKeys().publicKey;
}

const userExists = db.prepare('SELECT 1 FROM users WHERE id = ?');

function saveSubscription(sub, userId, userAgent) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    throw new Error('Data langganan push tidak lengkap.');
  }

  // user_id hanya diisi kalau user-nya benar-benar ada. Kalau tidak (mis.
  // sesi lama yang usernya sudah dihapus), langganan tetap disimpan tanpa
  // pemilik — lebih baik notifikasi tetap jalan daripada gagal total
  // karena foreign key.
  const ownerId = userId && userExists.get(userId) ? userId : null;

  insertSub.run({
    userId: ownerId,
    endpoint: String(sub.endpoint).slice(0, 1000),
    p256dh: String(sub.keys.p256dh).slice(0, 500),
    auth: String(sub.keys.auth).slice(0, 500),
    userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
  });
}

function removeSubscription(endpoint) {
  deleteByEndpoint.run(endpoint);
}

function hasSubscription(endpoint) {
  return !!findByEndpoint.get(endpoint);
}

function countSubscriptions() {
  return countAll.get().n;
}

function isEnabled() {
  return settingsStore.getBool('push_enabled') && countSubscriptions() > 0;
}

/**
 * Kirim payload ke semua browser yang terdaftar. Tidak pernah melempar —
 * kegagalan push tidak boleh menjatuhkan alur alert yang memanggilnya.
 *
 * Subscription yang ditolak permanen (404/410 = browser mencabut izin atau
 * uninstall) langsung dihapus, supaya tabel tidak menumpuk endpoint mati.
 */
async function sendToAll(payload) {
  let keys;
  try {
    keys = ensureKeys();
  } catch (err) {
    console.error('[push] gagal menyiapkan kunci VAPID:', err.message);
    return { sent: 0, failed: 0 };
  }
  if (!keys.publicKey) return { sent: 0, failed: 0 };

  const subs = listAll.all();
  if (subs.length === 0) return { sent: 0, failed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;

  await Promise.all(subs.map(async (row) => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        body,
        { TTL: 3600, urgency: payload.severity === 'critical' ? 'high' : 'normal' }
      );
      markSuccess.run(row.id);
      sent++;
    } catch (err) {
      failed++;
      const code = err.statusCode;

      // 404/410 = push service bilang langganan sudah mati (izin dicabut,
      // browser di-uninstall). 400 = data langganan tidak dipahami service.
      // Ketiganya permanen, jadi langsung dibersihkan.
      if (code === 404 || code === 410 || code === 400) {
        deleteByEndpoint.run(row.endpoint);
        console.log(`[push] langganan kedaluwarsa dihapus (HTTP ${code})`);
        return;
      }

      bumpFail.run(row.id);
      console.error(`[push] gagal kirim (HTTP ${code || 'lokal'}): ${err.message}`);

      // Tanpa statusCode, kegagalan terjadi sebelum request terkirim —
      // biasanya kunci enkripsi langganan rusak, yang tidak akan pulih
      // sendiri. Dibuang setelah beberapa kali gagal berturut-turut supaya
      // tidak memperlambat setiap pengiriman selamanya.
      if (row.fail_count + 1 >= MAX_CONSECUTIVE_FAILURES) {
        deleteByEndpoint.run(row.endpoint);
        console.log(`[push] langganan dibuang setelah ${MAX_CONSECUTIVE_FAILURES} kegagalan beruntun`);
      }
    }
  }));

  return { sent, failed };
}

module.exports = {
  getPublicKey,
  saveSubscription,
  removeSubscription,
  hasSubscription,
  countSubscriptions,
  isEnabled,
  sendToAll,
  ensureKeys,
};
