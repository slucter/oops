/**
 * Uji fitur pemetaan disk. Dijalankan dari root projek: node uji/peta.js
 */
process.env.SESSION_SECRET = 'uji';
process.env.PETA_TIMEOUT_MS = '6000';

const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = process.cwd();
const DB = path.join(ROOT, 'data', 'uji-peta.sqlite');
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB + s); } catch {} }
process.env.DB_PATH = DB;

const WebSocket = require('ws');
const express = require('express');

let gagal = 0;
const cek = (l, c) => { if (!c) { gagal++; console.log('GAGAL  ' + l); } else console.log('  OK  ' + l); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function kirim(method, pathname, body) {
  return new Promise((resolve) => {
    let data = null;
    if (body) {
      const p = new URLSearchParams();
      for (const k in body) p.append(k, body[k]);
      data = p.toString();
    }
    const r = http.request(
      {
        host: '127.0.0.1', port: 31985, path: pathname, method,
        headers: data
          ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data), Accept: 'application/json' }
          : { Accept: 'application/json' },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(b); } catch {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    r.on('error', (e) => resolve({ status: 0, json: null }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const db = require('../src/db');
  const clientStore = require('../src/services/clientStore');
  const wsServer = require('../src/ws/server');
  const petaJobs = require('../src/services/petaJobs');

  console.log('=== 1. Penyusunan pohon dari daftar datar ===');
  // Kasus dari pemilik projek: folder A berisi file, di dalamnya folder AB
  // berisi beberapa file.
  let pohon = petaJobs.susunPohon([
    { path: '/', kb: 1000 },
    { path: '/a', kb: 300 },
    { path: '/a/ab', kb: 250 },
    { path: '/var', kb: 600 },
    { path: '/var/log', kb: 500 },
  ]);
  cek('satu akar', pohon.length === 1 && pohon[0].path === '/');
  const akar = pohon[0];
  cek('anak akar terurut dari terbesar', akar.anak[0].path === '/var' && akar.anak[1].path === '/a');
  const a = akar.anak.find((x) => x.path === '/a');
  cek('/a punya anak /a/ab', a.anak.length === 1 && a.anak[0].path === '/a/ab');
  cek('nama pendek dipakai untuk tampilan', a.anak[0].nama === 'ab');
  cek('sisa dihitung (300 - 250 = 50)', a.sisaKb === 50);
  cek('sisa akar benar (1000 - 300 - 600 = 100)', akar.sisaKb === 100);

  console.log('\n=== 2. Lubang: induk tidak lolos ambang ===');
  // /a/b/c tidak ada di daftar, tapi /a/b/c/d ada. Anak tidak boleh hilang.
  pohon = petaJobs.susunPohon([
    { path: '/', kb: 1000 },
    { path: '/a', kb: 500 },
    { path: '/a/b/c/d', kb: 400 },
  ]);
  const a2 = pohon[0].anak.find((x) => x.path === '/a');
  cek('cucu digantung ke leluhur terdekat', a2.anak.length === 1 && a2.anak[0].path === '/a/b/c/d');
  cek('nama tetap terbaca', a2.anak[0].nama === 'd');

  console.log('\n=== 3. Tanpa akar "/" pun tetap tersusun ===');
  pohon = petaJobs.susunPohon([
    { path: '/home/x', kb: 100 },
    { path: '/var/y', kb: 200 },
  ]);
  cek('dua akar terpisah', pohon.length === 2);
  cek('terurut dari terbesar', pohon[0].path === '/var/y');

  console.log('\n=== 4. Alur lengkap dengan agent tiruan ===');
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'src', 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use((q, s, n) => { s.locals.username = 'uji'; q.session = { username: 'uji' }; n(); });
  app.use(require('../src/routes/clients'));
  const server = app.listen(31985);
  wsServer.attach(server);

  const c1 = clientStore.createClient({ name: 'Petakan', groupId: null });
  const ws1 = new WebSocket(`ws://127.0.0.1:31985/agent?token=${c1.token}`);
  await new Promise((r) => ws1.on('open', r));
  ws1.on('message', async (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type !== 'peta_disk') return;
    ws1.send(JSON.stringify({ type: 'peta_progress', id: m.id, tahap: 'memindai folder…' }));
    await sleep(150);
    ws1.send(JSON.stringify({
      type: 'peta_result', id: m.id, ok: true, root: '/',
      totalKb: 16716588, ambangKb: 83582, terpotong: false,
      folder: [
        { path: '/', kb: 16716588, level: 0 },
        { path: '/home', kb: 2564412, level: 1 },
        { path: '/home/iyan', kb: 2564408, level: 2 },
        { path: '/home/iyan/edura/edura-service/logs', kb: 1511964, level: 5 },
        { path: '/var', kb: 1318524, level: 1 },
        { path: '/var/log', kb: 998652, level: 2 },
      ],
      file: [{ path: '/var/log/besar.log', kb: 820000 }],
      catatan: [],
    }));
  });
  await sleep(300);

  const t0 = Date.now();
  let r = await kirim('POST', `/clients/${c1.id}/peta`);
  cek('POST membalas < 1 detik (job di latar)', Date.now() - t0 < 1000);
  cek('berisi jobId', r.status === 200 && !!r.json.jobId);
  const job = r.json.jobId;

  r = await kirim('GET', `/peta/${job}`);
  for (let i = 0; i < 40 && !(r.json && r.json.selesai); i++) {
    await sleep(150);
    r = await kirim('GET', `/peta/${job}`);
  }
  cek('job selesai', r.json.selesai === true && r.json.status === 'selesai');
  const h = r.json.hasil;
  cek('pohon tersusun', Array.isArray(h.pohon) && h.pohon.length === 1);
  cek('total disk terbawa', h.totalKb === 16716588);
  cek('file besar terbawa', h.file.length === 1 && h.file[0].kb === 820000);

  // Cari folder terdalam yang bengkak — inti permintaan pemilik projek.
  const cari = (simpul, p) => {
    if (simpul.path === p) return simpul;
    for (const a of simpul.anak) { const k = cari(a, p); if (k) return k; }
    return null;
  };
  const logs = cari(h.pohon[0], '/home/iyan/edura/edura-service/logs');
  cek('folder terdalam yang bengkak ADA di pohon', !!logs);
  cek('ukurannya benar (1.5GB)', logs && logs.kb === 1511964);
  cek('tergantung di bawah /home/iyan (leluhur terdekat)',
    !!cari(h.pohon[0], '/home/iyan').anak.find((x) => x.path.includes('edura-service/logs')));

  console.log('\n=== 5. Client offline ===');
  const c2 = clientStore.createClient({ name: 'Mati', groupId: null });
  r = await kirim('POST', `/clients/${c2.id}/peta`);
  const job2 = r.json.jobId;
  r = await kirim('GET', `/peta/${job2}`);
  for (let i = 0; i < 20 && !(r.json && r.json.selesai); i++) {
    await sleep(120);
    r = await kirim('GET', `/peta/${job2}`);
  }
  cek('ditandai gagal, bukan menggantung', r.json.status === 'gagal');
  cek('alasannya jelas', /tidak terkoneksi/i.test(r.json.pesan || ''));

  console.log('\n=== 6. Agent diam -> timeout ===');
  const c3 = clientStore.createClient({ name: 'Diam', groupId: null });
  const ws3 = new WebSocket(`ws://127.0.0.1:31985/agent?token=${c3.token}`);
  await new Promise((r2) => ws3.on('open', r2));
  await sleep(200);
  const t1 = Date.now();
  r = await kirim('POST', `/clients/${c3.id}/peta`);
  const job3 = r.json.jobId;
  r = await kirim('GET', `/peta/${job3}`);
  for (let i = 0; i < 100 && !(r.json && r.json.selesai); i++) {
    await sleep(200);
    r = await kirim('GET', `/peta/${job3}`);
  }
  cek('berhenti oleh timeout', r.json.selesai === true && r.json.status === 'gagal');
  cek('sesuai batas (~6 detik)', Date.now() - t1 < 12000);

  console.log('\n=== 7. Hasil dari agent dibersihkan ===');
  const c4 = clientStore.createClient({ name: 'Nakal', groupId: null });
  const ws4 = new WebSocket(`ws://127.0.0.1:31985/agent?token=${c4.token}`);
  await new Promise((r2) => ws4.on('open', r2));
  ws4.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type !== 'peta_disk') return;
    ws4.send(JSON.stringify({
      type: 'peta_result', id: m.id, ok: true, root: '/',
      // Nakal tapi MASIH di bawah batas transport 256 KB, supaya yang diuji
      // di sini benar-benar validator — bukan pemutusan koneksi.
      totalKb: 'banyak',
      folder: Array(900).fill(0).map((_, i) => ({ path: '/x' + i, kb: -5 })),
      file: Array(200).fill(0).map(() => ({ path: '/y', kb: 1 })),
      catatan: Array(50).fill('z'.repeat(400)),
    }));
  });
  await sleep(200);
  r = await kirim('POST', `/clients/${c4.id}/peta`);
  const job4 = r.json.jobId;
  r = await kirim('GET', `/peta/${job4}`);
  for (let i = 0; i < 40 && !(r.json && r.json.selesai); i++) {
    await sleep(150);
    r = await kirim('GET', `/peta/${job4}`);
  }
  cek('job tidak crash oleh masukan nakal', r.json.selesai === true);
  if (r.json.hasil) {
    cek('totalKb bukan angka -> null', r.json.hasil.totalKb === null);
    cek('kb negatif dibuang', r.json.hasil.jumlahFolder === 0);
    cek('daftar file dibatasi', r.json.hasil.file.length <= 50);
    cek('catatan dibatasi', r.json.hasil.catatan.length <= 10);
  } else {
    console.log('   [diag] status=' + r.json.status + ' pesan=' + r.json.pesan);
    cek('hasil ada', false);
  }

  console.log('\n=== 8. Client tidak dikenal ===');
  r = await kirim('POST', '/clients/99999/peta');
  cek('POST -> 404', r.status === 404);
  r = await kirim('GET', '/peta/tidakada');
  cek('GET job ngawur -> 404', r.status === 404);

  console.log(gagal === 0 ? '\n>>> SEMUA LULUS' : `\n>>> ${gagal} GAGAL`);
  try { ws1.close(); ws3.close(); ws4.close(); } catch {}
  server.close(); db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB + s); } catch {} }
  process.exit(gagal ? 1 : 0);
})().catch((e) => { console.error('ERROR UJI:', e); process.exit(1); });
