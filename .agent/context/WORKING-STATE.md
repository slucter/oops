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
Perbaikan bug + fitur kecil pasca-Tahap 1c, dipicu laporan langsung dari
pemilik projek yang menjalankan app di terminalnya sendiri: dashboard
menampilkan UNKNOWN dan terminal menunjukkan
`[scheduler] gagal ambil info server 1: Timeout saat koneksi SSH`.
Root cause: `checkServer` dan `collectServerInfo` masing-masing membuka
koneksi SSH terpisah (2x handshake per siklus polling per server) —
diperbaiki jadi satu koneksi dibagi dua. Sekalian ditambah auto-refresh
dashboard (diminta pemilik projek di tengah investigasi bug ini). Belum
di-commit.

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
- **Tahap 1b** (DB + form web + upload key): selesai & commit `a5c8fc8`, `b0c2fe8`.
- **Tahap 1c** (auto-discovery key dari `~/.ssh/`, hapus upload): selesai &
  commit `e07609c`, `ea1ad91`. Tervalidasi ke server SSH nyata
  (`iyan@36.88.32.238:1031`) — `connect()` dan `docker ps -a` berhasil.
  `sudo ss -tulnp` gagal di server itu karena sudoers belum di-setup
  (prasyarat terdokumentasi, bukan bug — lihat "Catatan penting").
- **Perbaikan bug (sesi ini, BELUM commit)**: pemilik projek menjalankan
  app sendiri di terminalnya, menambah server "KST-DEV"
  (`iyan@36.88.32.238:1031`) lewat form, lalu melaporkan dashboard
  menunjukkan UNKNOWN dan terminal menampilkan
  `[scheduler] gagal ambil info server 1: Timeout saat koneksi SSH`.
  - Root cause: `checkServer()` dan `collectServerInfo()` di
    `statusChecker.js` masing-masing memanggil `connect()` sendiri —
    2 handshake SSH penuh per server per siklus polling. Reproduksi
    manual (3x percobaan berturut-turut) tidak selalu gagal (1.1–2.5
    detik), tapi 2 koneksi terpisah lebih rentan kena hiccup jaringan/
    rate-limit sesaat dibanding 1 koneksi dipakai ulang.
  - Fix: `checkServer()` sekarang mengembalikan `{ conn, close }` saat
    berhasil; `collectServerInfo(server, conn)` menerima koneksi itu
    langsung, tidak connect ulang. `scheduler/index.js` memanggil
    `result.close()` di blok `finally` setelah `collectServerInfo`.
  - Diverifikasi lewat render EJS langsung + baca-ulang kode (BUKAN lewat
    server HTTP baru — proses node milik pemilik projek sendiri yang
    masih pegang port 3000 & lock `data/sxops.sqlite`, sengaja tidak
    diganggu).
- **Fitur auto-refresh dashboard** (diminta pemilik projek di tengah sesi
  ini, "di web ya tambahkan refresh dong"): `dashboard.ejs` sekarang punya
  tombol "Refresh" manual + auto-reload tiap 30 detik dengan indikator
  hitung mundur (`refresh otomatis dalam Ns`), JS inline sederhana, tanpa
  dependency baru.
- Jump host (Tahap 2, `via`) **masih belum divalidasi ke server nyata** —
  yang tervalidasi baru koneksi langsung tanpa jump host.

## Langkah berikutnya yang konkret
1. **Commit perubahan sesi ini** (fix koneksi ganda + auto-refresh) —
   belum dilakukan, lihat "Berkas yang sedang disentuh".
2. **Minta pemilik projek restart app-nya** (proses lama di terminalnya
   masih jalan dengan kode lama) supaya fix koneksi ganda + auto-refresh
   aktif, lalu konfirmasi apakah error timeout itu hilang.
3. **Ingatkan pemilik projek**: server `iyan@36.88.32.238:1031` masih
   perlu `visudo -f /etc/sudoers.d/sxops` dengan isi
   `iyan ALL=(root) NOPASSWD: /usr/sbin/ss` supaya port listen terbaca
   (lihat README.md "Prasyarat di tiap server target") — ini belum
   dilakukan, error `sudo: a password is required` akan terus muncul di
   halaman detail server sampai itu di-setup.
4. Pemilik projek tambah server via jump host yang nyata lewat form,
   untuk memvalidasi Tahap 2 (ProxyJump) — sampai sekarang jalur itu
   masih murni teoretis, belum pernah jalan ke SSH server sungguhan.
5. Pemilik projek buat user produksi (bukan `admin`/`testpassword123`
   yang dipakai saat testing): `node src/scripts/createUser.js <user> <pass>`.

## Yang sudah dicoba dan gagal
- `sudo ss -tulnp` ke `iyan@36.88.32.238:1031` gagal karena sudoers belum
  di-setup di server itu — bukan kegagalan kode. Item #3 di atas.

## Berkas yang sedang disentuh
Belum di-commit:
```
M src/scheduler/index.js
M src/services/statusChecker.js
M src/views/dashboard.ejs
```

## Catatan penting
- **Server sxops di mesin ini sedang dijalankan LANGSUNG OLEH PEMILIK
  PROJEK** di terminalnya sendiri (bukan proses yang saya start), dengan
  `data/sxops.sqlite` berisi server nyata "KST-DEV". Jangan matikan proses
  node miliknya atau hapus/reset database itu tanpa izin eksplisit —
  beda dengan sesi-sesi sebelumnya di mana saya start & stop server test
  sendiri lalu bersihkan datanya.
- User SSH di server target WAJIB dibatasi NOPASSWD sudo hanya untuk
  `ss` (bukan full sudo) — didokumentasikan di README.md, bukan
  otomatis di-enforce oleh app.
- Key SSH yang dipakai app **tidak boleh punya passphrase** (app jalan
  unattended). Key bertipe tidak standar otomatis di-skip oleh
  `sshKeyDiscovery.js`, bukan error.
- Risiko keamanan yang disadari & didokumentasikan: app mencoba SEMUA key
  di `~/.ssh/`-nya ke server manapun yang didaftarkan — kompromi pada
  mesin tempat app berjalan = kompromi semua server yang key-nya ada di
  situ. Trade-off desain yang disetujui pemilik projek (PLAN.md bagian
  Risiko).
- Database (`data/*.sqlite*`) sengaja tidak di-commit (`.gitignore`) —
  sekarang berisi data server nyata pemilik projek.

---

## Cara memakai file ini

**Saat konteks baru saja ter-compact atau session baru dimulai di tengah kerja:**
baca file ini lebih dulu, sebelum apa pun. Dia memberi tahu posisimu persis.

**Saat selesai satu langkah:** perbarui bagian "Sudah dilakukan" dan "Langkah
berikutnya". Cukup beberapa detik, tapi menyelamatkan session kalau terpotong.

**Saat session benar-benar selesai:** jalankan `/handoff` — isinya dipindahkan
ke `JOURNAL.md` sebagai entri permanen, lalu file ini dikosongkan kembali.
