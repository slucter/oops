#!/usr/bin/env node
'use strict';

/**
 * Tolak commit yang mengubah berkas di `agent/` tanpa menaikkan versinya.
 *
 * Kenapa perlu dipaksakan, bukan cukup diingat: versi agent BUKAN catatan
 * administratif — ia adalah mekanisme update. Server membandingkan versi
 * yang ia sajikan dengan versi yang dilaporkan tiap client untuk memutuskan
 * siapa yang perlu di-update.
 *
 * Kalau kode agent berubah tapi versinya tidak, dashboard akan bilang semua
 * client sudah terbaru padahal mereka menjalankan kode lama. Tombol Update
 * tidak pernah muncul, dan tidak ada error apa pun yang memberi tahu.
 * Perbaikan yang sudah dikerjakan diam-diam tidak pernah sampai ke server
 * mana pun — kegagalan diam yang baru terasa saat ada insiden.
 *
 * Dipanggil dari pre-commit hook (lihat .githooks/pre-commit).
 * Bisa juga dijalankan manual: `npm run cek-versi-naik`
 */

const { execSync } = require('child_process');
const path = require('path');

const AGENT_DIR = 'agent/';

// Berkas di agent/ yang TIDAK ikut dikirim ke client, jadi perubahannya
// tidak menuntut kenaikan versi.
const BUKAN_KODE_AGENT = new Set([
  'agent/cek-versi.js',
  'agent/cek-versi-naik.js',
]);

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

// Berkas agent yang di-stage untuk commit ini.
const staged = git('diff --cached --name-only')
  .split('\n')
  .filter((f) => f.startsWith(AGENT_DIR) && !BUKAN_KODE_AGENT.has(f));

if (staged.length === 0) {
  process.exit(0); // tidak menyentuh kode agent: tidak ada yang perlu dicek
}

// Versi di staging area (yang akan tercatat di commit ini).
let versiBaru;
try {
  const isi = git('show :agent/version.js');
  versiBaru = (isi.match(/AGENT_VERSION\s*=\s*'([^']+)'/) || [])[1];
} catch {
  versiBaru = null;
}

if (!versiBaru) {
  // version.js tidak di-stage — ambil dari working tree.
  versiBaru = require('./version').AGENT_VERSION;
}

// Versi di HEAD (sebelum commit ini).
const isiLama = git('show HEAD:agent/version.js');
const versiLama = (isiLama.match(/AGENT_VERSION\s*=\s*'([^']+)'/) || [])[1];

if (!versiLama) {
  process.exit(0); // belum ada di HEAD (commit pertama agent): lolos
}

const urai = (v) => v.split('.').map((n) => parseInt(n, 10) || 0);
const [aM, aN, aP] = urai(versiBaru);
const [bM, bN, bP] = urai(versiLama);
const naik = aM > bM || (aM === bM && (aN > bN || (aN === bN && aP > bP)));

if (naik) {
  console.log(`Versi agent naik: v${versiLama} -> v${versiBaru}`);
  process.exit(0);
}

console.error('');
console.error('  COMMIT DITOLAK: kode agent berubah tapi versinya tidak naik.');
console.error('');
console.error(`  Versi sekarang : v${versiLama}`);
console.error('  Berkas berubah :');
for (const f of staged) console.error(`     - ${f}`);
console.error('');
console.error('  Versi agent adalah mekanisme update, bukan catatan. Tanpa kenaikan,');
console.error('  dashboard akan bilang semua client sudah terbaru padahal mereka');
console.error('  menjalankan kode lama — tanpa error apa pun yang memberi tahu.');
console.error('');
console.error('  Naikkan di KEDUA berkas ini, lalu stage keduanya:');
console.error('     agent/version.js   (AGENT_VERSION)');
console.error('     agent/agent.py     (AGENT_VERSION)');
console.error('');
console.error('  PATCH = perbaikan bug | MINOR = kemampuan baru | MAJOR = protokol berubah');
console.error('');
console.error('  Kalau perubahannya memang tidak memengaruhi client (mis. hanya');
console.error('  komentar), lewati dengan alasan yang jelas:  git commit --no-verify');
console.error('');
process.exit(1);
