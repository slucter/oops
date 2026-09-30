# Rencana: Dashboard Monitoring Server (sxops)

Dibuat: 2026-09-30
Status: disetujui 2026-09-30 (revisi 2026-09-30: registry server pindah dari
YAML ke DB+form web; revisi 2026-09-30 #2: auto-discovery key dari `~/.ssh/`
OS tempat app berjalan, hapus upload key lewat form)

## Masalah

Pemilik projek memegang banyak server kantor dan server client, sebagian bisa
diakses SSH langsung, sebagian lagi hanya bisa dicapai lewat jump host (SSH ke
gateway lalu loncat ke IP internal, misal `user@10.10.10.10`). Saat ini tidak
ada cara terpusat untuk tahu server mana yang UP/DOWN, apa yang jalan di
dalamnya (container Docker), dan port apa yang listen. Pengecekan manual satu
per satu tidak scalable dan mudah terlewat saat ada insiden.

Dibutuhkan dashboard web yang memantau semua server ini secara berkala dan
menampilkan status dalam satu tempat, bisa diakses oleh pemilik projek + tim
kecil dengan login.

## Lingkup

Termasuk:
- Registry server disimpan di SQLite, dikelola lewat form web (tambah/edit/
  hapus server, termasuk relasi jump host via dropdown).
- Private key SSH **tidak diupload/disimpan oleh app sama sekali**. App
  membaca langsung dari folder `~/.ssh/` milik OS tempat app berjalan
  (server kantor, bukan laptop pemilik projek) — sama seperti cara kerja
  `ssh` command biasa. Form hanya minta nama, host, port, user; saat
  connect, app mencoba tiap key yang ditemukan di `~/.ssh/` satu per satu
  sampai ada yang berhasil autentikasi (juga baca `~/.ssh/config` kalau
  ada Host alias yang cocok dengan host target).
- Scheduler polling berkala (interval bisa diatur, default beberapa menit)
  yang untuk tiap server:
  - Cek UP/DOWN (coba buka koneksi SSH; kalau connect refused/timeout → DOWN).
  - Kalau UP: jalankan `docker ps -a` (kalau Docker terpasang) dan
    `sudo ss -tulnp`, simpan hasilnya.
  - Untuk server di belakang jump host: pakai SSH ProxyJump (`ssh -J`
    setara) — connect ke bastion, forward ke target, tanpa perlu tahu
    password/shell interaktif.
- Web dashboard (Express + EJS/HTMX):
  - Halaman utama: daftar semua server + status UP/DOWN + waktu cek terakhir.
  - Halaman detail per server: daftar container Docker, daftar port listen.
  - Grouping visual: server kantor vs per-client, dan server internal
    ditampilkan bernaung di bawah jump host-nya.
- Autentikasi login sederhana untuk dashboard (session-based, user disimpan
  di DB, password di-hash).
- Riwayat status ringan (log perubahan UP↔DOWN) supaya kelihatan kapan server
  down, bukan cuma status sesaat.
- Penyimpanan hasil cek di SQLite.

Tidak termasuk (sengaja):
- Notifikasi otomatis (email/Telegram/Slack saat server down) — bisa jadi
  tahap lanjutan.
- Real-time push (websocket) — cukup polling + refresh halaman.
- Upload/manajemen private key lewat app (dibatalkan — lihat revisi #2 di
  atas). Key sepenuhnya dikelola manual di `~/.ssh/` OS tempat app jalan,
  di luar app ini.
- Passphrase pada private key **tidak didukung** — key yang dipakai app
  harus tanpa passphrase (app jalan otomatis/unattended, tidak ada tempat
  untuk memasukkan passphrase interaktif). Didokumentasikan sebagai
  prasyarat di README.
- Multi-tenant / role-based access granular — login tim kecil cukup satu
  level akses untuk versi pertama.
- Eksekusi command bebas dari dashboard ke server (hanya command tetap:
  cek status, `docker ps -a`, `ss -tulnp`) — bukan remote shell umum.

