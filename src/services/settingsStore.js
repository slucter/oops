const db = require('../db');

const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const upsertStmt = db.prepare(`
  INSERT INTO settings (key, value) VALUES (@key, @value)
  ON CONFLICT (key) DO UPDATE SET value = @value, updated_at = datetime('now')
`);

/**
 * Nilai default dipakai kalau belum pernah diatur lewat halaman Setting.
 * Ambang batas dipilih konservatif: cukup tinggi supaya tidak berisik pada
 * beban normal, tapi masih menyisakan waktu untuk bertindak.
 */
const DEFAULTS = {
  alert_disk_percent: '85',
  alert_mem_percent: '90',
  alert_load_per_cpu: '2',
  alert_latency_ms: '1000',
  alert_disk_forecast_hours: '24',
  alert_on_offline: '1',
  alert_on_recover: '1',
  alert_on_new_client: '1',
  telegram_bot_token: '',
  telegram_chat_id: '',
  telegram_enabled: '0',
  push_enabled: '1',
  vapid_public_key: '',
  vapid_private_key: '',
  vapid_subject: '',
};

function get(key) {
  const row = getStmt.get(key);
  if (row && row.value != null) return row.value;
  return DEFAULTS[key] != null ? DEFAULTS[key] : null;
}

function getNumber(key) {
  const n = Number(get(key));
  return Number.isFinite(n) ? n : Number(DEFAULTS[key]);
}

function getBool(key) {
  return get(key) === '1';
}

function set(key, value) {
  upsertStmt.run({ key, value: value == null ? '' : String(value) });
}

function setMany(entries) {
  const tx = db.transaction((list) => {
    for (const [key, value] of list) set(key, value);
  });
  tx(Object.entries(entries));
}

// Nilai rahasia yang tidak boleh ikut ke view/JSON. Kunci privat VAPID
// tidak pernah dibutuhkan di browser, dan token bot ditangani terpisah
// lewat maskSecret() di tempat yang memang perlu menampilkannya tersamar.
const NEVER_EXPOSE = new Set(['vapid_private_key']);

/** Semua pengaturan (dengan default terisi) untuk ditampilkan di form. */
function getAll() {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (NEVER_EXPOSE.has(key)) continue;
    out[key] = get(key);
  }
  return out;
}

/**
 * Token disamarkan untuk ditampilkan di UI — hanya 4 karakter terakhir yang
 * terlihat, supaya tidak terbaca orang lain yang melihat layar.
 */
function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return '••••••••' + value.slice(-4);
}

module.exports = { get, getNumber, getBool, set, setMany, getAll, maskSecret, DEFAULTS };
