const crypto = require('crypto');
const wsServer = require('../ws/server');
const clientStore = require('./clientStore');

/**
 * Job pemetaan disk — pola sama dengan optimizeJobs: berjalan di latar,
 * kemajuannya diambil lewat polling.
 *
 * `du` seluruh disk bisa memakan menit di server dengan jutaan file, jauh
 * melewati timeout nginx. Job disimpan di memori karena hasilnya adalah
 * potret sesaat: begitu server restart, angka-angkanya sudah tidak mewakili
 * keadaan sekarang dan lebih baik dipindai ulang.
 */

const jobs = new Map();
const SIMPAN_SELESAI_MS = 30 * 60 * 1000;
const TIMEOUT_MS = Number(process.env.PETA_TIMEOUT_MS || 20 * 60 * 1000);

function buatJob(clientId) {
  const c = clientStore.getClientById(clientId);
  const id = crypto.randomBytes(9).toString('hex');
  const job = {
    id,
    clientId,
    nama: c ? c.name : `#${clientId}`,
    dibuat: Date.now(),
    selesai: false,
    status: 'menunggu', // menunggu | berjalan | selesai | gagal
    tahap: null,
    pesan: null,
    hasil: null,
  };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

/**
 * Susun daftar datar jadi pohon bersarang.
 *
 * Agent mengirim daftar path yang sudah dipangkas, tapi pemangkasan bisa
 * meninggalkan lubang: `/a/b/c/d` lolos ambang sementara `/a/b/c` tidak.
 * Anak yang induknya tidak ada digantung ke leluhur terdekat yang ADA,
 * supaya tidak hilang dari peta hanya karena satu tingkat di atasnya kecil.
 */
function susunPohon(folder) {
  const urut = [...folder].sort((a, b) => a.path.localeCompare(b.path));
  const perPath = new Map();
  const akar = [];

  for (const f of urut) {
    const simpul = { path: f.path, kb: f.kb, nama: namaPendek(f.path), anak: [] };
    perPath.set(f.path, simpul);

    const induk = cariInduk(f.path, perPath);
    if (induk) induk.anak.push(simpul);
    else akar.push(simpul);
  }

  // Urutkan tiap tingkat dari terbesar — yang bikin bengkak harus di atas.
  const urutkan = (daftar) => {
    daftar.sort((a, b) => b.kb - a.kb);
    for (const s of daftar) urutkan(s.anak);
  };
  urutkan(akar);

  // Hitung "sisa": selisih ukuran folder dengan jumlah anak yang tampil.
  // Tanpa ini, folder 1.5GB yang anaknya hanya 200MB terlihat janggal —
  // sisanya adalah berkas langsung di folder itu atau subfolder di bawah
  // ambang, dan itu informasi yang berguna.
  const hitungSisa = (s) => {
    let jumlahAnak = 0;
    for (const a of s.anak) {
      hitungSisa(a);
      jumlahAnak += a.kb;
    }
    s.sisaKb = Math.max(0, s.kb - jumlahAnak);
  };
  for (const a of akar) hitungSisa(a);

  return akar;
}

function namaPendek(p) {
  if (p === '/') return '/';
  const bagian = p.split('/').filter(Boolean);
  return bagian.length ? bagian[bagian.length - 1] : p;
}

/** Leluhur terdekat yang ada di peta. */
function cariInduk(p, perPath) {
  if (p === '/') return null;
  let kini = p;
  for (;;) {
    const idx = kini.lastIndexOf('/');
    if (idx < 0) return null;
    kini = idx === 0 ? '/' : kini.slice(0, idx);
    if (perPath.has(kini)) return perPath.get(kini);
    if (kini === '/') return null;
  }
}

function ringkas(job) {
  return {
    id: job.id,
    clientId: job.clientId,
    nama: job.nama,
    selesai: job.selesai,
    status: job.status,
    tahap: job.tahap,
    pesan: job.pesan,
    hasil: job.hasil,
  };
}

async function jalankan(job) {
  if (!wsServer.isClientConnected(job.clientId)) {
    job.status = 'gagal';
    job.pesan = 'Client sedang tidak terkoneksi.';
    job.selesai = true;
    return;
  }

  job.status = 'berjalan';
  job.tahap = 'menyiapkan…';

  try {
    const hasil = await wsServer.requestPeta(
      job.clientId,
      (p) => { job.tahap = p.tahap || job.tahap; },
      TIMEOUT_MS
    );

    if (hasil.ok) {
      job.status = 'selesai';
      job.hasil = {
        root: hasil.root,
        totalKb: hasil.totalKb,
        ambangKb: hasil.ambangKb,
        terpotong: hasil.terpotong,
        catatan: hasil.catatan,
        pohon: susunPohon(hasil.folder),
        file: hasil.file,
        jumlahFolder: hasil.folder.length,
      };
    } else {
      job.status = 'gagal';
      job.pesan = hasil.pesan || 'Agent melaporkan pemetaan gagal.';
    }
  } catch (err) {
    job.status = 'gagal';
    job.pesan = err.message;
  }

  job.tahap = null;
  job.selesai = true;
  setTimeout(() => jobs.delete(job.id), SIMPAN_SELESAI_MS).unref?.();
}

module.exports = { buatJob, getJob, ringkas, jalankan, susunPohon };