## Pilihan teknis

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Bahasa/runtime | Node.js | Satu bahasa untuk backend, scheduler, dan SSH client |
| Web framework | Express | Ringan, cukup untuk internal tool |
| Tampilan | EJS + HTMX | Server-rendered, tidak perlu build step SPA, cukup untuk dashboard status |
| SSH client | library `ssh2` | Native ProxyJump-style chaining, tidak bergantung pada `ssh` binary sistem |
| Database | SQLite (better-sqlite3) | Cukup untuk skala tim kecil, tanpa perlu setup DB server terpisah |
| Scheduler | `node-cron` in-process | Sederhana, jalan dalam proses yang sama dengan web server |
| Auth | session cookie + password hash (bcrypt), user disimpan di SQLite | Cukup untuk tim kecil, tidak perlu OAuth/SSO di versi awal |
| Sumber daftar server | tabel `servers` di SQLite, dikelola lewat form web | Bisa dikelola tanpa akses filesystem/redeploy; revisi dari rencana awal (YAML) atas permintaan pemilik projek |
| Sumber private key | Auto-discovery dari `~/.ssh/` OS tempat app berjalan (coba tiap key sampai berhasil), plus baca `~/.ssh/config` untuk Host alias | Pemilik projek sudah setup key manual di server kantor untuk akses SSH sehari-hari; app cukup reuse itu, tidak perlu upload/simpan key sendiri — permukaan risiko lebih kecil (app tidak pernah menyentuh/menyimpan isi key) |
| Deployment | systemd service di VPS/server kantor, atau Docker container | Sesuai preferensi: jalan terus-menerus di satu mesin |
| Prasyarat di server target | user SSH dengan NOPASSWD sudo khusus untuk `ss` (dan `docker` kalau perlu) | `sudo ss -tulnp` butuh privilege; dibatasi lewat `/etc/sudoers.d/` agar tidak full sudo |

## Model data

**SQLite:**
- `servers`: id, name, group_name, host, port, user, via_server_id (FK ke
  servers.id, nullable), has_docker (bool), created_at. **Tidak ada kolom
  key** — key di-discover saat runtime dari `~/.ssh/`, tidak dicatat per
  server (kalau ada beberapa key valid, yang pertama berhasil dipakai dan
  hasilnya di-cache in-memory selama proses app jalan, supaya tidak coba-
  coba ulang tiap polling).
- `users`: id, username, password_hash, created_at
- `check_results`: id, server_id, checked_at, status (up/down), latency_ms,
  error_message
- `docker_snapshots`: id, server_id, checked_at, raw_output (hasil `docker ps -a`)
- `port_snapshots`: id, server_id, checked_at, raw_output (hasil `ss -tulnp`)
- `status_history`: id, server_id, from_status, to_status, changed_at
  (dicatat hanya saat status berubah, untuk histori naik/turun)

## Tahapan

### Tahap 1 — Fondasi + cek UP/DOWN server langsung · kecil
Tujuan: web app jalan, bisa baca `servers.yaml`, polling status UP/DOWN untuk
server yang diakses SSH langsung (belum jump host), tampil di dashboard.
- [ ] Setup project Node/Express, struktur folder, `.env.example`
- [ ] Skema SQLite + migrasi awal (`users`, `check_results`, `status_history`)
- [ ] Parser `servers.yaml` + validasi
- [ ] Modul SSH check (connect test) pakai `ssh2` untuk server tanpa jump host
- [ ] Scheduler `node-cron` menjalankan cek berkala, simpan ke `check_results`
- [ ] Halaman dashboard: daftar server + status UP/DOWN + waktu cek terakhir
- [ ] Login dasar (session + bcrypt), halaman dashboard di-protect
Selesai kalau: server config berisi minimal 2 server nyata bisa dicek, status
UP/DOWN muncul benar di dashboard setelah salah satu server dimatikan/dicabut
aksesnya, dan halaman tidak bisa diakses tanpa login.
**Status: selesai, di-commit `444931e`.**

