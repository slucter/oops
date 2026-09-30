# Rencana: Dashboard Monitoring Server v2 — Agent Push via WebSocket (sxops)

Dibuat: 2026-09-30
Status: disetujui 2026-09-30
Branch: `v2-websocket-agent` (dari commit `65388d6` di `master`)

Versi sebelumnya (SSH pull + jump host shell-out) diterima dan diarsipkan
permanen di branch `v1-ssh-jump-host` serta `.agent/context/JOURNAL.md`
entri 2026-09-30. Versi ini adalah **rombakan arsitektur**, bukan lanjutan
tahap — dimulai dari database kosong, model data baru.

## Masalah

Model v1 (SSH pull dari server monitoring ke tiap client) punya batasan:
setiap client baru harus punya key yang bisa diakses dari mesin monitoring
(langsung atau lewat jump host), dan client di jaringan privat/di belakang
NAT pihak ketiga (client eksternal) tidak selalu bisa diatur begitu — pemilik
projek tidak selalu punya kontrol atas topologi jaringan client.

Model baru: **client yang inisiasi koneksi keluar** ke server monitoring
(push, bukan pull). Client menjalankan satu skrip instalasi
(`curl <url> | bash`), skrip itu jalan sebagai agent kecil yang konek ke
server monitoring lewat WebSocket dan mengirim data kondisinya sendiri
(ping/health, latency, RAM, disk, dst) secara berkala. Ini menghilangkan
kebutuhan SSH/jump host sama sekali dari sisi monitoring — cukup client bisa
buka koneksi keluar ke `mon.kawandev.xyz`, yang hampir selalu bisa (outbound
biasanya tidak difilter seketat inbound).

## Lingkup

Termasuk:
- **Registry client via token**, bukan SSH: klik "+ Tambah Client" di web
  men-generate satu row `clients` dengan token unik (mis. UUID v4 atau
  random 32-byte hex), status awal "menunggu koneksi". Halaman langsung
  menampilkan **command instalasi** siap-pakai
  (`curl -fsSL https://mon.kawandev.xyz/install.sh?token=<token> | bash`)
  untuk disalin dan dijalankan di server target — bukan form isi host/port/
  user seperti v1.
- **Script instalasi** (`install.sh`, disajikan sebagai endpoint HTTP,
  bukan file statis di repo publik lain): mendownload agent script,
  menyimpannya di `~/.sxops-agent/`, menjalankannya sebagai proses
  background milik user (bukan root, bukan systemd system-wide) yang akan
  auto-reconnect kalau koneksi putus. Idempotent — jalan ulang command yang
  sama harus aman (replace instalasi lama, bukan duplikat proses).
- **Agent client** (script — bahasa: lihat Pilihan Teknis): connect
  WebSocket ke server monitoring dengan token di handshake, kirim payload
  berkala (default 30 detik, bisa dikonfigurasi) berisi: timestamp, uptime,
  RAM (total/used), disk (total/used, filesystem root), CPU load (1/5/15
  menit), hostname. "Ping/health" di sini berarti **agent yang masih
  terkoneksi = server itu hidup** — bukan ICMP ping terpisah (server
  monitoring tidak lagi punya akses jaringan langsung ke client untuk
  ping).
- **Server WebSocket** di app monitoring: terima koneksi, validasi token
  saat handshake (tolak kalau token tidak ada/dicabut), validasi payload
  ketat (skema tipe data + batas ukuran pesan) sebelum simpan ke DB. Kalau
  koneksi drop tanpa pesan "disconnect" resmi (client mati mendadak/jaringan
  putus) dan tidak ada payload baru dalam N kali interval berturut-turut →
  status client jadi DOWN.
- **Master Group**: menu terpisah untuk kelola daftar grup (CRUD nama grup),
  lepas dari form tambah client. Client yang sudah terkoneksi di-assign ke
  grup lewat dropdown di halaman client (bukan saat instalasi — grouping
  dilakukan manual belakangan oleh pemilik projek).
