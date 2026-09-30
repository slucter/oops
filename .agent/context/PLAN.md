# Rencana: Dashboard Monitoring Server (sxops)

Dibuat: 2026-09-30
Status: disetujui 2026-09-30

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
- Registry server lewat file config (YAML), termasuk relasi jump host
  (server internal menunjuk ke bastion mana).
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
- UI untuk tambah/edit server dari web (tahap ini pakai file config manual).
- Notifikasi otomatis (email/Telegram/Slack saat server down) — bisa jadi
  tahap lanjutan.
- Real-time push (websocket) — cukup polling + refresh halaman.
- Manajemen SSH key dari UI (key dikelola manual di server monitoring,
  di luar app, di direktori yang di luar repo/tidak ter-commit).
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
| Sumber daftar server | file `servers.yaml` di luar git (lewat `.env`/config path) | Simpel diedit manual, tidak menyimpan topologi sensitif di kode |
| Deployment | systemd service di VPS/server kantor, atau Docker container | Sesuai preferensi: jalan terus-menerus di satu mesin |
| Prasyarat di server target | user SSH dengan NOPASSWD sudo khusus untuk `ss` (dan `docker` kalau perlu) | `sudo ss -tulnp` butuh privilege; dibatasi lewat `/etc/sudoers.d/` agar tidak full sudo |

## Model data

**Config (`servers.yaml`, bukan DB):**
- `server`: id, nama, group (kantor/nama-client), host, port, user, ssh_key_path,
  via (id jump host, opsional), has_docker (bool)

**SQLite:**
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
| Private key SSH tersimpan di mesin monitoring | Kalau mesin ini bobol, semua server ikut kebobol | Key disimpan di luar repo, permission file ketat (600), tidak pernah masuk DB/log/journal |
| Jump host down membawa banyak server internal ikut "unknown" | Bisa disalahartikan semua server itu down padahal cuma jalur putus | Bedakan status "DOWN" vs "UNREACHABLE (jump host down)" di UI |
| Command SSH lambat/hang ke server yang benar-benar mati | Scheduler bisa numpuk kalau tidak ada timeout | Set timeout koneksi SSH tegas (mis. 5-10 detik) per cek |
| File `servers.yaml` berisi info topologi sensitif client | Bocor kalau ke-commit ke git | Pastikan masuk `.gitignore`, dicek lewat `/simpan-rahasia` |

## Pertanyaan terbuka
- Berapa interval polling yang pas (default akan saya set 2 menit, bisa diubah via `.env`) — beri tahu kalau ada angka spesifik yang diinginkan.
- Apakah semua server client memakai user SSH yang sama, atau bervariasi per client? (akan diasumsikan bervariasi, dikonfigurasi per entri di `servers.yaml`)
