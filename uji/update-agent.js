/**
 * Dijalankan dari root projek: node uji/update-agent.js
 *
 * Uji alur update agent ujung ke ujung dengan agent tiruan.
 * Dijalankan dari root projek; DB memakai berkas terpisah.
 */
process.env.SESSION_SECRET = 'uji';
process.env.PORT = '31999';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:31999';
process.env.AGENT_UPDATE_TIMEOUT_MS = '6000';

const path = require('path');
const fs = require('fs');
const ROOT = process.cwd();
const DB = path.join(ROOT, 'data', 'uji-update.sqlite');
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB + s); } catch {} }
process.env.DB_PATH = DB;

const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
const http = require('http');

let gagal = 0;
const cek = (label, cond) => {
  if (!cond) { gagal++; console.log('GAGAL  ' + label); }
  else console.log('  OK  ' + label);
};

function post(pathname) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: 31999, path: pathname, method: 'POST', headers: { Accept: 'application/json' } },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(b); } catch {}
          resolve({ status: res.statusCode, json, raw: b });
        });
      }
    );
    req.on('error', (e) => resolve({ status: 0, json: null, raw: e.message }));
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = require(path.join(ROOT, 'src', 'db'));
  const clientStore = require(path.join(ROOT, 'src', 'services', 'clientStore'));
  const agentVersion = require(path.join(ROOT, 'src', 'services', 'agentVersion'));
  const wsServer = require(path.join(ROOT, 'src', 'ws', 'server'));
  const dash = require(path.join(ROOT, 'src', 'services', 'clientDashboardData'));
  const VBARU = agentVersion.LATEST_AGENT_VERSION;

  // Bypass auth supaya bisa menguji route tanpa session.
  const express = require(path.join(ROOT, 'node_modules', 'express'));
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => { req.session = { username: 'uji' }; next(); });
  app.use(require(path.join(ROOT, 'src', 'routes', 'clients')));
  const server = app.listen(31999);
  wsServer.attach(server);

  const c = clientStore.createClient({ name: 'Uji Update', groupId: null });
  console.log('\n=== 1. Agent LAMA (tidak kirim agentVersion) ===');

  const lama = new WebSocket(`ws://127.0.0.1:31999/agent?token=${c.token}`);
  await new Promise((r) => lama.on('open', r));
  lama.send(JSON.stringify({ type: 'metric', memTotalMb: 1024, memUsedMb: 512, hostname: 'uji-host' }));
  await sleep(300);

  let row = clientStore.getClientById(c.id);
  cek('agent lama tersimpan dengan agent_version NULL', row.agentVersion === null);
  cek('needsUpdate = true untuk agent lama', agentVersion.needsUpdate(row) === true);
  cek('dashboard menandai perlu update', dash.countClientsNeedingUpdate() === 1);

  console.log('\n=== 2. Perintah update diterima agent ===');
  let perintah = null;
  lama.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'update_agent') {
      perintah = m;
      lama.send(JSON.stringify({ type: 'update_result', id: m.id, ok: true, message: 'Berhasil.', version: VBARU }));
    }
  });

  let res = await post(`/clients/${c.id}/update-agent`);
  cek('HTTP 200 saat update berhasil', res.status === 200);
  cek('balasan ok:true', res.json && res.json.ok === true);
  cek('agent benar-benar menerima perintah update_agent', perintah !== null);

  console.log('\n=== 3. Agent BARU melaporkan versi ===');
  lama.send(JSON.stringify({ type: 'metric', memTotalMb: 1024, memUsedMb: 512, hostname: 'uji-host', agentVersion: VBARU }));
  await sleep(300);
  row = clientStore.getClientById(c.id);
  cek('agent_version tersimpan', row.agentVersion === VBARU);
  cek('agent_updated_at terisi', !!row.agentUpdatedAt);
  cek('needsUpdate jadi false', agentVersion.needsUpdate(row) === false);
  cek('dashboard: tidak ada lagi yang perlu update', dash.countClientsNeedingUpdate() === 0);

  console.log('\n=== 4. Downgrade terdeteksi (bukan tertahan COALESCE) ===');
  lama.send(JSON.stringify({ type: 'metric', memTotalMb: 1024, hostname: 'uji-host', agentVersion: '1.0.0' }));
  await sleep(300);
  row = clientStore.getClientById(c.id);
  cek('versi turun ke 1.0.0 (tidak tertahan nilai lama)', row.agentVersion === '1.0.0');
  cek('needsUpdate kembali true', agentVersion.needsUpdate(row) === true);

  console.log('\n=== 5. Agent putus saat restart = dianggap SUKSES ===');
  const c2 = clientStore.createClient({ name: 'Uji Putus', groupId: null });
  const ws2 = new WebSocket(`ws://127.0.0.1:31999/agent?token=${c2.token}`);
  await new Promise((r) => ws2.on('open', r));
  ws2.send(JSON.stringify({ type: 'metric', memTotalMb: 512, hostname: 'h2' }));
  await sleep(200);
  ws2.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    // Meniru agent yang langsung restart tanpa sempat membalas.
    if (m.type === 'update_agent') setTimeout(() => ws2.terminate(), 100);
  });
  const mulai = Date.now();
  res = await post(`/clients/${c2.id}/update-agent`);
  const durasi = Date.now() - mulai;
  cek('tidak menunggu sampai timeout (< 3 detik)', durasi < 3000);
  cek('putus koneksi dilaporkan sukses, bukan gagal', res.status === 200 && res.json.ok === true);

  console.log('\n=== 6. Client OFFLINE tidak bisa di-update ===');
  const c3 = clientStore.createClient({ name: 'Uji Offline', groupId: null });
  res = await post(`/clients/${c3.id}/update-agent`);
  cek('HTTP 502 untuk client tidak terkoneksi', res.status === 502);
  cek('pesan errornya jelas', res.json && /tidak sedang terkoneksi/i.test(res.json.error));

  console.log('\n=== 7. Update massal ===');
  res = await post('/clients/update-agent-all');
  cek('update-agent-all balas 200', res.status === 200);
  cek('hanya menargetkan yang terkoneksi & tertinggal', res.json && res.json.total === 1);

  console.log('\n=== 8. Client tidak ada ===');
  res = await post('/clients/99999/update-agent');
  cek('HTTP 404 untuk id tidak dikenal', res.status === 404);

  console.log('\n=== 9. Agent gagal update -> dilaporkan gagal ===');
  const c4 = clientStore.createClient({ name: 'Uji Gagal', groupId: null });
  const ws4 = new WebSocket(`ws://127.0.0.1:31999/agent?token=${c4.token}`);
  await new Promise((r) => ws4.on('open', r));
  ws4.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'update_agent') {
      ws4.send(JSON.stringify({ type: 'update_result', id: m.id, ok: false, message: 'curl: connection refused' }));
    }
  });
  res = await post(`/clients/${c4.id}/update-agent`);
  cek('kegagalan agent jadi HTTP 502', res.status === 502);
  cek('pesan asli dari agent diteruskan', res.json && /connection refused/.test(res.json.error));

  console.log(gagal === 0 ? '\n>>> SEMUA LULUS' : `\n>>> ${gagal} GAGAL`);
  try { lama.close(); ws4.close(); } catch {}
  server.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB + s); } catch {} }
  process.exit(gagal ? 1 : 0);
})().catch((e) => { console.error('ERROR UJI:', e); process.exit(1); });