- Dashboard: kolom/tampilan yang sama semangatnya dengan v1 (status,
  latency-setara, RAM, disk — tanpa kolom "Host" statis karena IP asal
  koneksi WebSocket bisa dicatat tapi bukan identitas utama lagi), **tanpa
  tombol "+ Tambah Server"** — diganti "+ Tambah Client" yang mengarah ke
  halaman command instalasi.
- Halaman detail client: sama seperti v1 (grafik latency-setara/histori
  koneksi, RAM/disk/CPU load + grafik historis) tapi sumber datanya push
  dari agent, bukan pull SSH.
- **Docker `ps -a` dan port listen (`ss -tulnp`) tetap wajib ada**,
  dikonfirmasi eksplisit pemilik projek. Karena client tidak lagi diakses
  lewat shell (tidak ada SSH masuk), ini butuh **protokol command-response
  di atas WebSocket yang sama**: server kirim pesan bertipe `command` ke
  agent (mis. `{"type":"command","id":"<uuid>","cmd":"docker_ps"}`), agent
  jalankan command lokal dan balas `{"type":"command_result","id":"<uuid>",
  "output":"...","exitCode":0}`. Dipicu saat pemilik projek membuka halaman
  detail client (request on-demand, bukan tersimpan tiap 30 detik seperti
  metrik dasar — supaya tidak membebani agent/DB terus-menerus untuk data
  yang jarang dilihat).
- Auth login dashboard: tetap seperti v1 (session + bcrypt).
- **Deploy produksi**: app dijalankan sebagai service di KST Lab
  (10.10.10.15), port internal yang tidak bentrok dengan service lain yang
  sudah jalan di situ. Nginx di Load Balancer KST (yang sudah reachable
  publik) reverse proxy `mon.kawandev.xyz` → `10.10.10.15:<port>`, termasuk
  upgrade header untuk WebSocket (`Upgrade`/`Connection`).

Tidak termasuk (sengaja, revisi dari v1):
- **SSH/jump host dihapus total** — tidak ada lagi kolom `via`, tidak ada
  `sshClient.js`/`sshKeyDiscovery.js` di jalur utama. App tidak lagi butuh
  akses ke `~/.ssh/` untuk memantau client.
- Docker `ps -a` dan port listen (`ss -tulnp`) — **ditunda**, bukan
  dibatalkan permanen. Kalau pemilik projek masih mau ini, perlu protokol
  tambahan (server kirim "perintah" ke agent lewat WebSocket, agent
  jalankan lokal dan balas hasilnya) — flagged sebagai kemungkinan Tahap
  lanjutan, di luar rombakan awal ini.
- TLS/HTTPS **di level app** — nginx di Load Balancer KST yang pegang
  sertifikat (Let's Encrypt lewat certbot, kemungkinan sudah ada
  polanya di server itu untuk domain lain); app sendiri jalan plain
  HTTP/WS di jaringan internal antara KST Lab dan Load Balancer KST.
- Auto-update agent client — kalau protokolnya berubah nanti, client lama
  perlu di-reinstall manual (jalankan ulang command instalasi). Tidak ada
  mekanisme auto-upgrade di versi ini.
- Command bebas dari dashboard ke client (remote shell umum) — hanya dua
  command tetap yang didukung protokol command-response (`docker_ps`,
  `port_listen`), sama prinsipnya dengan v1.
- Multi-tenant/role-based access — sama seperti v1, tidak berubah.

