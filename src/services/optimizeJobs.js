const crypto = require('crypto');
const wsServer = require('../ws/server');
const clientStore = require('./clientStore');

/**
 * Job optimasi — dijalankan di latar belakang, bukan menunggu balasan HTTP.
 *
 * Optimasi bisa memakan beberapa menit: `journalctl --vacuum-size` pada
 * journal 3.5GB dan `docker builder prune` pada cache 2GB tidak selesai dalam
 * hitungan detik. Kalau dashboard menunggu balasan dalam satu permintaan HTTP,
 * permintaan itu akan timeout di nginx (bawaan 60 detik) dan pengguna melihat
 * kegagalan padahal optimasinya berhasil.
 *
 * Karena itu: POST hanya membuat job dan langsung membalas id-nya. Dashboard
 * menanyakan kemajuannya lewat polling, dan agent mengirim kabar lewat
 * WebSocket yang sudah terbuka.
 *
 * Job disimpan di memori, bukan database. Ia tidak berguna lagi setelah
 * server restart — agent yang sedang mengoptimasi tidak akan menemukan
 * penampung balasannya, dan itu memang tidak apa-apa: pekerjaannya di server
 * target tetap selesai, hanya laporannya yang hilang.
 */

// jobId -> job
const jobs = new Map();

const SIMPAN_SELESAI_MS = 30 * 60 * 1000; // job selesai dibuang setelah 30 menit
const TIMEOUT_MS = Number(process.env.OPTIMIZE_TIMEOUT_MS || 15 * 60 * 1000);

function buatJob(clientIds, sertakanDocker) {
  const id = crypto.randomBytes(9).toString('hex');
  const job = {
    id,
    dibuat: Date.now(),
    sertakanDocker,
    selesai: false,
    target: clientIds.map((cid) => {
      const c = clientStore.getClientById(cid);
      return {
        clientId: cid,
        nama: c ? c.name : `#${cid}`,
        status: 'menunggu', // menunggu | berjalan | selesai | gagal | dilewati
        nomor: 0,
        total: 0,
        langkahSekarang: null,
        hematBytes: null,
        langkah: [],
        dilewati: [],
        butuhSudo: false,
        pesan: null,
        memTersediaMb: null,
        memTotalMb: null,
        memCacheMb: null,
      };
    }),
  };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

/** Ringkasan untuk dashboard — bentuknya sudah siap dipakai UI. */
function ringkas(job) {
  const selesai = job.target.filter((t) => ['selesai', 'gagal', 'dilewati'].includes(t.status)).length;
  const totalHemat = job.target.reduce((a, t) => a + (t.hematBytes || 0), 0);
  return {
    id: job.id,
    selesai: job.selesai,
    jumlah: job.target.length,
    jumlahSelesai: selesai,
    totalHematBytes: totalHemat,
    target: job.target,
  };
}

/**
 * Jalankan job: satu client demi satu, berurutan.
 *
 * Sengaja berurutan, bukan paralel. Optimasi memakai disk dan CPU cukup berat;
 * menjalankannya serentak di banyak server sekaligus berarti semua server itu
 * melambat pada saat yang sama — persis kebalikan dari tujuannya.
 */
async function jalankan(job) {
  for (const t of job.target) {
    if (!wsServer.isClientConnected(t.clientId)) {
      t.status = 'dilewati';
      t.pesan = 'Client sedang tidak terkoneksi.';
      continue;
    }

    t.status = 'berjalan';
    try {
      const hasil = await wsServer.requestOptimize(
        t.clientId,
        job.sertakanDocker,
        (progres) => {
          t.nomor = progres.nomor || 0;
          t.total = progres.total || 0;
          t.langkahSekarang = progres.nama || null;
        },
        TIMEOUT_MS
      );

      if (hasil.ok) {
        t.status = 'selesai';
        t.hematBytes = hasil.hematBytes != null ? hasil.hematBytes : 0;
        t.langkah = Array.isArray(hasil.langkah) ? hasil.langkah : [];
        t.dilewati = Array.isArray(hasil.dilewati) ? hasil.dilewati : [];
        t.butuhSudo = !!hasil.butuhSudo;
        t.memTersediaMb = hasil.memTersediaMb ?? null;
        t.memTotalMb = hasil.memTotalMb ?? null;
        t.memCacheMb = hasil.memCacheMb ?? null;
      } else {
        t.status = 'gagal';
        t.pesan = hasil.pesan || 'Agent melaporkan optimasi gagal.';
      }
    } catch (err) {
      t.status = 'gagal';
      t.pesan = err.message;
    }
    t.langkahSekarang = null;
  }

  job.selesai = true;

  // Buang dari memori setelah beberapa waktu supaya tidak menumpuk. Diberi
  // jeda, bukan langsung, agar dashboard sempat mengambil hasil akhirnya.
  setTimeout(() => jobs.delete(job.id), SIMPAN_SELESAI_MS).unref?.();
}

module.exports = { buatJob, getJob, ringkas, jalankan };
