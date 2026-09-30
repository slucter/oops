const crypto = require('crypto');
const db = require('../db');

/**
 * Link share read-only.
 *
 * Halaman share bisa dibuka siapa pun yang memegang URL-nya, tanpa login.
 * Token di URL itu SATU-SATUNYA pengaman, jadi dua hal dijaga ketat di sini:
 *
 * 1. **Token tidak pernah disimpan apa adanya.** Yang masuk database adalah
 *    hash SHA-256-nya. Kalau database bocor, isinya tidak bisa langsung
 *    dipakai membuka halaman share. Nilai aslinya hanya ada sekali, saat
 *    dibuat, untuk ditampilkan ke pemilik projek.
 *
 * 2. **Client yang ikut disimpan eksplisit per client, bukan per grup.**
 *    Kalau share menyimpan "grup KST", client baru yang nanti masuk grup itu
 *    akan ikut terbagikan tanpa ada yang memutuskan. Memilih grup di UI hanya
 *    jalan pintas untuk mencentang anggotanya saat itu.
 */

const TOKEN_BYTES = 24; // 48 karakter hex — cukup panjang untuk tidak bisa ditebak

const insertShare = db.prepare(`
  INSERT INTO shares (token_hash, scope, client_id, label, created_by, expires_at)
  VALUES (@tokenHash, @scope, @clientId, @label, @createdBy, @expiresAt)
`);
const insertShareClient = db.prepare(
  'INSERT OR IGNORE INTO share_clients (share_id, client_id) VALUES (?, ?)'
);
const getByHash = db.prepare('SELECT * FROM shares WHERE token_hash = ?');
const getById = db.prepare('SELECT * FROM shares WHERE id = ?');
const revokeStmt = db.prepare("UPDATE shares SET revoked_at = datetime('now') WHERE id = ?");
const bumpView = db.prepare(
  "UPDATE shares SET view_count = view_count + 1, last_viewed_at = datetime('now') WHERE id = ?"
);
const clientIdsOf = db.prepare('SELECT client_id FROM share_clients WHERE share_id = ?');

const listAktif = db.prepare(`
  SELECT s.*, c.name AS client_name,
         (SELECT COUNT(*) FROM share_clients sc WHERE sc.share_id = s.id) AS jumlah_client
  FROM shares s
  LEFT JOIN clients c ON c.id = s.client_id
  WHERE s.revoked_at IS NULL
  ORDER BY s.created_at DESC
`);

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Buat share baru. Mengembalikan { id, token } — `token` hanya dikembalikan
 * di sini dan tidak bisa diambil lagi nanti, karena yang tersimpan hash-nya.
 *
 * `expiresMinutes`: menit dari sekarang. null/0 berarti tidak kedaluwarsa.
 */
function createShare({ scope, clientId = null, clientIds = [], label = null, createdBy = null, expiresMinutes = null }) {
  if (scope !== 'dashboard' && scope !== 'client') {
    throw new Error('Scope share tidak dikenal.');
  }
  if (scope === 'client' && !clientId) {
    throw new Error('Share per-client butuh client yang dipilih.');
  }
  if (scope === 'dashboard' && (!Array.isArray(clientIds) || clientIds.length === 0)) {
    throw new Error('Pilih minimal satu client untuk dibagikan.');
  }

  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');

  let expiresAt = null;
  if (expiresMinutes != null && Number(expiresMinutes) > 0) {
    const menit = Math.floor(Number(expiresMinutes));
    // Dihitung oleh SQLite, bukan JavaScript, supaya satuan waktunya sama
    // dengan datetime('now') yang dipakai saat memeriksa kedaluwarsa. Kalau
    // dihitung di JS dengan zona waktu lokal, link bisa kedaluwarsa lebih
    // cepat atau lebih lambat dari yang diminta.
    expiresAt = db.prepare("SELECT datetime('now', ?) AS t").get(`+${menit} minutes`).t;
  }

  const buat = db.transaction(() => {
    const info = insertShare.run({
      tokenHash: hashToken(token),
      scope,
      clientId: scope === 'client' ? clientId : null,
      label: label ? String(label).slice(0, 120) : null,
      createdBy,
      expiresAt,
    });
    const shareId = info.lastInsertRowid;
    if (scope === 'dashboard') {
      for (const cid of clientIds) insertShareClient.run(shareId, cid);
    }
    return shareId;
  });

  return { id: buat(), token };
}

/**
 * Cari share yang masih berlaku dari token mentah.
 *
 * Mengembalikan null untuk token tidak dikenal, sudah dicabut, MAUPUN sudah
 * kedaluwarsa — ketiganya sengaja tidak dibedakan ke pemanggil, supaya
 * halaman publik tidak membocorkan bahwa suatu token pernah ada.
 */
function findValidByToken(token) {
  if (!token || typeof token !== 'string' || token.length > 128) return null;

  const row = getByHash.get(hashToken(token));
  if (!row) return null;
  if (row.revoked_at) return null;

  if (row.expires_at) {
    // Perbandingan dilakukan di SQLite supaya memakai acuan waktu yang sama
    // dengan saat expires_at dihitung.
    const masihBerlaku = db
      .prepare("SELECT datetime('now') < ? AS ok")
      .get(row.expires_at).ok;
    if (!masihBerlaku) return null;
  }

  return row;
}

/** Catat bahwa share dibuka. Tidak pernah melempar — statistik tidak boleh menjatuhkan halaman. */
function catatKunjungan(shareId) {
  try {
    bumpView.run(shareId);
  } catch {
    // diabaikan
  }
}

function getClientIds(shareId) {
  return clientIdsOf.all(shareId).map((r) => r.client_id);
}

function revokeShare(id) {
  revokeStmt.run(id);
}

function getShareById(id) {
  return getById.get(id) || null;
}

/** Daftar share aktif, lengkap dengan status kedaluwarsanya. */
function listShares() {
  const sekarang = db.prepare("SELECT datetime('now') AS t").get().t;
  return listAktif.all().map((s) => ({
    ...s,
    kedaluwarsa: !!(s.expires_at && s.expires_at <= sekarang),
  }));
}

module.exports = {
  createShare,
  findValidByToken,
  getClientIds,
  revokeShare,
  listShares,
  catatKunjungan,
  // Dinamai ulang saat diekspor: `getById` di dalam berkas ini adalah
  // prepared statement, bukan fungsi. Mengekspornya langsung membuat
  // pemanggil memanggil statement sebagai fungsi dan gagal saat dijalankan.
  getById: getShareById,
  hashToken,
};