### Tahap 1b — Migrasi registry ke DB + form web · kecil-menengah
Tujuan: server tidak lagi didaftarkan lewat `servers.yaml`, tapi lewat form
di dashboard, tersimpan di SQLite. Ini revisi lingkup atas permintaan
pemilik projek (semula direncanakan tetap YAML).
- [x] Migrasi skema: tabel `servers` (lihat Model data), drop ketergantungan
      ke `serverConfig.js`/YAML di seluruh kode (`statusChecker`, scheduler,
      dashboardData, sshClient — `via` sekarang FK bukan id string bebas)
- [x] Modul `serverStore.js` (ganti `serverConfig.js`): CRUD server ke SQLite,
      validasi sama seperti sebelumnya (duplikat, via valid, no-cycle) tapi
      dicek terhadap tabel, bukan file
- [x] Route + form tambah server: name, group, host, port, user, has_docker,
      via (dropdown dari server yang sudah ada, exclude diri sendiri &
      keturunannya supaya tidak siklus), upload private key (`multer`)
- [x] Route edit & hapus server (hapus juga hapus file key terkait, dan
      tolak hapus kalau masih jadi `via` server lain)
- [x] File key ter-upload disimpan di `data/keys/<uuid>`, permission 600,
      folder ini di luar git (`.gitignore`)
- [x] Hapus `config/servers.yaml` & `servers.example.yaml` dari alur (tidak
      dipakai lagi); update README
Selesai kalau: server bisa ditambah/diedit/dihapus lewat browser tanpa
sentuh file apa pun, termasuk upload key dan pilih jump host dari dropdown,
dan scheduler tetap jalan mengecek server-server itu seperti sebelumnya.
**Status: selesai, di-commit `a5c8fc8`. Diuji manual via curl (CRUD,
validasi upload, anti-siklus, proteksi auth) — belum diuji ke SSH server
nyata.**

### Tahap 1c — Auto-discovery key dari ~/.ssh/, hapus upload · kecil
Tujuan: form tambah/edit server tidak lagi minta upload key. App otomatis
coba key yang ada di `~/.ssh/` OS tempat app berjalan saat connect ke
server manapun. Revisi lingkup: pemilik projek sudah setup key manual di
server kantor untuk SSH sehari-hari (contoh nyata: `iyan@36.88.32.238:1031`
sudah bisa diakses tanpa password dari mesin ini), jadi app tinggal reuse.
- [ ] Modul `sshKeyDiscovery.js`: scan `~/.ssh/` untuk file yang terlihat
      seperti private key (skip `.pub`, `known_hosts`, `config`, `authorized_keys`),
      urutan coba: key yang cocok di `~/.ssh/config` (kalau ada `Host` alias
      untuk host target) dulu, baru sisanya
- [ ] `sshClient.js`: hapus parameter `sshKey`, ganti jadi coba tiap key
      hasil discovery satu per satu sampai `connect` berhasil; cache hasil
      key-mana-yang-cocok per host (in-memory, reset saat app restart)
      supaya polling berikutnya tidak coba-coba ulang dari awal
- [ ] `serverStore.js` + `schema.sql`: hapus kolom `ssh_key_path`
- [ ] Hapus `keyUpload.js`, `multer`, `uuid` dari dependencies; hapus route
      upload dan field file di `server-form.ejs`
- [ ] Pesan error kalau semua key gagal: sebutkan berapa key yang dicoba,
      bukan cuma "auth failed" mentah dari ssh2
- [ ] Dokumentasi README: key harus **tanpa passphrase**, harus sudah
      ter-otorisasi (`authorized_keys`) di server target, folder `~/.ssh/`
      dibaca dari HOME user yang menjalankan proses app (relevan kalau
      nanti dijalankan sebagai systemd service dengan user berbeda)
Selesai kalau: server baru bisa ditambahkan hanya dengan isi
nama/host/port/user (tanpa upload apa pun), dan status UP/DOWN berhasil
dicek memakai key yang sudah ada di `~/.ssh/` tanpa konfigurasi tambahan.

### Tahap 2 — Jump host / ProxyJump · kecil-menengah
Tujuan: server internal (contoh `user@10.10.10.10` di balik bastion) bisa
dicek statusnya lewat chaining SSH.
- [ ] Modul ProxyJump: buka koneksi ke bastion, forward stream ke target
- [ ] Dukung multi-level (kalau ada) atau minimal 1 level jump sesuai kebutuhan
      nyata saat ini
