#!/usr/bin/env node
'use strict';

/**
 * Pastikan versi agent sama di semua tempat yang menyimpannya.
 *
 * agent.py menyimpan versinya sendiri sebagai konstanta Python — ia tidak
 * bisa membaca version.js. Jadi ada dua sumber yang harus dijaga tetap
 * sama secara manual, dan kalau salah satu lupa dinaikkan, dashboard akan
 * menampilkan hal yang membingungkan: client Python dan client Node
 * mengaku versi berbeda padahal dipasang dari installer yang sama.
 *
 * Dijalankan lewat `npm run cek-versi` (juga dipanggil dari `npm test`).
 */

const fs = require('fs');
const path = require('path');

const dir = __dirname;
const { AGENT_VERSION } = require('./version');

const pySource = fs.readFileSync(path.join(dir, 'agent.py'), 'utf8');
const pyMatch = pySource.match(/^AGENT_VERSION\s*=\s*'([^']+)'/m);

const masalah = [];

if (!pyMatch) {
  masalah.push('agent.py: konstanta AGENT_VERSION tidak ditemukan');
} else if (pyMatch[1] !== AGENT_VERSION) {
  masalah.push(
    `versi tidak sama — version.js: ${AGENT_VERSION}, agent.py: ${pyMatch[1]}`
  );
}

// Berkas yang di-unduh installer untuk runtime Node harus benar-benar ada,
// kalau tidak instalasi gagal di tengah dengan curl 404 yang tidak jelas.
for (const name of ['agent.js', 'agent.py', 'resourceParser.js', 'version.js', 'package.json']) {
  if (!fs.existsSync(path.join(dir, name))) {
    masalah.push(`berkas agent hilang: ${name}`);
  }
}

if (masalah.length) {
  console.error('Pemeriksaan versi agent GAGAL:');
  for (const m of masalah) console.error('  - ' + m);
  console.error('\nNaikkan versi di agent/version.js DAN agent/agent.py bersamaan.');
  process.exit(1);
}

console.log(`Versi agent konsisten: v${AGENT_VERSION} (version.js = agent.py)`);
