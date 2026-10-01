/**
 * Uji alert tidak berkedip (WARNING/PULIH bergantian).
 * Dijalankan dari root projek: node uji/alert-flap.js
 *
 * Latar: grup Telegram pemilik projek dibanjiri WARNING -> PULIH -> WARNING
 * tiap beberapa menit untuk client yang disknya TIDAK bergerak sama sekali
 * (tetap 49/61 GB). Beberapa insiden hanya hidup 30 detik.
 *
 * Dua penyebabnya:
 *   1. `disk_used_gb` dulu berasal dari `df -h` yang membulatkan ke satuan
 *      manusia, jadi 48->49 terbaca sebagai lompatan 1 GB penuh. Pada
 *      rentang pendek itu jadi "+2 GB/jam" dari disk yang diam.
 *   2. Ambang naik dan ambang turun sama persis, jadi prediksi yang
 *      berosilasi di sekitar ambang menyalakan dan memadamkan alert
 *      bergantian.
 */
process.env.SESSION_SECRET = 'uji';
process.env.DB_PATH = require('path').join(process.cwd(), 'data', 'uji-flap.sqlite');

const fs = require('fs');
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(process.env.DB_PATH + s); } catch {} }

let gagal = 0;
const cek = (l, c) => { if (!c) { gagal++; console.log('GAGAL  ' + l); } else console.log('  OK  ' + l); };

const db = require('../src/db');
const clientStore = require('../src/services/clientStore');
const settingsStore = require('../src/services/settingsStore');
const alertEngine = require('../src/services/alertEngine');

// Matikan notifikasi keluar: yang diuji keputusan alert, bukan pengirimannya.
settingsStore.setMany({ telegram_enabled: '0', push_enabled: '0', alert_disk_forecast_hours: '10' });

const c = clientStore.createClient({ name: 'Flap', groupId: null });
const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(c.id);

/** Isi riwayat metrik: `jam` jam ke belakang, disk naik `gbPerJam`. */
function isiRiwayat(mulaiGb, gbPerJam, jam, totalGb) {
  db.prepare('DELETE FROM client_metrics WHERE client_id = ?').run(c.id);
  const n = 120;
  for (let i = n - 1; i >= 0; i--) {
    const jamLalu = (jam * i) / (n - 1);
    const gb = mulaiGb + gbPerJam * (jam - jamLalu);
    db.prepare(`INSERT INTO client_metrics (client_id, disk_total_gb, disk_used_gb, received_at)
      VALUES (?,?,?, datetime('now', ?))`).run(c.id, totalGb, gb, `-${jamLalu.toFixed(4)} hours`);
  }
}

function jumlahAlertAktif() {
  return db.prepare("SELECT COUNT(*) n FROM alerts WHERE client_id=? AND kind='disk_forecast' AND resolved_at IS NULL").get(c.id).n;
}
function jumlahInsiden() {
  return db.prepare("SELECT COUNT(*) n FROM alerts WHERE client_id=? AND kind='disk_forecast'").get(c.id).n;
}
function reset() {
  db.prepare("DELETE FROM alerts WHERE client_id=?").run(c.id);
}

console.log('=== 1. Disk DIAM tidak boleh memicu alert ===');
// Disk tetap 49 GB selama 6 jam — persis kasus Production.
isiRiwayat(49, 0, 6, 61);
alertEngine.evaluateMetric(client, { diskUsedGb: 49, diskTotalGb: 61, memTotalMb: 1000, memUsedMb: 100 });
cek('tidak ada alert untuk disk yang diam', jumlahInsiden() === 0);

console.log('\n=== 2. Pertumbuhan sangat kecil diabaikan (derau pembulatan) ===');
reset();
isiRiwayat(49, 0.1, 6, 61); // 0.1 GB/jam, di bawah ambang 0.25
alertEngine.evaluateMetric(client, { diskUsedGb: 49.6, diskTotalGb: 61, memTotalMb: 1000, memUsedMb: 100 });
cek('pertumbuhan 0.1 GB/jam tidak memicu alert', jumlahInsiden() === 0);