## Pilihan teknis

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Bahasa agent client | **Node.js** (script `.js`, dijalankan dengan `node` — bukan dikompail) | Reuse pola kode & library (`ws`) yang sama dengan server, paling cepat dikembangkan, permukaan bug baru lebih kecil. Trade-off: client butuh `node` terpasang — `install.sh` cek dan install via package manager kalau belum ada |
| Auto-restart agent | Bukan tanggung jawab bahasa — dijamin oleh `systemd --user` dengan `Restart=always` (lihat baris Deployment) | "Selalu jalan lagi kalau mati/server reboot" adalah persoalan process supervision, bukan pilihan bahasa pemrograman |
| Server WebSocket | library `ws` (Node), nempel di server HTTP Express yang sudah ada | Satu proses, satu port, reuse infrastruktur Express/session yang sudah ada; `ws` ringan dan populer |
| Autentikasi client | Token acak per-client (mis. `crypto.randomBytes(24).toString('hex')`), dikirim di query string saat WebSocket handshake atau header `Authorization` | Simpel, dicabut per-client (hapus/regenerate token di DB tanpa ganti yang lain), tidak butuh infrastruktur PKI |
| Registry client | Tabel `clients` baru di SQLite, gantikan `servers` v1 total | Model data beda (tidak ada host/port/user/via, ganti token + last_seen + group) |
| Validasi payload | Skema manual (cek tipe tiap field) + limit ukuran pesan WS (mis. 8KB) sebelum diproses | Endpoint publik ke internet, client adalah kode yang jalan di mesin pihak lain — tidak boleh dipercaya begitu saja |
| Deteksi DOWN | Timer server-side: kalau tidak ada payload baru dalam N × interval (mis. 3 × 30 detik = 90 detik) sejak `last_seen`, tandai DOWN | WebSocket disconnect event tidak selalu terkirim bersih (client crash, jaringan putus mendadak) — perlu heartbeat timeout, bukan cuma event `close` |
| Deployment | systemd service **user-level** (`systemctl --user`) di KST Lab, dengan `loginctl enable-linger` supaya tetap jalan tanpa user login aktif | Sesuai keputusan: user biasa, bukan root, tapi tetap survive restart/reboot server |
| Reverse proxy | nginx di Load Balancer KST, `proxy_pass` ke `10.10.10.15:<port>` + header Upgrade untuk WS | Load Balancer KST sudah publik/reachable dari internet dan (asumsi) sudah punya nginx untuk domain lain |

## Model data (SQLite, skema baru — `servers`/`docker_snapshots`/`port_snapshots` v1 dihapus)

- `groups`: id, name (unique), created_at — Master Group
- `clients`: id, name, token (unique, hashed atau plain — diputuskan saat
  coding, minimal indexed & unique), group_id (FK ke groups, nullable),
  status (`up`/`down`/`pending` — pending = token dibuat, belum pernah
  connect), last_seen_at (nullable), created_at
- `client_metrics`: id, client_id (FK), received_at, mem_total_mb,
  mem_used_mb, disk_total_gb, disk_used_gb, load_1m, load_5m, load_15m,
  uptime_seconds, hostname — satu row per payload yang diterima (setara
  `resource_snapshots` + `check_results` v1 digabung, karena "UP" di sini
  = "baru saja mengirim payload")
- `client_command_results`: id, client_id (FK), command (`docker_ps` |
  `port_listen`), requested_at, output (text, nullable), error_message
  (nullable) — hasil terbaru per command per client (upsert/replace, bukan
  histori — beda dari `client_metrics` yang tersimpan tiap payload; ini
  cuma snapshot terakhir on-demand, setara `docker_snapshots`/
  `port_snapshots` v1 tapi datanya push hasil command, bukan pull SSH)
- `status_history`: id, client_id, from_status, to_status, changed_at —
  sama seperti v1, dipertahankan
- `users`: sama persis seperti v1 (tidak berubah)

## Tahapan

### Tahap A — Fondasi backend: schema baru, WebSocket server, token auth · menengah
Tujuan: server bisa menerima koneksi WebSocket dengan token valid, terima
payload metrik, simpan ke DB. Belum ada UI baru, belum ada script instalasi.
- [ ] Reset DB: schema baru (`groups`, `clients`, `client_metrics`,
      `status_history`, `users`), hapus tabel v1 sepenuhnya dari
      `schema.sql`
- [ ] Hapus `sshClient.js`, `sshKeyDiscovery.js`, `statusChecker.js` (versi
      SSH), `scheduler/` (polling pull tidak relevan lagi), `serverStore.js`
      → ganti `clientStore.js`
- [ ] Modul `wsServer.js`: pasang `ws` di atas HTTP server Express yang
      sama, validasi token saat `upgrade` request (tolak sebelum handshake
      selesai kalau token invalid — jangan terima koneksi dulu baru cek)
- [ ] Skema validasi payload (tipe + batas ukuran), tolak/log payload yang
      tidak valid tanpa crash
