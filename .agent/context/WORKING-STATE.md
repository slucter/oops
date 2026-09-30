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
Tahap 1c dari `.agent/context/PLAN.md` (auto-discovery private key dari
`~/.ssh/`, hapus upload key lewat form) sudah selesai diimplementasi DAN
**tervalidasi ke server SSH nyata milik pemilik projek**
(`iyan@36.88.32.238:1031`). Belum di-commit.

## Kenapa
Pemilik projek memegang banyak server kantor + client, butuh dashboard
terpusat status UP/DOWN, termasuk server internal di balik jump host,
plus info Docker dan port listen per server. Revisi lingkup berturut-turut:
awalnya `servers.yaml` manual → form web + upload key (Tahap 1b) → form
web TANPA upload key sama sekali, app baca `~/.ssh/` OS tempat app jalan
(Tahap 1c) — karena pemilik projek sudah setup key manual di server kantor
untuk SSH sehari-hari dan tidak mau upload ulang lewat browser. App
rencananya dipindah ke server kantor 24/7 (bukan tetap di laptop ini).

## Sudah dilakukan di session ini
- **Tahap 1** (fondasi): selesai & commit `444931e`.
- **Tahap 1b** (DB + form web + upload key): selesai & commit `a5c8fc8`,
  `b0c2fe8`.
- **Tahap 1c** (auto-discovery key, hapus upload) — diimplementasi, BELUM
  commit:
  - `src/services/sshKeyDiscovery.js` (baru): scan `~/.ssh/` (via
    `os.homedir()`, override dengan env `SSH_DIR`) untuk file yang
    berheader PEM/OpenSSH, skip `.pub`/`config`/`known_hosts`/
    `authorized_keys`. Parser minimal `~/.ssh/config` untuk resolve
    `IdentityFile` dari blok `Host <alias>` yang cocok persis dengan
    hostname target (tidak dukung wildcard).
  - `src/services/sshClient.js`: `connectWithKeyDiscovery()` — coba tiap
    key hasil discovery satu-satu sampai auth berhasil; kegagalan TCP
    (ECONNREFUSED/ETIMEDOUT/EHOSTUNREACH/timeout) dilempar langsung tanpa
    lanjut coba key lain (bukan masalah key). Cache in-memory
    `workingKeyCache` (key: `host:port:user`) supaya polling berikutnya
    langsung pakai key yang terakhir berhasil, dicoba pertama.
  - `src/db/schema.sql` + `serverStore.js`: kolom `ssh_key_path` dihapus
    dari tabel `servers` sepenuhnya.
  - `src/routes/servers.js`: hapus semua logika `multer`/upload.
  - `src/middleware/keyUpload.js`: **dihapus** (file, bukan cuma isi).
  - `src/views/server-form.ejs`: hapus field file input + enctype
    multipart, tambah catatan penjelasan ke user.
  - `package.json`: hapus `multer`, `uuid` (sudah tidak dipakai).
  - `.env.example`: hapus `KEYS_DIR`, tambah `SSH_DIR` (override lokasi
    `~/.ssh/`, relevan kalau nanti jalan sebagai systemd service).
  - `README.md`: bagian baru "Cara kerja autentikasi SSH" — jelaskan
    mekanisme, syarat (key harus TANPA passphrase, harus ada di
    `authorized_keys` target), dan implikasi keamanan (kompromi mesin app
    = kompromi semua server yang key-nya ada di situ).
- **Divalidasi ke server SSH nyata** (bukan simulasi lokal, ini pertama
  kalinya kode SSH project ini jalan ke server sungguhan):
  - `connect()` ke `iyan@36.88.32.238:1031` berhasil pakai auto-discovery
    key (tanpa config apa pun selain host/port/user).
  - `docker ps -a` berhasil, menampilkan container riil (traefik,
    midleware-thinkpark, watchtower).
  - `sudo ss -tulnp` **gagal** dengan pesan jelas: `sudo: a password is
    required` — user `iyan` di server itu belum di-setup NOPASSWD sudo
    untuk `ss` (prasyarat yang didokumentasikan di README, belum
    di-apply pemilik projek ke server ini). Bukan bug kode.
  - End-to-end lewat web juga dicoba: tambah server lewat form (hanya
    nama/host/port/user, tanpa upload), scheduler manual trigger, dashboard
    menampilkan UP + latency riil (1561ms), halaman detail menampilkan
    docker ps -a riil dan pesan error ss yang jelas.
