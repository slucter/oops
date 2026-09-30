/**
 * Uji share di server LENGKAP (src/server.js), bukan aplikasi tiruan.
 * Dijalankan dari root projek: node uji/share-auth.js
 *
 * Yang dibuktikan di sini dan tidak bisa dibuktikan uji lain: route share
 * benar-benar lolos dari requireAuth, sementara SEMUA halaman lain tetap
 * terkunci. Kalau urutan middleware di server.js berubah, uji ini yang
 * menangkapnya.
 */
process.env.SESSION_SECRET = 'uji-auth';
process.env.PORT = '31990';

const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = process.cwd();
const DB = path.join(ROOT, 'data', 'uji-share-auth.sqlite');
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB + s); } catch {} }
process.env.DB_PATH = DB;

let gagal = 0;
const cek = (l, c) => { if (!c) { gagal++; console.log('GAGAL  ' + l); } else console.log('  OK  ' + l); };

function get(pathname) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 31990, path: pathname }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b, location: res.headers.location || '' }));
    }).on('error', (e) => resolve({ status: 0, body: e.message, location: '' }));
  });
}

function post(pathname) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: 31990, path: pathname, method: 'POST' }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b, location: res.headers.location || '' }));
    });
    r.on('error', (e) => resolve({ status: 0, body: e.message, location: '' }));
    r.end();
  });
}

(async () => {
  const db = require('../src/db');
  const clientStore = require('../src/services/clientStore');
  const shareStore = require('../src/services/shareStore');

  const c = clientStore.createClient({ name: 'AuthUji', groupId: null });
  db.prepare("UPDATE clients SET status='up', hostname='auth-host', last_seen_at=datetime('now') WHERE id=?").run(c.id);
  db.prepare('INSERT INTO client_metrics (client_id, mem_total_mb, mem_used_mb) VALUES (?,?,?)').run(c.id, 100, 50);

  const { token } = shareStore.createShare({ scope: 'dashboard', clientIds: [c.id], expiresMinutes: 60 });

  // Jalankan server lengkap apa adanya.
  require('../src/server');
  await new Promise((r) => setTimeout(r, 1200));

  console.log('=== Halaman berlogin harus MENOLAK tanpa sesi ===');
  for (const p of ['/', `/client/${c.id}`, '/groups', '/settings', '/shares', '/clients/new']) {
    const r = await get(p);
    cek(`${p.padEnd(18)} -> redirect ke login`, r.status === 302 && r.location.includes('/login'));
  }

  console.log('\n=== Aksi yang mengubah data harus ditolak tanpa sesi ===');
  for (const p of [`/clients/${c.id}/delete`, `/clients/${c.id}/update-agent`, `/clients/${c.id}/share`, '/shares']) {
    const r = await post(p);
    cek(`POST ${p.padEnd(28)} -> ditolak`, r.status === 302 || r.status === 401 || r.status === 403);
  }

  console.log('\n=== Halaman share harus BISA dibuka tanpa sesi ===');
  let r = await get(`/share/${token}`);
  cek('GET /share/:token -> 200 tanpa login', r.status === 200);
  cek('isinya memang halaman monitoring', r.body.includes('AuthUji') && r.body.includes('View only'));

  r = await get(`/share/${token}/client/${c.id}`);
  cek('GET detail share -> 200 tanpa login', r.status === 200 && r.body.includes('auth-host'));

  r = await get(`/share/${token}/client/${c.id}/live`);
  cek('GET live share -> 200 tanpa login', r.status === 200);

  console.log('\n=== Share tidak membuka jalan ke halaman berlogin ===');
  r = await get(`/share/${token}`);
  cek('tidak ada tautan ke "/" (dashboard asli)', !/href="\/"/.test(r.body));
  cek('tidak ada tautan ke /clients/', !r.body.includes('href="/clients/'));
  cek('tidak ada tautan ke /settings', !r.body.includes('/settings'));
  cek('semua tautan client mengarah ke jalur share',
    (r.body.match(/href="\/client\//g) || []).length === 0);

  console.log('\n=== Token dicabut langsung berhenti berlaku di server lengkap ===');
  const id = db.prepare('SELECT id FROM shares LIMIT 1').get().id;
  shareStore.revokeShare(id);
  r = await get(`/share/${token}`);
  cek('setelah dicabut -> 404', r.status === 404);

  console.log(gagal === 0 ? '\n>>> SEMUA LULUS' : `\n>>> ${gagal} GAGAL`);
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB + s); } catch {} }
  process.exit(gagal ? 1 : 0);
})().catch((e) => { console.error('ERROR UJI:', e); process.exit(1); });