- [ ] Simpan payload ke `client_metrics`, update `clients.last_seen_at` +
      `status`, catat `status_history` kalau status berubah
- [ ] Timer/interval server-side: scan client yang `last_seen_at` lebih
      lama dari ambang batas → tandai DOWN
Selesai kalau: koneksi WebSocket manual (mis. pakai `wscat` atau script
test) dengan token valid bisa kirim payload dan tersimpan benar di DB;
token invalid ditolak sebelum handshake; client yang berhenti kirim payload
otomatis jadi DOWN setelah ambang waktu terlewati.

### Tahap B — Registry client & Master Group di web · kecil-menengah
Tujuan: halaman "+ Tambah Client" generate token + tampilkan command
instalasi; menu Master Group untuk kelola grup; assign client ke grup.
- [ ] Route `/clients/new`: generate token, simpan row `clients` status
      `pending`, render halaman berisi command instalasi siap-copy
- [ ] Route `/groups`: CRUD grup (tambah/edit/hapus nama)
- [ ] Route edit client: assign/ubah `group_id`, regenerate token (revoke
      akses lama), hapus client
- [ ] Update dashboard: kolom/tabel client (bukan server), grouping by
      `group_id` (bukan tree `via` — model v1 sudah tidak relevan), hapus
      tombol "+ Tambah Server" ganti "+ Tambah Client"
Selesai kalau: bisa buat client baru dari browser, dapat command instalasi
yang valid, assign ke grup lewat dropdown, dan dashboard menampilkan client
per grup.

### Tahap C — Agent client & script instalasi · menengah-besar
Tujuan: `curl <url> | bash` benar-benar menghasilkan proses yang connect ke
server dan mengirim data, plus bisa merespons command on-demand.
- [ ] Agent (`agent.js`, Node.js): connect WebSocket dengan token, kirim
      payload metrik tiap N detik (RAM/disk/load/uptime/hostname),
      reconnect otomatis dengan backoff kalau putus
- [ ] Agent: dengarkan pesan `{"type":"command", ...}` dari server, jalankan
      `docker ps -a` atau `ss -tulnp` (tanpa sudo — sama seperti v1) sesuai
      `cmd`, balas `{"type":"command_result", ...}` dengan `id` yang sama
      supaya server bisa cocokkan balasan ke permintaan mana
- [ ] Endpoint `/install.sh`: generate script bash yang 1) validasi token
      dari query string, 2) cek/install `node` kalau belum ada (deteksi
      package manager: `apt`/`yum`/`apk`), 3) download `agent.js` ke
      `~/.sxops-agent/`, 4) daftarkan sebagai `systemctl --user` service
      dengan `Restart=always` + `loginctl enable-linger $USER`, 5) start
      service
- [ ] Uji idempotency: jalankan command instalasi 2x di server yang sama,
      tidak boleh ada 2 proses agent duplikat (service systemd yang sama
      di-restart, bukan didaftarkan dobel)
Selesai kalau: command instalasi dari halaman web, dijalankan di server
nyata (KST Lab dulu, sebelum deploy publik), membuat client itu muncul
UP di dashboard dengan data RAM/disk yang benar, bertahan lewat restart
server (systemd user + lingering), dan merespons permintaan docker/port
saat diminta dari web.

### Tahap D — Dashboard v2: grafik, detail client, docker & port on-demand · menengah
Tujuan: halaman detail client setara v1 (grafik RAM/CPU historis + docker/
port), datanya dari agent lewat WebSocket.
- [ ] Halaman detail client: stat cards (RAM, Disk, CPU load, uptime,
      hostname), grafik historis dari `client_metrics` (reuse pola
      Chart.js dari v1)
- [ ] Tombol/aksi "Refresh Docker" dan "Refresh Port" di halaman detail:
      kirim command ke agent (kalau sedang online), tunggu balasan
      (dengan timeout, mis. 10 detik), simpan/tampilkan di
      `client_command_results`. Kalau client sedang DOWN, tampilkan pesan
      jelas ("client tidak terkoneksi") alih-alih mencoba kirim command
