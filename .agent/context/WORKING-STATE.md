# Status Kerja Saat Ini

> **File ini adalah penyelamat saat konteks session habis atau ter-compact.**
>
> Agent: perbarui file ini **setiap kali menyelesaikan satu langkah berarti** —
> jangan tunggu akhir session. Kalau konteks tiba-tiba terpotong, file ini
> satu-satunya yang tahu kamu sedang di mana.
>
> Isinya ditimpa (bukan ditambah). Riwayat panjang tempatnya di `JOURNAL.md`.

---

**Diperbarui:** 2026-09-30
**Agent:** Claude Code (Sonnet 5)
**Branch:** master

## Sedang mengerjakan
Tahap 1b dari `.agent/context/PLAN.md` (migrasi registry server dari YAML
ke DB + form web) sudah selesai diimplementasi dan diuji manual via curl,
tapi **belum di-commit**. Perubahan lingkup ini diminta pemilik projek
setelah Tahap 1 selesai — dia mau input server lewat browser, bukan edit
file YAML.

## Kenapa
Pemilik projek memegang banyak server kantor + client, butuh dashboard
terpusat status UP/DOWN, termasuk server internal di balik jump host
(misal `user@10.10.10.10`), plus info Docker dan port listen per server.
Awalnya direncanakan pakai file `servers.yaml` manual, tapi direvisi ke
form web supaya tidak perlu akses filesystem untuk kelola server.

## Sudah dilakukan di session ini
- **Tahap 1** (fondasi, YAML-based): selesai & di-commit sebelumnya
  (root-commit `444931e`).
- **Tahap 1b** (migrasi ke DB + form web) — diimplementasi, BELUM commit:
  - `src/db/schema.sql`: tabel `servers` baru (FK `via_server_id` self-
    reference), `server_id` di tabel snapshot diubah dari TEXT ke INTEGER
    FK dengan `ON DELETE CASCADE`.
  - `src/services/serverStore.js` (baru, gantikan `serverConfig.js` yang
    sudah dihapus): CRUD server + validasi (nama/host/user wajib, `via`
    harus ada, deteksi siklus lewat `wouldCreateCycle`).
  - `src/middleware/keyUpload.js` (baru): upload key via `multer`
    (`multer@2.4.0`, sudah dicek 0 vulnerabilities), disimpan sebagai
    `data/keys/<uuid>` (nama file acak, bukan nama asli), validasi header
    PEM/OpenSSH sebelum diterima, permission diset 600, dihapus otomatis
    kalau validasi gagal atau server dihapus/key diganti.
  - `src/routes/servers.js` (baru): route `/servers/new`, POST `/servers`,
    `/servers/:id/edit` (GET+POST), `/servers/:id/delete` — semua di
    bawah `requireAuth` (didaftarkan di `server.js`).
  - `src/views/server-form.ejs` (baru): form tambah/edit dengan dropdown
    jump host (exclude diri sendiri) dan file input untuk key.
  - Update `sshClient.js`, `statusChecker.js`, `dashboardData.js`,
    `scheduler/index.js` untuk pakai `serverStore` bukan `serverConfig`.
  - Update `dashboard.ejs`/`server-detail.ejs`: `via` sekarang integer id,
    ditampilkan sebagai `viaName` (di-resolve di `dashboardData.js`).
  - Hapus `src/services/serverConfig.js`, `config/servers.example.yaml`,
    `config/servers.yaml` (folder `config/` sudah tidak ada).
  - `package.json`: hapus `js-yaml`, tambah `multer@^2.4.0`, `uuid@^11`.
  - `.gitignore`: tambah `data/keys/`.
  - Update `README.md` dan `.env.example` (hapus referensi YAML/
    `SERVERS_CONFIG_PATH`, tambah `KEYS_DIR`).