- Jump host (Tahap 2, `via`) **masih belum divalidasi ke server nyata** —
  yang divalidasi baru koneksi langsung tanpa jump host.
- `npm audit`: 0 vulnerabilities setelah hapus multer/uuid.
- Database testing (berisi host nyata `36.88.32.238`) sudah dihapus lagi
  sebelum sesi ditutup — tidak boleh tertinggal, itu data pemilik projek.

## Langkah berikutnya yang konkret
1. **Commit perubahan Tahap 1c** (belum dilakukan — lihat git status).
2. Update `.agent/context/PLAN.md`: tandai Tahap 1c selesai setelah commit,
   catat bahwa koneksi langsung (non-jump-host) sudah tervalidasi nyata.
3. **Beri tahu pemilik projek**: server `iyan@36.88.32.238:1031` perlu
   `visudo -f /etc/sudoers.d/sxops` dengan isi
   `iyan ALL=(root) NOPASSWD: /usr/sbin/ss` supaya port listen bisa
   terbaca (lihat README.md bagian "Prasyarat di tiap server target").
4. Pemilik projek tambah server via jump host yang nyata lewat form,
   untuk memvalidasi Tahap 2 (ProxyJump) — sampai sekarang jalur itu
   masih murni teoretis, belum pernah jalan ke SSH server sungguhan.
5. Pemilik projek buat user produksi (bukan `admin`/`testpassword123`
   yang dipakai saat testing): `node src/scripts/createUser.js <user> <pass>`.

## Yang sudah dicoba dan gagal
- `sudo ss -tulnp` ke `iyan@36.88.32.238:1031` gagal karena sudoers belum
  di-setup di server itu — bukan kegagalan kode, sudah didokumentasikan
  sebagai prasyarat sejak Tahap 1. Item #3 di atas untuk pemilik projek.

## Berkas yang sedang disentuh
Belum di-commit, hasil `git status --short` (working tree, tidak ada data
testing/rahasia tersisa):
```
M .env.example
M README.md
M package-lock.json
M package.json
M src/db/schema.sql
D src/middleware/keyUpload.js
M src/routes/servers.js
M src/server.js
M src/services/serverStore.js
M src/services/sshClient.js
M src/views/server-form.ejs
?? src/services/sshKeyDiscovery.js
```

## Catatan penting
- User SSH di server target WAJIB dibatasi NOPASSWD sudo hanya untuk
  `ss` (bukan full sudo) — didokumentasikan di README.md, bukan
  otomatis di-enforce oleh app. Contoh nyata gagal: lihat "Yang sudah
  dicoba dan gagal" di atas.
- Key SSH yang dipakai app **tidak boleh punya passphrase** (app jalan
  unattended). Key bertipe tidak standar (mis. yang tidak match regex
  PEM/OpenSSH header) otomatis di-skip oleh `sshKeyDiscovery.js`, bukan
  error — didiamkan secara sengaja.
- Risiko keamanan yang disadari & didokumentasikan: karena app mencoba
  SEMUA key di `~/.ssh/`-nya ke server manapun yang didaftarkan, kompromi
  pada mesin tempat app berjalan (nanti: server kantor) = kompromi semua
  server yang key-nya ada di situ. Ini trade-off desain yang disetujui
  pemilik projek, dicatat di PLAN.md bagian Risiko.
- Database (`data/*.sqlite*`) sengaja tidak di-commit (lihat `.gitignore`)
  — berisi topologi jaringan client yang sensitif begitu diisi data nyata.
- Skema DB berubah lagi (kolom `ssh_key_path` dihapus). Kalau ada database
  lama dari sebelum Tahap 1c, harus dihapus & dibuat ulang (tidak ada
  migrasi otomatis, belum ada data produksi yang perlu dijaga).

---

## Cara memakai file ini

**Saat konteks baru saja ter-compact atau session baru dimulai di tengah kerja:**
baca file ini lebih dulu, sebelum apa pun. Dia memberi tahu posisimu persis.

**Saat selesai satu langkah:** perbarui bagian "Sudah dilakukan" dan "Langkah
berikutnya". Cukup beberapa detik, tapi menyelamatkan session kalau terpotong.

**Saat session benar-benar selesai:** jalankan `/handoff` — isinya dipindahkan
ke `JOURNAL.md` sebagai entri permanen, lalu file ini dikosongkan kembali.