- [ ] Riwayat status (reuse pola `status_history` dari v1)
Selesai kalau: halaman detail client menampilkan data nyata dari agent
yang berjalan di Tahap C, grafik terisi setelah beberapa siklus payload,
dan tombol refresh docker/port menampilkan hasil nyata dari client.

### Tahap E — Deploy ke KST Lab + nginx reverse proxy · menengah
Tujuan: app jalan permanen di KST Lab, bisa diakses publik lewat
`mon.kawandev.xyz`.
- [ ] Cek port yang sudah dipakai di KST Lab (`ss -tulnp` atau setara),
      pilih port internal yang kosong untuk app v2
- [ ] Deploy kode ke KST Lab (git clone/pull dari branch ini, atau build
      artifact — cara persis diputuskan saat eksekusi), `npm install
      --production`, setup `.env`
- [ ] Jalankan sebagai `systemctl --user` service di KST Lab (bukan
      `npm start` manual di terminal — supaya survive logout/reboot),
      `loginctl enable-linger` untuk user yang menjalankan
- [ ] Login ke Load Balancer KST, konfigurasi nginx: server block untuk
      `mon.kawandev.xyz`, `proxy_pass` ke `10.10.10.15:<port>`, header
      `Upgrade`/`Connection` untuk WebSocket, cek config sebelum reload
      (`nginx -t`)
- [ ] Verifikasi dari luar: `mon.kawandev.xyz` bisa diakses, login
      dashboard bekerja, dan **command instalasi yang ditampilkan di web
      memakai domain publik** (bukan `10.10.10.15` yang cuma reachable
      internal) — supaya client di luar KST bisa install
Selesai kalau: `mon.kawandev.xyz` dari browser di luar jaringan kantor
menampilkan halaman login dashboard, dan minimal satu client uji coba
(bukan cuma di KST Lab sendiri) berhasil connect lewat command instalasi
yang pakai domain publik itu.

## Risiko

| Risiko | Dampak | Penanganan |
|---|---|---|
| Endpoint WebSocket publik ke internet, token bisa dicoba brute-force | Client palsu terdaftar / DoS percobaan koneksi | Token acak panjang (24+ byte, ruang pencarian besar), rate-limit percobaan koneksi gagal per IP kalau memungkinkan di nginx/app |
| Payload dari client adalah klaim sepihak, tidak diverifikasi kebenarannya | Client nakal/di-modif bisa kirim data RAM/disk palsu | Diterima sebagai batasan yang disadari — app mempercayai agent resminya sendiri; validasi cuma di level tipe/format, bukan kebenaran isi. Didokumentasikan sebagai batasan, bukan bug |
| `install.sh` di-serve dari endpoint yang bisa disusupi (MITM kalau bukan HTTPS) | Script instalasi diganti jadi malware kalau traffic disadap | HTTPS wajib di titik ini — nginx Load Balancer KST harus pegang TLS sebelum domain publik dipakai untuk instalasi produksi, bukan opsional |
| systemd `--user` + lingering butuh akses tertentu di server target yang mungkin tidak tersedia (mis. server client pihak ketiga yang dibatasi) | Instalasi gagal di sebagian server client, perlu fallback | Dokumentasikan prasyarat jelas di halaman command instalasi; fallback manual (nohup + crontab @reboot) sebagai alternatif kalau systemd user tidak tersedia — dipertimbangkan saat Tahap C kalau muncul kasus nyata |
| Docker/port listen hilang dari v2 dibanding v1 | Kalau pemilik projek ternyata masih butuh ini rutin, jadi regresi fitur | Sengaja di-flag sebagai "ditunda" bukan "dibatalkan" di Lingkup — konfirmasi ulang sebelum deploy final kalau ini benar-benar tidak dibutuhkan lagi |
| KST Lab port yang dipilih ternyata dipakai proses lain yang tidak sengaja diperiksa | App gagal start atau (lebih buruk) tabrakan dengan service produksi lain | Wajib cek `ss -tulnp` / `docker ps` di KST Lab dulu sebelum pilih port, sesuai instruksi eksplisit pemilik projek |

## Pertanyaan terbuka
- Port internal spesifik di KST Lab — ditentukan saat Tahap E dieksekusi,
  setelah cek port yang sudah terpakai.
