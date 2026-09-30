/**
 * Periksa JavaScript di dalam setiap halaman benar-benar bisa di-parse.
 * Dijalankan dari root projek: node uji/view-js.js
 *
 * Kenapa perlu: skrip yang rusak sintaksnya TIDAK menghasilkan error apa pun
 * di sisi server — halaman tetap HTTP 200 dan tampak normal. Yang terjadi,
 * browser berhenti mengeksekusi blok itu, sehingga tombolnya diam saat
 * diklik. Persis itu yang terjadi pada tombol Optimize di halaman detail:
 * string confirm() terpotong di tengah baris, addEventListener tidak pernah
 * terpasang, dan tidak ada satu pun uji yang menangkapnya karena semuanya
 * hanya mencocokkan teks HTML.
 */
process.env.SESSION_SECRET = 'uji';
process.env.DB_PATH = require('path').join(process.cwd(), 'data', 'uji-viewjs.sqlite');

const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const express = require('express');

for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(process.env.DB_PATH + s); } catch {} }

let gagal = 0;
const cek = (l, c) => { if (!c) { gagal++; console.log('GAGAL  ' + l); } else console.log('  OK  ' + l); };

const db = require('../src/db');
const clientStore = require('../src/services/clientStore');
const groupStore = require('../src/services/groupStore');
const shareStore = require('../src/services/shareStore');

const g = groupStore.createGroup('Grup');
const c = clientStore.createClient({ name: 'Alpha', groupId: g.id });
db.prepare("UPDATE clients SET status='up',hostname='h',private_ip='10.0.0.1',last_seen_at=datetime('now'),agent_version='1.3.0' WHERE id=?").run(c.id);
db.prepare('INSERT INTO client_metrics (client_id,mem_total_mb,mem_used_mb,disk_total_gb,disk_used_gb,cpu_count) VALUES (?,?,?,?,?,?)').run(c.id, 1000, 400, 100, 30, 4);
const { token } = shareStore.createShare({ scope: 'dashboard', clientIds: [c.id], label: 'Uji', expiresMinutes: 60 });

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'src', 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(require('../src/routes/share'));
app.use((q, s, n) => { s.locals.username = 'uji'; q.session = { username: 'uji' }; n(); });
app.use(require('../src/routes/dashboard'));
app.use(require('../src/routes/groups'));
app.use(require('../src/routes/settings'));
app.use(require('../src/routes/shareAdmin'));

const HALAMAN = [
  ['dashboard', '/'],
  ['detail client', '/client/' + c.id],
  ['group', '/groups'],
  ['setting', '/settings'],
  ['link share', '/shares'],
  ['share dashboard', '/share/' + token],
  ['share detail', '/share/' + token + '/client/' + c.id],
];

function ambil(p) {
  return new Promise((r) => http.get({ host: '127.0.0.1', port: 31986, path: p }, (res) => {
    let b = '';
    res.on('data', (d) => (b += d));
    res.on('end', () => r({ status: res.statusCode, html: b }));
  }).on('error', (e) => r({ status: 0, html: e.message })));
}

/** Ambil isi tiap <script> yang bukan rujukan src. */
function blokSkrip(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    out.push({ atribut: m[1].trim(), isi: m[2] });
  }
  return out;
}

const srv = app.listen(31986, async () => {
  for (const [nama, p] of HALAMAN) {
    const r = await ambil(p);
    if (r.status !== 200) {
      gagal++;
      console.log(`GAGAL  ${nama}: HTTP ${r.status}`);
      continue;
    }

    const blok = blokSkrip(r.html);
    let rusak = 0;
    blok.forEach((b, i) => {
      if (!b.isi.trim()) return;
      try {
        // Hanya di-parse, tidak dijalankan: yang dicari kesalahan sintaks,
        // bukan perilaku (tidak ada document/window di sini).
        new vm.Script(b.isi, { filename: `${nama}#script${i + 1}` });
      } catch (err) {
        rusak++;
        gagal++;
        console.log(`GAGAL  ${nama} · blok skrip #${i + 1}: ${err.message}`);
        const baris = b.isi.split('\n').slice(0, 3).join('\n       ');
        console.log(`       awal blok: ${baris.slice(0, 160)}`);
      }
    });
    if (rusak === 0) console.log(`  OK  ${nama.padEnd(16)} (${blok.length} blok skrip, semua valid)`);
  }

  console.log(gagal === 0 ? '\n>>> SEMUA SKRIP HALAMAN VALID' : `\n>>> ${gagal} MASALAH`);
  srv.close(); db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(process.env.DB_PATH + s); } catch {} }
  process.exit(gagal ? 1 : 0);
});
