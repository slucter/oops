/**
 * Periksa urutan lapisan (z-index) masih benar.
 * Dijalankan dari root projek: node uji/lapisan-css.js
 *
 * Kenapa perlu diuji: z-index tidak gagal dengan error apa pun. Elemen
 * hanya muncul di lapisan yang salah, dan baru ketahuan kalau ada yang
 * melihat layarnya. Itu terjadi pada dropdown navbar — `header` dan `main`
 * sama-sama z-index 1, dan saat setara yang menang adalah elemen yang
 * muncul belakangan di HTML (main). Tombol di dalam tabel menembus menu
 * profil, dan z-index 60 pada dropdown tidak menolong karena anak tidak
 * bisa melampaui lapisan induknya.
 */
const fs = require('fs');
const path = require('path');

// Komentar dibuang dulu: teks di dalamnya ikut terbaca sebagai bagian
// selector dan membuat pencocokan meleset.
const css = fs.readFileSync(
  path.join(process.cwd(), 'src', 'views', 'partials', 'layout-head.ejs'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

let gagal = 0;
const cek = (l, c) => { if (!c) { gagal++; console.log('GAGAL  ' + l); } else console.log('  OK  ' + l); };

/** Ambil z-index dari blok aturan pertama yang selectornya persis `sel`. */
function zIndex(sel) {
  const blokRe = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = blokRe.exec(css)) !== null) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (selector !== sel) continue;
    const z = m[2].match(/z-index:\s*(-?\d+)/);
    if (z) return parseInt(z[1], 10);
  }
  return null;
}

const header = zIndex('header');
const main = zIndex('main, .auth-wrap');
const dropdown = zIndex('.dropdown-menu');
const modal = zIndex('.modal-backdrop');

console.log('z-index terbaca:');
console.log('  header         : ' + header);
console.log('  main           : ' + main);
console.log('  .dropdown-menu : ' + dropdown);
console.log('  .modal-backdrop: ' + modal);
console.log('');

cek('header & main punya z-index eksplisit', header != null && main != null);
cek('header DI ATAS main (dropdown tidak tertembus tombol tabel)', header > main);
cek('modal di atas header (dialog menutupi navbar)', modal != null && modal > header);
cek('dropdown punya lapisan sendiri di dalam header', dropdown != null && dropdown > 0);

console.log(gagal === 0 ? '\n>>> LAPISAN BENAR' : `\n>>> ${gagal} MASALAH`);
process.exit(gagal ? 1 : 0);
