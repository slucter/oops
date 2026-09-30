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
Tahap 2 (jump host) baru saja SELESAI dan TERVALIDASI ke server nyata,
tapi dengan pendekatan yang berbeda total dari rencana awal — lihat
"Sudah dilakukan" untuk detail. Perubahan sesi ini belum di-commit.

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
- **Tahap 1, 1b, 1c**: selesai & commit (`444931e`, `a5c8fc8`, `b0c2fe8`,
  `e07609c`, `ea1ad91`).
- **Fix bug koneksi ganda + auto-refresh dashboard**: selesai & commit
  `f862ebd`. Pemilik projek melaporkan dashboard UNKNOWN + terminal
  `Timeout saat koneksi SSH` saat collectServerInfo — penyebabnya
  `checkServer`/`collectServerInfo` masing-masing connect sendiri (2x
  handshake). Digabung jadi 1 koneksi dipakai ulang. Auto-refresh
  dashboard (tombol manual + reload tiap 30 detik) ditambahkan atas
  permintaan langsung pemilik projek di tengah investigasi.
- **Tahap 2 — jump host, DIROMBAK dan TERVALIDASI ke server nyata (sesi
  ini, BELUM commit)**: pemilik projek menambahkan server nyata pertama
  via jump host lewat form — "Load Balancer KST" (`10.10.10.5:22`, via
  "KST-DEV"). Sempat menanyakan cara kerjanya, lalu mengungkap fakta
  penting: key untuk login ke `10.10.10.5` **tersimpan di dalam KST-DEV
  itu sendiri**, bukan di laptopnya. Ini pola SSH manual sehari-harinya:
  SSH ke bastion dulu, lalu DARI DALAM bastion baru SSH lagi ke internal
  host pakai key yang cuma ada di situ.
  - Implementasi ProxyJump murni sebelumnya (`ssh2` `forwardOut` + auth
    ulang dari mesin app) **tidak bisa** bekerja untuk pola ini — app
    tidak pernah, dan tidak seharusnya, punya akses ke key yang tersimpan
    di jump host.
  - **Didiskusikan dengan pemilik projek** (AskUserQuestion), dia pilih
    pendekatan "shell-out": app connect ke jump host seperti biasa
    (auto-discovery key normal), lalu MENJALANKAN COMMAND `ssh
    <user>@<host> -p <port> -- <command>` DI DALAM shell jump host itu —
    meniru persis kebiasaan manualnya. `sshClient.js` dirombak total:
    `connect()` untuk server ber-`via` sekarang melakukan probe
    (`ssh ... true`) lewat jump host, balikan berupa handle dengan
    `execRemote()` yang otomatis wrap command lewat `ssh` di jump host.
    `JumpHostUnreachableError` (class, dicek `instanceof`) menggantikan
    string-matching regex `/jump host/i` yang rapuh sebelumnya — bug
    laten yang ikut ditemukan & diperbaiki (regex lama bisa salah
    mengklasifikasikan "target down" sebagai "jump host unreachable").
  - `statusChecker.js`/`scheduler/index.js` disesuaikan: `checkServer`
    mengembalikan `handle` (bukan `conn` mentah), `collectServerInfo`
    dan `execCommand` menerima `handle` itu.
  - **TERVALIDASI ke server nyata** (mocking `serverStore.getServerById`
    di script sekali-pakai, BUKAN lewat proses server HTTP pemilik
    projek yang sengaja tidak diganggu): `connect()` ke `10.10.10.5` via
    `KST-DEV` berhasil, `whoami` via jalur itu mengembalikan `iyan`.
    2 skenario kegagalan diuji dan benar: jump host mati →
    `JumpHostUnreachableError`; jump host hidup tapi target mati → error
    biasa dengan pesan jelas dari `ssh` di jump host ("No route to
    host"). `sudo ss -tulnp` di `10.10.10.5` gagal karena sudoers belum
    di-setup (sama seperti KST-DEV, prasyarat bukan bug); `docker ps -a`
    gagal "command not found" karena Load Balancer memang tidak punya
    Docker.

## Langkah berikutnya yang konkret
1. **Commit perubahan Tahap 2** (lihat "Berkas yang sedang disentuh").
2. Update `.agent/context/PLAN.md` — sudah diupdate duluan di sesi ini,
   pastikan konsisten dengan commit.
3. **Minta pemilik projek restart app-nya** supaya kode Tahap 2 yang baru
   aktif, lalu cek dashboard: "Load Balancer KST" harusnya UP.
4. **Beritahu pemilik projek**: uncheck "Ada Docker" untuk "Load Balancer
   KST" di form edit — server itu memang tidak punya Docker terpasang.
5. **Ingatkan lagi**: `10.10.10.5` (dan `36.88.32.238`) masih perlu
   `visudo -f /etc/sudoers.d/sxops` dengan isi
   `iyan ALL=(root) NOPASSWD: /usr/sbin/ss` di MASING-MASING server itu
   (bukan cuma di jump host) supaya port listen terbaca.
6. Pemilik projek buat user produksi (bukan `admin`/`testpassword123`
   dari testing sebelumnya): `node src/scripts/createUser.js <user> <pass>`.
7. Kalau ada server dengan jump host BERLAPIS (bastion ke bastion lain,
   baru ke target) — belum diuji sama sekali, kode `connect()` rekursif
   jadi harusnya jalan (jump host boleh punya `via` sendiri), tapi
   `buildRemoteSshCommand` mengasumsikan level tunggal saat wrap command;
   perlu dicek kalau kasus itu muncul nyata.

## Yang sudah dicoba dan gagal
- ProxyJump murni (`ssh2` `forwardOut`) untuk server dengan `via` —
  gagal secara desain untuk setup nyata pemilik projek (key ada di jump
  host, bukan di mesin app). Diganti pendekatan shell-out, lihat di atas.
- `sudo ss -tulnp` ke `36.88.32.238` dan `10.10.10.5` — gagal karena
  sudoers belum di-setup di kedua server itu. Item #5 di atas.

## Berkas yang sedang disentuh
Belum di-commit:
```
M .gitignore
M src/scheduler/index.js
M src/services/sshClient.js
M src/services/statusChecker.js
M .agent/context/PLAN.md
```
(`.claude/scheduled_tasks.lock` sengaja diabaikan — file lock internal
tooling, sudah ditambahkan ke `.gitignore`, bukan bagian dari perubahan
aplikasi.)

## Catatan penting
- **Server sxops di mesin ini sedang dijalankan LANGSUNG OLEH PEMILIK
  PROJEK** di terminalnya sendiri, dengan `data/sxops.sqlite` berisi
  server nyata ("KST-DEV", "Load Balancer KST"). Jangan matikan proses
  node miliknya atau hapus/reset database itu tanpa izin eksplisit.
  Testing Tahap 2 di sesi ini dilakukan lewat script Node sekali-pakai
  terpisah (bukan lewat server HTTP-nya) justru karena alasan ini.
- Pola jump host yang tervalidasi: **key untuk server internal boleh
  tersimpan HANYA di jump host**, tidak perlu ada/disalin ke mesin
  tempat app berjalan. Ini bedanya dengan asumsi awal (ProxyJump murni)
  yang mengasumsikan app sendiri yang autentikasi ke target.
- User SSH di server target WAJIB dibatasi NOPASSWD sudo hanya untuk
  `ss` (bukan full sudo) — berlaku juga untuk server di belakang jump
  host, di-setup di server itu sendiri (bukan di jump host-nya).
- Key SSH yang dipakai app **tidak boleh punya passphrase** (app jalan
  unattended) — berlaku juga untuk key di dalam jump host yang dipakai
  buat loncat ke server internal.
- Risiko keamanan: app (lewat jump host) pada akhirnya bisa menjalankan
  command apa saja yang key di jump host itu izinkan ke server manapun
  yang bisa dijangkau dari situ — permukaan risikonya makin luas
  dibanding sebelum Tahap 2, karena sekarang bukan cuma key di mesin app
  yang relevan, tapi juga semua key yang ada di tiap jump host yang
  didaftarkan.
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
