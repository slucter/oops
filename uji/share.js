/**
 * Uji fitur share read-only. Dijalankan dari root projek: node uji/share.js
 *
 * Fokus utamanya keamanan: halaman share bisa dibuka siapa pun yang memegang
 * URL, jadi yang diuji bukan hanya "berfungsi" tapi juga "tidak bocor dan
 * tidak bisa dipakai mengubah apa pun".
 */
process.env.SESSION_SECRET = 'uji';

const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = process.cwd();
const DB = path.join(ROOT, 'data', 'uji-share.sqlite');
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB + s); } catch {} }
process.env.DB_PATH = DB;

const express = require('express');

let gagal = 0;
const cek = (l, c) => { if (!c) { gagal++; console.log('GAGAL  ' + l); } else console.log('  OK  ' + l); };

function req(method, pathname, body) {
  return new Promise((resolve) => {
    var data = null;
    if (body) {
      var p = new URLSearchParams();
      for (var k in body) {
        var v = body[k];
        if (Array.isArray(v)) v.forEach(function (x) { p.append(k, x); });
        else p.append(k, v);
      }
      data = p.toString();
    }
    const r = http.request(
      {
        host: '127.0.0.1', port: 31992, path: pathname, method,
        headers: data
          ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data), Accept: 'application/json' }
          : { Accept: 'text/html' },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(b); } catch {}
          resolve({ status: res.statusCode, body: b, json, location: res.headers.location || '' });
        });
      }
    );
    r.on('error', (e) => resolve({ status: 0, body: e.message, json: null, location: '' }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const db = require('../src/db');
  const clientStore = require('../src/services/clientStore');
  const groupStore = require('../src/services/groupStore');
  const shareStore = require('../src/services/shareStore');

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'src', 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use(require('../src/routes/share'));
  app.use((q, s, n) => { s.locals.username = 'uji'; q.session = { username: 'uji', userId: null }; n(); });
  app.use(require('../src/routes/shareAdmin'));
  app.use(require('../src/routes/dashboard'));
  const server = app.listen(31992);

  const g = groupStore.createGroup('Grup A');
  const c1 = clientStore.createClient({ name: 'Alpha', groupId: g.id });
  const c2 = clientStore.createClient({ name: 'Beta', groupId: g.id });
  const c3 = clientStore.createClient({ name: 'Rahasia', groupId: null });
  const upd = db.prepare("UPDATE clients SET status='up', hostname=?, private_ip=?, last_seen_at=datetime('now') WHERE id=?");
  for (const [c, h, ip] of [[c1, 'alpha-host', '10.0.0.1'], [c2, 'beta-host', '10.0.0.2'], [c3, 'rahasia-host', '10.0.0.3']]) {
    upd.run(h, ip, c.id);
    db.prepare('INSERT INTO client_metrics (client_id, mem_total_mb, mem_used_mb, disk_total_gb, disk_used_gb, cpu_count) VALUES (?,?,?,?,?,?)')
      .run(c.id, 1000, 400, 100, 30, 4);
  }

  console.log('=== 1. Buat share dashboard untuk 2 dari 3 client ===');
  let r = await req('POST', '/shares', { client_ids: [c1.id, c2.id], label: 'Uji', expires_minutes: '60' });
  cek('halaman kelola membalas 200', r.status === 200);
  const m = r.body.match(/\/share\/([a-f0-9]{48})/);
  cek('URL share muncul di halaman', !!m);
  const token = m ? m[1] : null;

  console.log('\n=== 2. Halaman share bisa dibuka TANPA login ===');
  r = await req('GET', `/share/${token}`);
  cek('HTTP 200 tanpa sesi login', r.status === 200);
  cek('client yang dibagikan tampil', r.body.includes('Alpha') && r.body.includes('Beta'));
  cek('client yang TIDAK dibagikan tidak bocor', !r.body.includes('Rahasia'));
  cek('badge view-only tampil', r.body.includes('View only'));
  cek('judul share tampil sekali sebagai heading', /class="share-label-bar"/.test(r.body));
  // Regresi: EJS mewariskan local halaman induk ke partial, jadi local
  // "label" milik halaman share pernah tertangkap partial usage-bar (yang
  // dulu juga menamai local opsionalnya "label") — nama link bocor ke SETIAP
  // sel RAM dan Disk. Partial itu kini memakai "barLabel".
  cek('judul TIDAK bocor ke sel RAM/Disk',
    (r.body.match(/class="usage-label">[^<]*Uji/g) || []).length === 0);

  console.log('\n=== 3. Halaman share tidak menawarkan aksi apa pun ===');
  cek('tidak ada tombol Remove', !/class="[^"]*btn-danger/.test(r.body));
  cek('tidak ada tombol Update agent', !r.body.includes('update-agent-btn'));
  cek('tidak ada link Edit client', !r.body.includes('/clients/'));
  cek('tidak ada form POST', !/<form[^>]*method=["']post/i.test(r.body));
  cek('tidak ada menu Master/profil', !/<div[^>]+data-dropdown[s>]/.test(r.body));

  console.log('\n=== 4. Token tidak bisa dipakai melihat client lain ===');
  r = await req('GET', `/share/${token}/client/${c1.id}`);
  cek('client yang termasuk share bisa dibuka', r.status === 200 && r.body.includes('alpha-host'));
  r = await req('GET', `/share/${token}/client/${c3.id}`);
  cek('client di LUAR share ditolak 404', r.status === 404);
  cek('dan tidak membocorkan namanya', !r.body.includes('Rahasia'));
  r = await req('GET', `/share/${token}/client/${c3.id}/live`);
  cek('endpoint live juga menolak client luar', r.status === 404);

  console.log('\n=== 5. Token tidak valid ===');
  r = await req('GET', '/share/tokenngawur123');
  cek('token ngawur -> 404', r.status === 404);
  cek('pesannya tidak membedakan sebab', r.body.includes('tidak berlaku'));

  console.log('\n=== 6. Token disimpan sebagai hash, bukan aslinya ===');
  const baris = db.prepare('SELECT token_hash FROM shares LIMIT 1').get();
  cek('kolom token_hash bukan token mentah', baris.token_hash !== token);
  cek('hash cocok saat diverifikasi', baris.token_hash === shareStore.hashToken(token));
  const semuaKolom = db.prepare('SELECT * FROM shares LIMIT 1').get();
  cek('tidak ada kolom yang menyimpan token mentah',
    !Object.values(semuaKolom).some((v) => typeof v === 'string' && v === token));

  console.log('\n=== 7. Cabut link berlaku seketika ===');
  const shareId = db.prepare('SELECT id FROM shares LIMIT 1').get().id;
  r = await req('GET', `/share/${token}`);
  cek('sebelum dicabut: bisa dibuka', r.status === 200);
  await req('POST', `/shares/${shareId}/revoke`);
  r = await req('GET', `/share/${token}`);
  cek('setelah dicabut: 404', r.status === 404);
  r = await req('GET', `/share/${token}/client/${c1.id}`);
  cek('detailnya ikut mati', r.status === 404);

  console.log('\n=== 8. Kedaluwarsa dihormati ===');
  const { token: tKadaluarsa, id: idKadaluarsa } = shareStore.createShare({
    scope: 'dashboard', clientIds: [c1.id], expiresMinutes: 60,
  });
  r = await req('GET', `/share/${tKadaluarsa}`);
  cek('masih berlaku -> 200', r.status === 200);
  // Mundurkan expires_at ke masa lalu.
  db.prepare("UPDATE shares SET expires_at = datetime('now', '-1 minute') WHERE id = ?").run(idKadaluarsa);
  r = await req('GET', `/share/${tKadaluarsa}`);
  cek('sudah lewat -> 404', r.status === 404);

  console.log('\n=== 9. Tanpa batas (0 menit) ===');
  const { token: tAbadi, id: idAbadi } = shareStore.createShare({
    scope: 'dashboard', clientIds: [c1.id], expiresMinutes: 0,
  });
  cek('expires_at NULL', db.prepare('SELECT expires_at e FROM shares WHERE id=?').get(idAbadi).e === null);
  r = await req('GET', `/share/${tAbadi}`);
  cek('bisa dibuka', r.status === 200);

  console.log('\n=== 10. Share per-client lewat tombol di baris tabel ===');
  r = await req('POST', `/clients/${c3.id}/share`, { expires_minutes: '30' });
  cek('membalas JSON berisi url', r.status === 200 && r.json && /\/share\/[a-f0-9]{48}/.test(r.json.url));
  const tKlien = r.json.url.split('/share/')[1];
  r = await req('GET', `/share/${tKlien}`);
  cek('diarahkan ke halaman detailnya', r.status === 302 && r.location.includes(`/client/${c3.id}`));
  r = await req('GET', `/share/${tKlien}/client/${c3.id}`);
  cek('detail client itu terbuka', r.status === 200 && r.body.includes('rahasia-host'));
  cek('tidak ada tombol kembali ke daftar', !r.body.includes('Semua client'));
  r = await req('GET', `/share/${tKlien}/client/${c1.id}`);
  cek('client lain tetap ditolak', r.status === 404);

  console.log('\n=== 11. Masa berlaku tidak valid ditolak ===');
  r = await req('POST', `/clients/${c1.id}/share`, { expires_minutes: 'abc' });
  cek('bukan angka -> 400', r.status === 400);
  r = await req('POST', `/clients/${c1.id}/share`, { expires_minutes: '-5' });
  cek('negatif -> 400', r.status === 400);
  r = await req('POST', `/clients/${c1.id}/share`, { expires_minutes: '99999999' });
  cek('terlalu besar -> 400', r.status === 400);

  console.log('\n=== 12. Share tidak melebar saat client baru masuk grup ===');
  const { token: tGrup } = shareStore.createShare({ scope: 'dashboard', clientIds: [c1.id, c2.id] });
  const cBaru = clientStore.createClient({ name: 'ClientBaru', groupId: g.id });
  upd.run('baru-host', '10.0.0.9', cBaru.id);
  r = await req('GET', `/share/${tGrup}`);
  cek('client baru di grup sama TIDAK ikut terbagikan', !r.body.includes('ClientBaru'));

  console.log('\n=== 13. Statistik kunjungan tercatat ===');
  const sebelum = db.prepare('SELECT view_count v FROM shares WHERE id=?').get(idAbadi).v;
  await req('GET', `/share/${tAbadi}`);
  const sesudah = db.prepare('SELECT view_count v FROM shares WHERE id=?').get(idAbadi).v;
  cek('view_count bertambah', sesudah > sebelum);

  console.log(gagal === 0 ? '\n>>> SEMUA LULUS' : `\n>>> ${gagal} GAGAL`);
  server.close(); db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB + s); } catch {} }
  process.exit(gagal ? 1 : 0);
})().catch((e) => { console.error('ERROR UJI:', e); process.exit(1); });