console.log('\n=== 3. Pertumbuhan NYATA tetap memicu alert ===');
reset();
// Angka dipilih supaya TIDAK memicu alert disk biasa (ambang 85%):
// 68/100 GB = 68%, tumbuh 8 GB/jam, sisa 32 GB -> penuh dalam 4 jam.
// Kalau >= 85%, prediksi memang sengaja dibersihkan karena mubazir.
isiRiwayat(20, 8, 6, 100);
alertEngine.evaluateMetric(client, { diskUsedGb: 68, diskTotalGb: 100, memTotalMb: 1000, memUsedMb: 100 });
cek('alert menyala untuk pertumbuhan nyata', jumlahAlertAktif() === 1);

console.log('\n=== 4. HISTERESIS: osilasi di sekitar ambang tidak berkedip ===');
// Alert sudah menyala. Sekarang prediksi membaik SEDIKIT (ke ~11 jam),
// masih di bawah ambang pulih (15 jam). Alert harus TETAP menyala.
const sebelumOsilasi = jumlahInsiden();
// Prediksi membaik dari 4 jam ke ~12 jam: sudah MELEWATI ambang nyala (10)
// tapi belum mencapai ambang pulih (15). Tanpa histeresis, alert langsung
// padam di sini dan akan menyala lagi pada siklus berikutnya — berkedip.
isiRiwayat(50, 2, 6, 100); // 2 GB/jam, akhir 62 GB, sisa 38 -> 19 jam
db.prepare('DELETE FROM client_metrics WHERE client_id = ?').run(c.id);
for (let i = 119; i >= 0; i--) {
  const jamLalu = (6 * i) / 119;
  db.prepare(`INSERT INTO client_metrics (client_id, disk_total_gb, disk_used_gb, received_at)
    VALUES (?,?,?, datetime('now', ?))`).run(c.id, 100, 50 + 3 * (6 - jamLalu), `-${jamLalu.toFixed(4)} hours`);
}
// 3 GB/jam, akhir 68 GB, sisa 32 -> 10.7 jam: di antara 10 dan 15.
alertEngine.evaluateMetric(client, { diskUsedGb: 68, diskTotalGb: 100, memTotalMb: 1000, memUsedMb: 100 });
cek('alert tetap menyala, tidak dibuat insiden baru', jumlahInsiden() === sebelumOsilasi);
cek('masih aktif', jumlahAlertAktif() === 1);

console.log('\n=== 5. Alert baru tidak langsung dinyatakan pulih ===');
// Prediksi membaik jauh (disk menyusut), tapi alert baru menyala beberapa
// detik lalu. Pengaman umur minimum harus menahannya.
db.prepare('DELETE FROM client_metrics WHERE client_id = ?').run(c.id);
for (let i = 119; i >= 0; i--) {
  const jamLalu = (6 * i) / 119;
  db.prepare(`INSERT INTO client_metrics (client_id, disk_total_gb, disk_used_gb, received_at)
    VALUES (?,?,?, datetime('now', ?))`).run(c.id, 100, 20 - 0.5 * (6 - jamLalu), `-${jamLalu.toFixed(4)} hours`);
}
alertEngine.evaluateMetric(client, { diskUsedGb: 17, diskTotalGb: 100, memTotalMb: 1000, memUsedMb: 100 });
cek('alert yang baru menyala TIDAK langsung pulih', jumlahAlertAktif() === 1);

console.log('\n=== 6. Alert lama boleh pulih ===');
db.prepare("UPDATE alerts SET started_at = datetime('now','-30 minutes') WHERE client_id=? AND resolved_at IS NULL").run(c.id);
alertEngine.evaluateMetric(client, { diskUsedGb: 17, diskTotalGb: 100, memTotalMb: 1000, memUsedMb: 100 });
cek('alert berumur 30 menit bisa dinyatakan pulih', jumlahAlertAktif() === 0);

console.log('\n=== 7. Rentang data pendek diabaikan ===');
reset();
isiRiwayat(40, 5, 1, 100); // hanya 1 jam rentangnya (< 2 jam)
alertEngine.evaluateMetric(client, { diskUsedGb: 45, diskTotalGb: 100, memTotalMb: 1000, memUsedMb: 100 });
cek('rentang < 2 jam tidak dipakai menilai tren', jumlahInsiden() === 0);

console.log(gagal === 0 ? '\n>>> SEMUA LULUS' : `\n>>> ${gagal} GAGAL`);
db.close();
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(process.env.DB_PATH + s); } catch {} }
process.exit(gagal ? 1 : 0);
