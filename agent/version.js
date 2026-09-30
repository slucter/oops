'use strict';

/**
 * Versi agent — satu sumber kebenaran, dipakai dua sisi:
 * - Agent mengirimkannya saat handshake, supaya server tahu versi yang
 *   sedang jalan di tiap client.
 * - Server membandingkannya dengan versi yang sedang ia sajikan, untuk
 *   menentukan client mana yang tertinggal.
 *
 * NAIKKAN ANGKA INI setiap kali ada perubahan pada berkas di folder
 * `agent/`. Kalau lupa, dashboard akan bilang semua client sudah terbaru
 * padahal mereka menjalankan kode lama — dan tidak ada yang memberi tahu.
 *
 * Format: MAJOR.MINOR.PATCH, dibandingkan per-komponen sebagai angka
 * (lihat isNewerVersion di src/services/agentVersion.js), bukan sebagai
 * string — "1.10.0" lebih baru dari "1.9.0" meski secara string lebih kecil.
 */
const AGENT_VERSION = '1.1.0';

module.exports = { AGENT_VERSION };
