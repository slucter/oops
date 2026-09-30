const { AGENT_VERSION } = require('../../agent/version');

/**
 * Perbandingan versi agent. Server menyajikan berkas agent dari folder
 * `agent/` di repo ini, jadi versi yang ada di situ adalah versi terbaru
 * yang tersedia — tidak perlu daftar versi terpisah yang bisa basi.
 */

/** Versi agent yang sedang disajikan server untuk instalasi/update. */
const LATEST_AGENT_VERSION = AGENT_VERSION;

/**
 * Pecah "1.2.3" jadi [1, 2, 3]. Komponen non-angka jadi 0 supaya versi
 * aneh tidak melempar error — lebih baik dianggap versi lama daripada
 * menjatuhkan halaman dashboard.
 */
function parseVersion(v) {
  if (!v || typeof v !== 'string') return null;
  const parts = v.trim().split('.').slice(0, 3).map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  while (parts.length < 3) parts.push(0);
  return parts;
}

/**
 * Apakah `candidate` lebih baru daripada `current`?
 *
 * Dibandingkan per-komponen sebagai angka, bukan sebagai string: secara
 * string "1.10.0" < "1.9.0" (karena '1' < '9'), padahal 1.10.0 jelas lebih
 * baru. Perbandingan string akan diam-diam berhenti menawarkan update
 * begitu minor version mencapai dua digit.
 */
function isNewerVersion(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a) return false;
  if (!b) return true; // versi sekarang tidak diketahui -> anggap perlu update

  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

/**
 * Apakah client ini perlu di-update?
 *
 * `null`/kosong berarti agent belum pernah melaporkan versinya — itu agent
 * lama (sebelum fitur ini ada), yang justru paling perlu update. Tapi client
 * berstatus `pending` belum pernah terhubung sama sekali, jadi tidak ada
 * yang perlu di-update di sana.
 *
 * Menerima dua bentuk nama field dengan sengaja: `agentVersion` dari
 * clientStore.mapRow(), dan `agent_version` kalau baris DB mentah yang
 * diberikan. Tanpa ini, satu pemanggil yang memakai bentuk lain akan
 * membaca undefined dan diam-diam menganggap SEMUA client perlu update —
 * kegagalan yang tidak terlihat seperti kegagalan.
 */
function needsUpdate(client) {
  if (!client || client.status === 'pending') return false;
  const current = client.agentVersion !== undefined ? client.agentVersion : client.agent_version;
  return isNewerVersion(LATEST_AGENT_VERSION, current);
}

module.exports = {
  LATEST_AGENT_VERSION,
  isNewerVersion,
  needsUpdate,
  parseVersion,
};