- [ ] Tampilkan relasi bastion → server internal di UI (grouping/nesting)
- [ ] Uji: matikan bastion → server di baliknya otomatis tampil DOWN
      (bukan error tak jelas)
Selesai kalau: minimal satu server internal riil berhasil dicek lewat jump
host yang riil, dan status tergroup jelas di bawah bastion-nya.

### Tahap 3 — Docker & port info · menengah
Tujuan: untuk server yang UP dan `has_docker: true`, tampilkan hasil
`docker ps -a`; untuk semua server UP, tampilkan hasil `sudo ss -tulnp`.
- [ ] Modul eksekusi command read-only via SSH (reuse koneksi dari cek status)
- [ ] Simpan snapshot ke `docker_snapshots` / `port_snapshots`
- [ ] Halaman detail server: tabel container (nama, image, status, ports) dan
      tabel port listen (proto, local address, port, proses)
- [ ] Penanganan kalau `docker` tidak terpasang atau sudo gagal (tampilkan
      pesan jelas, bukan crash)
Selesai kalau: halaman detail server menunjukkan container Docker riil dan
daftar port listen riil dari minimal satu server yang punya Docker.

### Tahap 4 — Histori status & polish · kecil
Tujuan: bisa lihat kapan server pernah down, dan dashboard nyaman dipakai
harian.
- [ ] Catat perubahan status ke `status_history`, tampilkan timeline ringkas
      per server (mis. "down sejak 14:02, up lagi 14:07")
- [ ] Auto-refresh halaman dashboard (HTMX polling ringan)
- [ ] Dokumentasi prasyarat server target (sudoers NOPASSWD untuk `ss`,
      key distribution) di README
Selesai kalau: histori status kelihatan untuk server yang sempat down selama
testing, dan dashboard ter-refresh sendiri tanpa reload manual.

## Risiko

| Risiko | Dampak | Penanganan |
|---|---|---|
| Sudo untuk `ss -tulnp` butuh privilege luas kalau tidak dibatasi | Server target jadi kurang aman kalau NOPASSWD sudo full | Batasi lewat `/etc/sudoers.d/` hanya untuk command spesifik (`ss`, `docker`), didokumentasikan sebagai prasyarat |
| Semua key di `~/.ssh/` server kantor bisa dipakai app ke server manapun | Kalau server kantor (tempat app jalan) bobol, penyerang otomatis punya akses ke *semua* server yang key-nya ada di situ — app tidak membatasi key mana untuk server mana | Ini risiko inheren dari pilihan desain (reuse key OS); mitigasi ada di lapisan luar app: harden server kantor itu sendiri, restrict `authorized_keys` per server ke command tertentu kalau memungkinkan (`command=` di authorized_keys) |
| Key dengan passphrase gagal dipakai tanpa pesan jelas | User bingung kenapa auto-discovery "gagal" padahal key ada | Skip key yang butuh passphrase saat parsing gagal karena encrypted, catat di log/pesan error mana yang di-skip karena itu |
| Jump host down membawa banyak server internal ikut "unknown" | Bisa disalahartikan semua server itu down padahal cuma jalur putus | Bedakan status "DOWN" vs "UNREACHABLE (jump host down)" di UI |
| Command SSH lambat/hang ke server yang benar-benar mati | Scheduler bisa numpuk kalau tidak ada timeout | Set timeout koneksi SSH tegas (mis. 5-10 detik) per cek |
| Form tambah server tidak terproteksi | Siapa pun yang bisa login bisa menambah target baru untuk dicoba semua key `~/.ssh/`-nya | Semua route CRUD server wajib lewat middleware `requireAuth` yang sudah ada; tidak ada endpoint form yang publik |

## Pertanyaan terbuka
- Berapa interval polling yang pas (default akan saya set 2 menit, bisa diubah via `.env`) — beri tahu kalau ada angka spesifik yang diinginkan.
- Apakah semua server client memakai user SSH yang sama, atau bervariasi per client? (akan diasumsikan bervariasi, dikonfigurasi per entri di `servers.yaml`)
