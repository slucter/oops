/**
 * Wajib login untuk semua halaman dashboard.
 *
 * Permintaan yang datang dari JavaScript dijawab JSON 401, BUKAN redirect
 * ke halaman login. `fetch` mengikuti redirect secara diam-diam, jadi
 * kode di browser menerima HTML halaman login, gagal mem-parse-nya sebagai
 * JSON, lalu menampilkan error yang tidak ada hubungannya dengan masalah
 * sebenarnya.
 *
 * Itu bukan kemungkinan teoretis: sesi kedaluwarsa setelah 8 jam, dan kalau
 * itu terjadi saat polling kemajuan optimasi berjalan, dashboard melaporkan
 * kegagalan padahal optimasinya berhasil di server target.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }

  const mintaJson = (req.get('accept') || '').includes('application/json')
    || req.xhr
    || req.get('x-requested-with') === 'XMLHttpRequest';

  if (mintaJson) {
    return res.status(401).json({
      error: 'Sesi berakhir. Muat ulang halaman lalu login kembali.',
      sesiBerakhir: true,
    });
  }

  return res.redirect('/login');
}

module.exports = requireAuth;
