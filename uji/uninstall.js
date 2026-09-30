/**
 * Dijalankan dari root projek: node uji/uninstall.js
 * Uji alur hapus client + uninstall agent. */
process.env.SESSION_SECRET = 'uji';
process.env.AGENT_UNINSTALL_TIMEOUT_MS = '4000';

const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = process.cwd();
const DB = path.join(ROOT, 'data', 'uji-uninstall.sqlite');
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB + s); } catch {} }
process.env.DB_PATH = DB;

const WebSocket = require('ws');
const express = require('express');

let gagal = 0;
const cek = (l, c) => { if (!c) { gagal++; console.log('GAGAL  ' + l); } else console.log('  OK  ' + l); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(pathname) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: 31994, path: pathname, method: 'POST' },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || '', body: b }));
      }
    );
    req.on('error', (e) => resolve({ status: 0, location: '', body: e.message }));
    req.end();
  });
}

(async () => {
  const db = require('../src/db');
  const clientStore = require('../src/services/clientStore');
  const wsServer = require('../src/ws/server');

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'src', 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => { res.locals.username = 'uji'; req.session = { username: 'uji' }; next(); });
  app.use(require('../src/routes/clients'));
  app.use(require('../src/routes/dashboard'));
  const server = app.listen(31994);
  wsServer.attach(server);

  console.log('=== 1. Client ONLINE: agent harus menerima perintah uninstall ===');
  const c1 = clientStore.createClient({ name: 'Online', groupId: null });
  const ws1 = new WebSocket(`ws://127.0.0.1:31994/agent?token=${c1.token}`);
  await new Promise((r) => ws1.on('open', r));
  ws1.send(JSON.stringify({ type: 'metric', memTotalMb: 100, hostname: 'h1', agentVersion: '1.2.0' }));
  await sleep(300);

  let terima = null;
  ws1.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'uninstall_agent') {
      terima = m;
      ws1.send(JSON.stringify({ type: 'uninstall_result', id: m.id, ok: true, message: 'Agent dicabut.' }));
    }
  });

  let res = await post(`/clients/${c1.id}/delete`);
  cek('redirect setelah hapus', res.status === 302);
  cek('agent BENAR-BENAR menerima perintah uninstall', terima !== null);
  cek('tidak ada penanda sisa (uninstall sukses)', !res.location.includes('sisa=1'));
  cek('client terhapus dari DB', clientStore.getClientById(c1.id) === null);

  console.log('\n=== 2. Client OFFLINE: tetap terhapus + diberi tahu ada sisa ===');
  const c2 = clientStore.createClient({ name: 'Offline', groupId: null });
  const mulai = Date.now();
  res = await post(`/clients/${c2.id}/delete`);
  cek('tidak menunggu timeout (< 2 detik)', Date.now() - mulai < 2000);
  cek('client tetap terhapus walau agent offline', clientStore.getClientById(c2.id) === null);
  cek('diberi penanda sisa=1', res.location.includes('sisa=1'));

  console.log('\n=== 3. Agent putus saat mencabut diri = SUKSES, bukan timeout ===');
  const c3 = clientStore.createClient({ name: 'Putus', groupId: null });
  const ws3 = new WebSocket(`ws://127.0.0.1:31994/agent?token=${c3.token}`);
  await new Promise((r) => ws3.on('open', r));
  ws3.send(JSON.stringify({ type: 'metric', memTotalMb: 100, hostname: 'h3' }));
  await sleep(200);
  ws3.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'uninstall_agent') setTimeout(() => ws3.terminate(), 80);
  });
  const t3 = Date.now();
  res = await post(`/clients/${c3.id}/delete`);
  cek('tidak menunggu sampai timeout (< 3 detik)', Date.now() - t3 < 3000);
  cek('putus koneksi dibaca sukses, bukan sisa', !res.location.includes('sisa=1'));

  console.log('\n=== 4. Agent gagal mencabut -> tetap dihapus, ditandai sisa ===');
  const c4 = clientStore.createClient({ name: 'Gagal', groupId: null });
  const ws4 = new WebSocket(`ws://127.0.0.1:31994/agent?token=${c4.token}`);
  await new Promise((r) => ws4.on('open', r));
  ws4.send(JSON.stringify({ type: 'metric', memTotalMb: 100, hostname: 'h4' }));
  await sleep(200);
  ws4.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'uninstall_agent') {
      ws4.send(JSON.stringify({ type: 'uninstall_result', id: m.id, ok: false, message: 'systemctl tidak ada' }));
    }
  });
  res = await post(`/clients/${c4.id}/delete`);
  cek('client tetap terhapus walau uninstall gagal', clientStore.getClientById(c4.id) === null);
  cek('ditandai sisa=1', res.location.includes('sisa=1'));

  console.log('\n=== 5. Data turunan ikut terhapus (CASCADE) ===');
  const c5 = clientStore.createClient({ name: 'Cascade', groupId: null });
  db.prepare('INSERT INTO client_metrics (client_id, mem_total_mb) VALUES (?,?)').run(c5.id, 100);
  db.prepare('INSERT INTO status_history (client_id, from_status, to_status) VALUES (?,?,?)').run(c5.id, 'up', 'down');
  db.prepare("INSERT INTO alerts (client_id, kind, severity, message) VALUES (?,?,?,?)").run(c5.id, 'disk', 'warning', 'x');
  db.prepare("INSERT INTO client_command_results (client_id, command, output) VALUES (?,?,?)").run(c5.id, 'docker_ps', 'x');
  const sebelum = {
    m: db.prepare('SELECT COUNT(*) n FROM client_metrics WHERE client_id=?').get(c5.id).n,
    s: db.prepare('SELECT COUNT(*) n FROM status_history WHERE client_id=?').get(c5.id).n,
    a: db.prepare('SELECT COUNT(*) n FROM alerts WHERE client_id=?').get(c5.id).n,
    c: db.prepare('SELECT COUNT(*) n FROM client_command_results WHERE client_id=?').get(c5.id).n,
  };
  cek('data turunan tercipta dulu', sebelum.m === 1 && sebelum.s === 1 && sebelum.a === 1 && sebelum.c === 1);
  await post(`/clients/${c5.id}/delete`);
  const sesudah = {
    m: db.prepare('SELECT COUNT(*) n FROM client_metrics WHERE client_id=?').get(c5.id).n,
    s: db.prepare('SELECT COUNT(*) n FROM status_history WHERE client_id=?').get(c5.id).n,
    a: db.prepare('SELECT COUNT(*) n FROM alerts WHERE client_id=?').get(c5.id).n,
    c: db.prepare('SELECT COUNT(*) n FROM client_command_results WHERE client_id=?').get(c5.id).n,
  };
  cek('metrik ikut terhapus', sesudah.m === 0);
  cek('riwayat status ikut terhapus', sesudah.s === 0);
  cek('alert ikut terhapus', sesudah.a === 0);
  cek('hasil command ikut terhapus', sesudah.c === 0);

  console.log('\n=== 6. Token dicabut -> koneksi baru ditolak 401 ===');
  const c6 = clientStore.createClient({ name: 'Token', groupId: null });
  const tokenLama = c6.token;
  clientStore.deleteClient(c6.id);
  const kode = await new Promise((resolve) => {
    const w = new WebSocket(`ws://127.0.0.1:31994/agent?token=${tokenLama}`);
    w.on('unexpected-response', (_q, r) => { r.resume(); resolve(r.statusCode); });
    w.on('open', () => { w.close(); resolve(200); });
    w.on('error', () => resolve(0));
    setTimeout(() => resolve(-1), 3000);
  });
  cek('server menjawab 401 untuk token yang dicabut', kode === 401);

  console.log('\n=== 7. Banner hasil hapus terender ===');
  const html = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 31994, path: '/?dihapus=Contoh&sisa=1' }, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve(b));
    });
  });
  cek('banner sisa muncul', html.includes('class=\"banner-sisa\"'));
  cek('nama client muncul di banner', html.includes('Contoh'));
  cek('perintah pembersihan disertakan', html.includes('rm -rf ~/.oops-agent'));
  const html2 = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 31994, path: '/?dihapus=Contoh' }, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve(b));
    });
  });
  cek('banner sukses muncul saat tanpa sisa', html2.includes('class=\"banner-ok\"') && !html2.includes('class=\"banner-sisa\"'));

  console.log(gagal === 0 ? '\n>>> SEMUA LULUS' : `\n>>> ${gagal} GAGAL`);
  try { ws1.close(); ws4.close(); } catch {}
  server.close(); db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB + s); } catch {} }
  process.exit(gagal ? 1 : 0);
})().catch((e) => { console.error('ERROR UJI:', e); process.exit(1); });
