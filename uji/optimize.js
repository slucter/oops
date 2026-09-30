/**
 * Uji fitur Optimize. Dijalankan dari root projek: node uji/optimize.js
 *
 * Yang ditekankan: job berjalan di latar (tidak ada yang menunggu balasan
 * HTTP), kemajuan bisa diambil, dan satu client bermasalah tidak
 * menghentikan client lain.
 */
process.env.SESSION_SECRET = 'uji';
process.env.OPTIMIZE_TIMEOUT_MS = '6000';

const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = process.cwd();
const DB = path.join(ROOT, 'data', 'uji-optimize.sqlite');
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
      for (const k in body) {
        const v = body[k];
        if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
        else p.append(k, v);
      }
      data = p.toString();
    }
    const r = http.request(
      {
        host: '127.0.0.1', port: 31988, path: pathname, method,
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
          resolve({ status: res.statusCode, json, body: b });
        });
      }
    );
    r.on('error', (e) => resolve({ status: 0, json: null, body: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

/** Agent tiruan yang merespons perintah optimize seperti agent sungguhan. */
function agentTiruan(token, perilaku) {
  const ws = new WebSocket(`ws://127.0.0.1:31988/agent?token=${token}`);
  ws.on('message', async (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type !== 'optimize') return;
    if (perilaku.diam) return; // sengaja tidak membalas: menguji timeout

    ws.send(JSON.stringify({ type: 'optimize_progress', id: m.id, nomor: 1, total: 2, nama: 'journal systemd' }));
    await sleep(150);
    ws.send(JSON.stringify({ type: 'optimize_progress', id: m.id, nomor: 2, total: 2, nama: 'cache apt' }));
    await sleep(150);

    if (perilaku.gagal) {
      ws.send(JSON.stringify({ type: 'optimize_result', id: m.id, ok: false, pesan: 'disk read-only' }));
      return;
    }
    ws.send(JSON.stringify({
      type: 'optimize_result', id: m.id, ok: true,
      hematBytes: perilaku.hemat != null ? perilaku.hemat : 3.3 * 1024 * 1024 * 1024,
      langkah: [
        { nama: 'journal systemd dipangkas ke 200M', ok: true, pesan: 'Vacuuming done' },
        { nama: 'cache apt dibersihkan', ok: true, pesan: null },
      ],
      dilewati: perilaku.dilewati || [],
      butuhSudo: !!perilaku.butuhSudo,
      dockerTersedia: true,
      memTotalMb: 32134, memTersediaMb: 29840, memCacheMb: 13880,
    }));
  });
  return new Promise((r) => ws.on('open', () => r(ws)));
}

(async () => {
  const db = require('../src/db');
  const clientStore = require('../src/services/clientStore');
  const wsServer = require('../src/ws/server');

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'src', 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use((q, s, n) => { s.locals.username = 'uji'; q.session = { username: 'uji' }; n(); });
  app.use(require('../src/routes/clients'));
  const server = app.listen(31988);
  wsServer.attach(server);

  const c1 = clientStore.createClient({ name: 'Sehat', groupId: null });
  const c2 = clientStore.createClient({ name: 'Bermasalah', groupId: null });
  const c3 = clientStore.createClient({ name: 'Offline', groupId: null });

  const ws1 = await agentTiruan(c1.token, { hemat: 3_500_000_000 });
  const ws2 = await agentTiruan(c2.token, { gagal: true });
  await sleep(300);

  console.log('=== 1. POST /optimize membalas SEGERA, tidak menunggu selesai ===');
  const mulai = Date.now();
  let r = await kirim('POST', '/optimize', { client_ids: [c1.id], docker: '1' });
  const lama = Date.now() - mulai;
  cek('membalas < 1 detik (job berjalan di latar)', lama < 1000);
  cek('berisi jobId', r.status === 200 && r.json && !!r.json.jobId);
  const job1 = r.json.jobId;

  console.log('\n=== 2. Kemajuan bisa diambil selagi berjalan ===');
  await sleep(120);
  r = await kirim('GET', `/optimize/${job1}`);
  cek('endpoint kemajuan membalas 200', r.status === 200);
  cek('berisi daftar target', r.json && Array.isArray(r.json.target) && r.json.target.length === 1);

  // Tunggu sampai selesai.
  for (let i = 0; i < 40 && !(r.json && r.json.selesai); i++) {
    await sleep(120);
    r = await kirim('GET', `/optimize/${job1}`);
  }
  cek('job akhirnya selesai', r.json && r.json.selesai === true);
  const t1 = r.json.target[0];
  cek('status client: selesai', t1.status === 'selesai');
  cek('hemat disk terlaporkan', t1.hematBytes === 3_500_000_000);
  cek('rincian langkah ikut terbawa', t1.langkah.length === 2 && t1.langkah[0].ok === true);
  cek('info RAM ikut terbawa', t1.memTersediaMb === 29840);
  cek('total hemat dihitung', r.json.totalHematBytes === 3_500_000_000);

  console.log('\n=== 3. Satu client gagal tidak menghentikan yang lain ===');
  r = await kirim('POST', '/optimize', { client_ids: [c2.id, c1.id] });
  const job2 = r.json.jobId;
  r = await kirim('GET', `/optimize/${job2}`);
  for (let i = 0; i < 60 && !(r.json && r.json.selesai); i++) {
    await sleep(150);
    r = await kirim('GET', `/optimize/${job2}`);
  }
  cek('job selesai walau ada yang gagal', r.json.selesai === true);
  const gagalT = r.json.target.find((t) => t.nama === 'Bermasalah');
  const sehatT = r.json.target.find((t) => t.nama === 'Sehat');
  cek('client bermasalah ditandai gagal', gagalT.status === 'gagal');
  cek('pesan aslinya diteruskan', /read-only/.test(gagalT.pesan || ''));
  cek('client sehat TETAP dioptimasi setelahnya', sehatT.status === 'selesai');

  console.log('\n=== 4. Client offline dilewati, bukan menggagalkan ===');
  r = await kirim('POST', '/optimize', { client_ids: [c3.id, c1.id] });
  const job3 = r.json.jobId;
  r = await kirim('GET', `/optimize/${job3}`);
  for (let i = 0; i < 60 && !(r.json && r.json.selesai); i++) {
    await sleep(150);
    r = await kirim('GET', `/optimize/${job3}`);
  }
  const offT = r.json.target.find((t) => t.nama === 'Offline');
  cek('client offline ditandai dilewati', offT.status === 'dilewati');
  cek('alasannya jelas', /tidak terkoneksi/i.test(offT.pesan || ''));
  cek('client lain tetap jalan', r.json.target.find((t) => t.nama === 'Sehat').status === 'selesai');

  console.log('\n=== 5. Agent diam -> timeout, tidak menggantung selamanya ===');
  const c4 = clientStore.createClient({ name: 'Diam', groupId: null });
  await agentTiruan(c4.token, { diam: true });
  await sleep(300);
  const t0 = Date.now();
  r = await kirim('POST', '/optimize', { client_ids: [c4.id] });
  const job4 = r.json.jobId;
  r = await kirim('GET', `/optimize/${job4}`);
  for (let i = 0; i < 100 && !(r.json && r.json.selesai); i++) {
    await sleep(200);
    r = await kirim('GET', `/optimize/${job4}`);
  }
  cek('berhenti oleh timeout, bukan menggantung', r.json.selesai === true);
  cek('timeout terjadi sesuai batas (~6 detik)', Date.now() - t0 < 12000);
  cek('ditandai gagal dengan pesan jelas', r.json.target[0].status === 'gagal');

  console.log('\n=== 6. Validasi masukan ===');
  r = await kirim('POST', '/optimize', {});
  cek('tanpa client -> 400', r.status === 400);
  r = await kirim('POST', '/optimize', { client_ids: ['99999'] });
  cek('client tidak dikenal -> 400', r.status === 400);
  r = await kirim('GET', '/optimize/tidakada');
  cek('job tidak dikenal -> 404', r.status === 404);

  console.log('\n=== 7. Hasil dari agent dibersihkan sebelum dipakai ===');
  const c5 = clientStore.createClient({ name: 'Nakal', groupId: null });
  const wsN = new WebSocket(`ws://127.0.0.1:31988/agent?token=${c5.token}`);
  await new Promise((res) => wsN.on('open', res));
  wsN.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type !== 'optimize') return;
    // Kirim tipe yang salah dan teks sangat panjang.
    wsN.send(JSON.stringify({
      type: 'optimize_result', id: m.id, ok: true,
      hematBytes: 'banyak sekali',
      langkah: [{ nama: 'x'.repeat(500), ok: 'ya', pesan: 'y'.repeat(2000) }],
      dilewati: Array(100).fill('z'.repeat(50)),
      memTersediaMb: -5,
    }));
  });
  await sleep(200);
  r = await kirim('POST', '/optimize', { client_ids: [c5.id] });
  const job5 = r.json.jobId;
  r = await kirim('GET', `/optimize/${job5}`);
  for (let i = 0; i < 40 && !(r.json && r.json.selesai); i++) {
    await sleep(150);
    r = await kirim('GET', `/optimize/${job5}`);
  }
  const n = r.json.target[0];
  cek('hematBytes bukan angka -> null, bukan string', n.hematBytes === 0 || n.hematBytes === null);
  cek('nama langkah dipotong', n.langkah[0].nama.length <= 120);
  cek('pesan langkah dipotong', (n.langkah[0].pesan || '').length <= 300);
  cek('ok non-boolean jadi boolean', typeof n.langkah[0].ok === 'boolean');
  cek('daftar dilewati dibatasi', n.dilewati.length <= 30);
  cek('angka negatif ditolak', n.memTersediaMb === null);

  console.log('\n=== 8. Hasil optimasi besar tapi SAH tidak memutus agent ===');
  // Regresi: batas pesan sempat 8 KB, sementara hasil optimasi dengan banyak
  // langkah (batas validator: 30 langkah, nama 120, pesan 300) bisa ~17 KB.
  // Agent yang jujur akan diputus di tengah pelaporan.
  const c6 = clientStore.createClient({ name: 'Banyak Langkah', groupId: null });
  const ws6 = new WebSocket(`ws://127.0.0.1:31988/agent?token=${c6.token}`);
  await new Promise((res) => ws6.on('open', res));
  let terputus = false;
  ws6.on('close', () => { terputus = true; });
  ws6.on('message', (raw) => {
    const mm = JSON.parse(raw.toString());
    if (mm.type !== 'optimize') return;
    ws6.send(JSON.stringify({
      type: 'optimize_result', id: mm.id, ok: true, hematBytes: 1234,
      langkah: Array(30).fill(0).map((_, i) => ({
        nama: 'langkah ' + i + ' ' + 'n'.repeat(100),
        ok: true,
        pesan: 'p'.repeat(290),
      })),
      dilewati: Array(30).fill('d'.repeat(110)),
      memTotalMb: 32134, memTersediaMb: 29840,
    }));
  });
  await sleep(200);
  r = await kirim('POST', '/optimize', { client_ids: [c6.id] });
  const job6 = r.json.jobId;
  r = await kirim('GET', `/optimize/${job6}`);
  for (let i = 0; i < 40 && !(r.json && r.json.selesai); i++) {
    await sleep(150);
    r = await kirim('GET', `/optimize/${job6}`);
  }
  cek('agent TIDAK diputus karena ukuran pesan', !terputus);
  cek('hasil besar tetap diterima', r.json.target[0].status === 'selesai');
  cek('semua 30 langkah terbawa', r.json.target[0].langkah.length === 30);

  console.log('\n=== 9. Agent PUTUS di tengah optimasi tidak menggantung ===');
  // Regresi: pendingOptimize tidak dibersihkan saat koneksi putus, jadi
  // permintaannya menggantung sampai timeout 15 menit sementara dashboard
  // menampilkan "memulai…" tanpa perubahan. Terjadi saat agent di-restart
  // oleh "Update semua" beberapa saat setelah optimasi dimulai.
  const c7 = clientStore.createClient({ name: 'Putus Tengah', groupId: null });
  const ws7 = new WebSocket(`ws://127.0.0.1:31988/agent?token=${c7.token}`);
  await new Promise((res) => ws7.on('open', res));
  ws7.on('message', (raw) => {
    const mm = JSON.parse(raw.toString());
    if (mm.type !== 'optimize') return;
    ws7.send(JSON.stringify({ type: 'optimize_progress', id: mm.id, nomor: 0, total: 0, nama: 'memulai…' }));
    // Meniru agent yang mati/restart di tengah kerja.
    setTimeout(() => ws7.terminate(), 120);
  });
  await sleep(200);

  const tPutus = Date.now();
  r = await kirim('POST', '/optimize', { client_ids: [c7.id] });
  const job7 = r.json.jobId;
  r = await kirim('GET', `/optimize/${job7}`);
  for (let i = 0; i < 60 && !(r.json && r.json.selesai); i++) {
    await sleep(150);
    r = await kirim('GET', `/optimize/${job7}`);
  }
  const lamaPutus = Date.now() - tPutus;
  cek('selesai cepat, tidak menunggu timeout', lamaPutus < 5000);
  cek('ditandai gagal, bukan menggantung', r.json.target[0].status === 'gagal');
  cek('pesannya menjelaskan sebabnya', /terputus/i.test(r.json.target[0].pesan || ''));

  console.log(gagal === 0 ? '\n>>> SEMUA LULUS' : `\n>>> ${gagal} GAGAL`);
  try { ws1.close(); ws2.close(); wsN.close(); } catch {}
  server.close(); db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB + s); } catch {} }
  process.exit(gagal ? 1 : 0);
})().catch((e) => { console.error('ERROR UJI:', e); process.exit(1); });