- **Diuji manual lewat curl** (server SQLite di-reset dulu, user baru
  dibuat): tambah server + upload key valid (berhasil, file tersimpan
  600), upload file bukan key (ditolak 400, file dihapus lagi), tambah
  server kedua dengan `via` ke server pertama (nama jump host tampil
  benar di dashboard), edit yang bikin siklus (ditolak dengan pesan
  jelas), hapus server yang masih jadi jump host server lain (ditolak),
  hapus server normal (key file ikut terhapus), semua route `/servers/*`
  redirect ke `/login` tanpa sesi. **Belum diuji ke server SSH nyata**
  (tidak ada SSH server di mesin dev ini) — jalur jump host (Tahap 2
  rencana awal) sama sekali belum divalidasi end-to-end ke server
  sungguhan.
- `npm audit`: 0 vulnerabilities setelah tambah multer+uuid.
- DB & folder `data/keys/` hasil testing sudah dibersihkan lagi sebelum
  sesi ini ditutup (working tree tidak ada sisa data testing).

## Langkah berikutnya yang konkret
1. **Commit perubahan Tahap 1b** (belum dilakukan — lihat "Berkas yang
   sedang disentuh" di bawah untuk daftar lengkap).
2. Update `.agent/context/PLAN.md`: tandai Tahap 1b selesai setelah commit.
3. Pemilik projek buat user produksi
   (`node src/scripts/createUser.js <user> <pass>`), lalu tambah server
   nyata lewat form `/servers/new` — minimal 1 server langsung dan 1
   server via jump host untuk memvalidasi Tahap 2 (ProxyJump) yang sampai
   sekarang masih murni teoretis, belum pernah jalan ke SSH server nyata.
4. Setelah jump host tervalidasi ke server nyata, lanjut ke Tahap 3
   (docker ps -a + sudo ss -tulnp) — kodenya sudah ada di
   `statusChecker.js` tapi juga belum diverifikasi ke server nyata yang
   punya Docker & sudoers NOPASSWD (lihat README.md).

## Yang sudah dicoba dan gagal
- (tidak ada kegagalan berarti dalam implementasi Tahap 1b)

## Berkas yang sedang disentuh
Belum di-commit, hasil `git status --short`:
```
M .agent/context/PLAN.md
M .agent/context/WORKING-STATE.md
M .env.example
M .gitignore
M README.md
D config/servers.example.yaml
M package-lock.json
M package.json
M src/db/schema.sql
M src/scheduler/index.js
M src/server.js
M src/services/dashboardData.js
D src/services/serverConfig.js
M src/services/sshClient.js
M src/services/statusChecker.js
M src/views/dashboard.ejs
M src/views/not-found.ejs
M src/views/server-detail.ejs
?? src/middleware/keyUpload.js
?? src/routes/servers.js
?? src/services/serverStore.js
?? src/views/server-form.ejs
```

## Catatan penting
- User SSH di server target WAJIB dibatasi NOPASSWD sudo hanya untuk
  `ss` (bukan full sudo) — didokumentasikan di README.md, bukan
  otomatis di-enforce oleh app.
- Database (`data/*.sqlite*`) dan folder `data/keys/` sengaja tidak
  di-commit (lihat `.gitignore`) — keduanya berisi topologi jaringan
  client dan private key yang sangat sensitif.
- Skema DB berubah (server_id TEXT → INTEGER FK) — kalau ada database
  lama dari sebelum Tahap 1b, harus dihapus & dibuat ulang (tidak ada
  migrasi otomatis, karena belum ada data produksi yang perlu dijaga).

---

## Cara memakai file ini

**Saat konteks baru saja ter-compact atau session baru dimulai di tengah kerja:**
baca file ini lebih dulu, sebelum apa pun. Dia memberi tahu posisimu persis.

**Saat selesai satu langkah:** perbarui bagian "Sudah dilakukan" dan "Langkah
berikutnya". Cukup beberapa detik, tapi menyelamatkan session kalau terpotong.

**Saat session benar-benar selesai:** jalankan `/handoff` — isinya dipindahkan
ke `JOURNAL.md` sebagai entri permanen, lalu file ini dikosongkan kembali.
