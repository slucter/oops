# Jurnal Session

Entri terbaru di **paling atas**. Ditulis oleh skill `/handoff` di akhir tiap
session, dibaca oleh `/lanjut` di awal session berikutnya.

Aturan: jangan pernah menulis nilai rahasia di sini. Sebut namanya saja
("kredensial DB staging tersedia sebagai `DATABASE_URL`").

---

<!-- Entri baru ditambahkan tepat di bawah baris ini -->

## 2026-10-01 · Remove client mencabut agent + penjaga versi agent

**Agent:** Claude Code (Opus 5)
**Branch:** `development` · **Commit:** `2670c1e` · **Agent:** v1.2.0

### Selesai
- **Penjaga kenaikan versi agent** (`796f5fe`): pemilik projek mengoreksi bahwa
  menaikkan versi agent seharusnya otomatis dipertimbangkan setiap kode agent
  berubah, bukan menunggu diminta. Dicatat sebagai arahan tetap di
  `.agent/memory/naikkan-versi-agent.md` + aturan nomor 8 di `AGENTS.md`, lalu
  **dipaksakan** lewat pre-commit hook (`.githooks/pre-commit` +
  `agent/cek-versi-naik.js`). Aktifkan per clone: `npm run pasang-hook`.
- **Lebar kontainer 1180px → 1560px** (`c61d223`): dari screenshot pemilik
  projek, tabel 11 kolom terpotong di kanan dan kolom hostname/last-seen pecah
  tiga baris. Kolom yang isinya satu satuan utuh diberi `white-space: nowrap`;
  hostname dibatasi 190px + ellipsis + `title`. Nama client sengaja tetap boleh
  membungkus.
- **Remove client sekarang mencabut agent di server target** (`2670c1e`):
  service dicabut dari systemd, unit file dihapus, direktori `~/.oops-agent`
  dihapus. Kegagalan uninstall tidak membatalkan penghapusan — dashboard
  menampilkan banner kuning berisi perintah pembersihan manual.
- **Agent berhenti sendiri kalau tokennya dicabut**: setelah 10× ditolak HTTP
  401 berturut-turut (`OOPS_MAX_TOKEN_REJECTIONS`), agent menyimpulkan dirinya
  sudah dihapus lalu mencabut diri. Tidak di penolakan pertama — DB server bisa
  sedang di-restore dari backup, dan agent yang menghapus diri karena gangguan
  sesaat tidak bisa dibatalkan dari jarak jauh.
- **Uji dipindahkan ke repo** (`uji/`) dan disambungkan ke `npm test` — total 42
  pemeriksaan, jalan dari root projek.

### Belum selesai
- **Enam client produksi masih agent lama** (`agent_version` = kosong), jadi
  mereka **belum bisa mencabut diri** saat dihapus maupun di-update dari
  dashboard. Jalankan ulang `curl` install sekali di tiap client. Sampai itu
  dilakukan, menghapus salah satunya akan memunculkan banner kuning "agent
  belum tercabut" — itu perilaku yang benar, bukan bug.
- **Uninstall lewat perintah dashboard belum diuji ke agent sungguhan.** Yang
  sudah diuji di Linux sungguhan: jalur 401 (agent mencabut diri sendiri).
  Jalur `uninstall_agent` dari dashboard baru diuji dengan agent tiruan.
  Keduanya memanggil `selfUninstall()` yang sama, tapi itu belum sama dengan
  membuktikannya.
- **UI banner hasil hapus belum pernah dilihat terender** — hanya diverifikasi
  ada di HTML.
- Cabang Node portable masih belum diuji sebagai instalasi utuh.
- Telegram masih belum pernah mengirim pesan nyata.

### Keputusan
- **Uninstall otomatis saat Remove, bukan dialog pilihan.** Pemilik projek
  memilih ini. Konsekuensinya Remove jadi lebih destruktif, jadi teks
  konfirmasinya diperjelas menyebut apa yang akan dihapus di server target.
- **Gagal uninstall tidak memblokir penghapusan.** Client yang tidak bisa
  dihapus dari dashboard hanya karena agent-nya offline adalah kemunduran,
  bukan pengaman.
- **Ambang 401 di angka 10**, bukan 1. Menghapus diri karena gangguan sesaat
  tidak bisa dibatalkan dari jarak jauh — harus datang ke server itu manual.

### Jalan buntu
- **Proses anak ikut mati bersama unit systemd.** Skrip pembersih yang di-spawn
  detached (Node) / `start_new_session` (Python) **tetap berada di cgroup unit**,
  dan systemd membunuh seluruh cgroup saat unit berhenti. Akibatnya
  `Restart=always` menghidupkan agent kembali, yang mencoba mencabut diri lagi —
  berulang tanpa pernah berhasil (**15 percobaan, folder tetap ada**).
  Diperbaiki dengan `systemd-run --user --collect`, yang menjalankan pembersih
  sebagai unit transient di luar cgroup kita. **Ini tidak akan ketahuan tanpa
  menguji di Linux sungguhan** — semua uji dengan agent tiruan lulus.
- **`systemctl disable` saja tidak mencegah restart** — hanya mencegah start
  saat boot.
- **`systemctl set-property <unit> Restart=no` ditolak systemd**: "Cannot set
  property Restart, or unknown property". Restart bukan properti yang bisa
  diubah saat runtime. Jangan dicoba lagi.
- **Uji bisa lolos palsu karena mencocokkan nama kelas CSS.**
  `html.includes('banner-sisa')` juga cocok dengan definisi CSS di `<head>`,
  bukan hanya elemennya. Harus `class="banner-sisa"`.
- **Uji yang mematok versi langsung usang** saat versi naik. `uji/update-agent.js`
  sekarang membaca `LATEST_AGENT_VERSION` dari sumbernya.

### Langkah berikutnya
1. Jalankan ulang `curl` install **sekali** di tiap dari 6 client produksi, agar
   mereka bisa di-update dan mencabut diri dari dashboard seterusnya.
2. Setelah itu, uji Remove pada satu client sungguhan dan pastikan
   `~/.oops-agent` benar-benar hilang di server tersebut.
3. Konfirmasi lebar 1560px dan banner hasil hapus terlihat benar.
4. Buat bot Telegram lalu uji dari `/settings`.
5. Kalau semua beres, merge `development` -> `master`.

### Catatan
- `npm test` sekarang menjalankan cek versi + 2 rangkaian uji (42 pemeriksaan).
- Semua berkas dan service uji di KST Lab sudah dibersihkan; 6 client produksi
  dikonfirmasi tetap UP setelah deploy.

## 2026-09-30 · Update agent dari dashboard + agent multi-runtime (Python/Node)

**Agent:** Claude Code (Opus 5)
**Branch:** `development` · **Commit:** `fff5801`

### Selesai
- **Update agent dari dashboard** (`574f4e1`): badge versi per client, tombol
  Update di baris yang tertinggal, dan tombol "Update semua" di banner.
  Agent melaporkan versinya lewat payload metrik ke kolom baru
  `clients.agent_version`.
  - Perbandingan versi **per-komponen sebagai angka**, bukan string: `1.10.0`
    harus lebih baru dari `1.9.0`, padahal sebagai string lebih kecil. Kalau
    dibandingkan sebagai string, sistem diam-diam berhenti menawarkan update
    begitu minor version mencapai dua digit.
  - Self-update mengunduh ke `.update-tmp` dulu dan baru menyentuh berkas asli
    setelah semuanya lengkap — kalau koneksi putus di tengah, yang tersisa bukan
    berkas terpotong yang membuat agent tidak pernah hidup lagi.
  - Balasan dikirim **sebelum** restart. Setelah systemd mematikan proses,
    socket ikut mati; kalau balasan dikirim setelah itu, update yang berhasil
    terlihat seperti timeout.
  - Update massal **berurutan, bukan paralel**: kegagalan pertama menghentikan
    sisanya, jadi versi agent yang rusak merusak satu client, bukan semuanya.
- **Agent multi-runtime** (`574f4e1`): installer tidak lagi memaksa
  `apt/yum install nodejs`. Urutan pilihan: **Python 3.6+ → Node 14+ → Node
  portable** ke `~/.oops-agent` (tanpa sudo).
  - `agent/agent.py` mengimplementasikan **WebSocket RFC 6455 dari nol** di atas
    soket standar — tanpa pip sama sekali. Termasuk verifikasi
    `Sec-WebSocket-Accept`, masking frame klien, penanganan fragmentasi,
    ping/pong, dan batas ukuran frame 1 MB.
  - Alpine/musl ditolak dengan pesan yang menyebut solusinya, karena Node resmi
    tidak menyediakan build musl dan binary glibc gagal start di sana dengan
    pesan yang membingungkan.
- **Penjaga konsistensi versi** (`fff5801`): `agent/cek-versi.js`, terpasang
  sebagai `npm test`. `agent.py` menyimpan versinya sendiri (tidak bisa membaca
  `version.js`), jadi ada dua sumber yang harus dijaga manual.

### Belum selesai
- **Fitur update belum pernah dipakai dari UI oleh mata manusia.** Alur HTTP-nya
  sudah diuji sampai produksi, tapi tombol, badge, dan banner-nya belum pernah
  saya lihat terender — tidak ada browser pane di session ini.
- **Enam client produksi masih menjalankan agent lama** (`agent_version` =
  "belum lapor"). Ini konsekuensi yang memang sudah diketahui: agent lama tidak
  punya kode untuk menerima perintah update. Pemilik projek sudah memilih jalur
  "sekali manual, seterusnya otomatis" — jalankan ulang satu baris `curl`
  install di tiap client sekali saja, setelah itu tombol dashboard berfungsi
  selamanya.
- **Cabang Node portable belum diuji sebagai instalasi utuh.** Yang sudah
  dibuktikan: deteksi arsitektur, URL valid, dan unduh+ekstrak sungguhan
  (v20.18.1, npm 10.8.2, **168 MB**). Yang belum: instalasi penuh lewat cabang
  itu, karena semua server yang tersedia sudah punya Python.
- Telegram masih belum pernah mengirim pesan nyata (bot belum dibuat).

### Keputusan
- **Python didahulukan atas Node**, berdasarkan pengukuran bukan selera: agent
  Python **~19 KB tanpa dependensi apa pun**, agent Node butuh paket `ws` lewat
  npm, dan Node portable memakan **168 MB** terpasang. Fitur ketiganya identik.
  Awalnya saya menempatkan Node lebih dulu; dibalik setelah angka 168 MB keluar
  dan pemilik projek menyoroti bahwa Python lebih ringan.
- **WebSocket Python ditulis sendiri, bukan lewat pip.** `pip` sering tidak ada
  di server minimal, butuh akses PyPI yang kadang diblokir, dan bisa merusak
  paket Python sistem. Konsekuensi: kodenya lebih panjang dan protokolnya
  tanggung jawab kita — karena itu diuji langsung terhadap server `ws` sungguhan,
  bukan hanya unit test.
- **`agent_version` disimpan TANPA `COALESCE`**, berbeda dari kolom IP di query
  yang sama. Agent lama tidak mengirim field ini, dan justru ketiadaannya yang
  menandakan perlu update. Kalau dipertahankan pakai `COALESCE`, agent yang
  di-downgrade akan terus tampil versi baru dan tidak pernah ditawari update.

### Jalan buntu
- **`clientStore.mapRow()` memetakan kolom DB ke camelCase secara eksplisit**,
  dan `agent_version` tidak masuk daftar itu. Akibatnya `needsUpdate()` membaca
  `undefined` dan menganggap **semua** client perlu update — termasuk yang sudah
  terbaru. Kegagalan yang tidak terlihat seperti kegagalan: tombol Update muncul
  selamanya tanpa error apa pun. Ketemu lewat uji ujung ke ujung, bukan
  pembacaan kode. **Kalau menambah kolom ke tabel `clients`, tambahkan juga di
  `mapRow()`.**
- **Backtick di dalam template literal JavaScript menutup string itu.** Komentar
  yang menyebut paket `` `ws` `` di dalam `buildInstallScript()` membuat modul
  gagal di-parse. Pakai kutip tunggal di dalam template literal.
- Dugaan awal saya keliru: saya sempat menyangka `better-sqlite3` men-*cache*
  statement `SELECT *` sehingga kolom hasil `ALTER TABLE` tidak terbaca. Diuji
  langsung — SQLite memang me-*recompile*, jadi bukan itu penyebabnya. Sempat
  menghabiskan waktu di jalan yang salah karena menduga sebelum menguji.
- Uji installer dengan `HOME` yang dialihkan tidak bisa memverifikasi systemd
  (unit file tidak dibaca dari sana). Yang berhasil: ambil `ExecStart` dan
  `Environment` dari unit file yang dihasilkan, lalu jalankan manual.

### Langkah berikutnya
1. Buka `https://mon.kawandev.xyz` dan pastikan kolom Agent, badge versi, banner,
   dan tombol Update tampil benar — belum pernah diverifikasi secara visual.
2. Jalankan ulang perintah `curl` install **sekali** di tiap client produksi
   supaya mereka bisa di-update dari dashboard seterusnya. Perintahnya ada di
   halaman Edit tiap client.
3. Naikkan `AGENT_VERSION` di **`agent/version.js` DAN `agent/agent.py`**
   bersamaan setiap kali mengubah berkas di `agent/` — `npm test` akan menolak
   kalau lupa salah satu.
4. Buat bot Telegram lalu uji dari `/settings`.
5. Kalau semua beres, merge `development` -> `master`.

### Catatan
- Nama service diteruskan ke agent sebagai `OOPS_SERVICE_NAME` supaya self-update
  bisa me-restart service yang benar, bukan menebak namanya.
- Agent Python diuji **berdampingan** dengan agent Node di produksi (KST Lab,
  Python 3.12.3) lewat `wss://` dan nginx. Hasil identik: mem 32134/2278 MB,
  disk 105/25 GB, `cpu_count` 32, IP internal 10.10.10.15, IP publik terdeteksi,
  latency 1 ms lewat ping/pong, perintah `docker ps`/`ss` dijawab.
- Instalasi `curl | bash` sungguhan dari produksi diuji utuh: memilih Python
  otomatis, unduh 19 KB, unit systemd benar (`https://` -> `wss://`, `-u` untuk
  log), agent terhubung, dan **self-update berhasil lewat endpoint dashboard yang
  sama dengan tombolnya** (`.bak` terbentuk, balasan sampai sebelum restart).
- Semua client dan berkas uji di produksi sudah dibersihkan; 6 client asli
  dikonfirmasi tetap UP setelahnya.

## 2026-09-30 · Sistem alert + push notification browser, live di produksi

**Agent:** Claude Code (Opus 5)
**Branch:** `development` · **Commit:** `3a42c43`

### Selesai
- **Sistem alert** (`59a44c9`): `src/services/alertEngine.js` mengevaluasi tiap
  metrik masuk terhadap ambang di tabel `settings` — disk, RAM, CPU load, latency,
  offline, dan prediksi disk penuh. Notifikasi ke Telegram, badge di baris tabel
  dashboard, halaman `/settings` untuk mengatur ambang dan token bot.
  - **Debouncing**: satu baris `alerts` per insiden. Notifikasi dikirim saat mulai
    dan saat pulih saja — bukan tiap siklus polling 30 detik (kalau tidak, satu
    disk penuh menghasilkan ~120 pesan/jam).
  - **Pengecualian eskalasi**: debouncing tadi sempat menelan kenaikan keparahan
    (disk 92% warning -> 96% critical tidak memberi kabar apa-apa). Diperbaiki
    dengan `SEVERITY_RANK` — notifikasi tetap dikirim kalau severity naik, ditandai
    "MEMBURUK". Ditemukan saat pengujian sendiri, bukan dari laporan.
  - **Load dinormalisasi per core** (`load / cpu_count`) supaya ambang yang sama
    adil untuk mesin 2-core maupun 32-core. Kolom `cpu_count` ditambahkan ke
    `client_metrics`.
- **Push notification browser** (`3a42c43`): Web Push + Service Worker, notifikasi
  tetap sampai walau tab dashboard tertutup. Kunci VAPID di-generate sekali lalu
  disimpan di `settings` — kalau di-generate ulang tiap restart, semua langganan
  yang sudah terdaftar jadi invalid. Kunci privat disaring dari view lewat
  `NEVER_EXPOSE` di `settingsStore`.
  - Pembersihan langganan mati: HTTP 404/410/400 dihapus langsung (permanen);
    kegagalan tanpa `statusCode` (enkripsi gagal lokal) dibuang setelah 5 kali
    beruntun, supaya tabel tidak menumpuk endpoint sampah.
- **Deploy ke produksi** (`mon.kawandev.xyz`, KST Lab): pull + `npm install
  --omit=dev` + `systemctl --user restart oops-server`.
  **Diverifikasi langsung, bukan diasumsikan:** service `active`; keempat client
  (KST Balancer, KST Lab, KST Dev, Services Prod) reconnect otomatis dalam 2 detik;
  tabel `push_subscriptions` ter-migrasi dengan 9 kolom tanpa menyentuh data client
  lama; `/sw.js` HTTP 200 dengan header `Service-Worker-Allowed: /`;
  `push-client.js`, `icon-192.png`, `badge-72.png` semua HTTP 200;
  `/push/*` dan `/settings` menolak akses tanpa login (302 ke `/login`).

### Belum selesai
- **Telegram belum pernah benar-benar mengirim pesan.** Pemilik projek belum
  membuat botnya ("Belum, saya buat dulu nanti"). Alur pengiriman sudah diuji
  dengan HTTP mock, tapi belum ke API Telegram sungguhan. Langkah: buat bot lewat
  @BotFather, tambahkan ke grup, isi token + chat ID di `/settings`, klik
  "Kirim pesan uji".
- **Push belum pernah diterima browser sungguhan.** Nol langganan terdaftar dan
  kunci VAPID belum di-generate (normal — dibuat saat `/settings` pertama dibuka).
  Yang sudah diuji lokal: generate & persistensi kunci, subscribe/duplikat/
  unsubscribe, pembuangan langganan rusak, dan integrasi alert->push menghasilkan
  payload lengkap. Yang belum: satu pun browser nyata menerimanya.
- **Tampilan belum pernah dilihat mata.** Tidak ada browser pane di session ini,
  jadi penurunan kontras hijau (permintaan "agak sakit mata") hanya diverifikasi
  sebagai nilai CSS, bukan secara visual.

### Keputusan
- **VAPID di-generate sendiri dan disimpan di DB**, bukan lewat env var. Alasannya
  satu perintah instalasi lebih sedikit untuk pemilik projek, dan kunci ini tidak
  perlu dibagikan ke mana pun. Konsekuensi yang perlu diingat: **kalau
  `data/oops.sqlite` dihapus/diganti, semua langganan push harus didaftarkan ulang
  di tiap browser** — kuncinya ikut hilang.
- **Langganan push boleh tidak punya pemilik** (`user_id` NULL) kalau session
  merujuk user yang sudah tidak ada. Notifikasi tetap jalan lebih berharga daripada
  gagal total karena foreign key.
- Push dikirim paralel dengan Telegram lewat `Promise.all` — kegagalan salah satu
  tidak boleh menahan atau menggagalkan yang lain.

### Jalan buntu
- **`express.static` menangani `/sw.js` lebih dulu**, sehingga header
  `Service-Worker-Allowed` tidak pernah terkirim dan scope service worker terbatas.
  Urutan middleware di `src/server.js:55` penting — route `/sw.js` **harus** sebelum
  `express.static`. Jangan dipindah.
- **Error handler mengembalikan HTML untuk `/push/*`** yang dipanggil dari
  JavaScript, jadi `res.json()` di sisi klien gagal parse dan pesan errornya
  menyesatkan. Sekarang menjawab JSON untuk path `/push/*`.
- `sqlite3` CLI tidak terpasang di KST Lab — untuk inspeksi DB di sana pakai
  `node -e` dengan `better-sqlite3` yang memang sudah ada di `~/oops`.

### Langkah berikutnya
1. Buka `https://mon.kawandev.xyz/settings`, klik "Aktifkan notifikasi" di tiap
   browser yang ingin menerima, lalu "Kirim tes push" untuk memastikan sampai.
2. Buat bot Telegram lewat @BotFather, tambahkan ke grup, isi token + chat ID di
   `/settings`, klik "Kirim pesan uji".
3. Konfirmasi tampilan hijau sudah nyaman dilihat — belum pernah diverifikasi
   secara visual oleh agent.
4. Kalau semua beres, merge `development` -> `master`.

### Catatan
- Di iPhone/iPad, situs harus ditambahkan ke Home Screen dulu sebelum push bisa
  aktif. Ini ketentuan Apple, bukan batasan implementasi. Sudah ditulis di halaman
  Setting.
- Kredensial yang dipakai session ini (login dashboard, sudo Load Balancer KST)
  hanya dipakai lewat SSH langsung dan **tidak ditulis ke repo mana pun**.
  `deploy/kst-lab.md` mencatat keberadaannya, bukan nilainya.

## 2026-09-30 · MVP dashboard monitoring server (sxops) — dari nol sampai diterima

**Agent:** Claude Code (Sonnet 5)
**Branch:** master · **Commit:** `d9dd295` (+ `PLAN.md` menyusul di commit dokumen sesi ini)

### Selesai
- **Tahap 1 — fondasi** (`444931e`): Express + EJS + SQLite (`better-sqlite3`),
  login session+bcrypt, scheduler `node-cron` polling berkala, cek status
  UP/DOWN via SSH (`ssh2`).
- **Tahap 1b — registry server dari DB + form web** (`a5c8fc8`): awalnya
  direncanakan `servers.yaml` manual, direvisi jadi CRUD lewat form setelah
  pemilik projek minta ("saya ingin config nya di input via browser saja").
- **Tahap 1c — auto-discovery private key** (`e07609c`): form tidak lagi
  minta upload key. App mencoba tiap key di `~/.ssh/` OS tempat app
  berjalan (`src/services/sshKeyDiscovery.js`), plus baca `~/.ssh/config`
  untuk `IdentityFile` per-host. **Tervalidasi ke server nyata pertama kali**:
  `iyan@36.88.32.238:1031` (KST-DEV) — connect + `docker ps -a` berhasil.
- **Jump host — pendekatan shell-out, bukan ProxyJump murni** (`76415a0`):
  implementasi awal (`ssh2` `forwardOut`) gagal secara desain karena di
  setup nyata pemilik projek, private key untuk server internal (mis.
  `10.10.10.5`, Load Balancer KST) **tersimpan di dalam jump host itu
  sendiri**, bukan di mesin tempat app jalan. Diganti: app connect ke jump
  host seperti biasa, lalu jalankan `ssh <target> -- '<command>'` DI DALAM
  shell jump host — meniru kebiasaan manual pemilik projek. Status
  UP/DOWN/UNREACHABLE dibedakan lewat `JumpHostUnreachableError` (class +
  `instanceof`, menggantikan regex string-matching yang rapuh).
- **Fix bug koneksi ganda** (`f862ebd`): `checkServer`+`collectServerInfo`
  awalnya connect SSH 2x terpisah per siklus polling per server — digabung
  jadi 1 koneksi dipakai ulang, setelah laporan nyata timeout intermiten.
- **ss tanpa sudo** (`0736d3f`): awalnya `sudo ss -tulnp` (butuh setup
  sudoers manual di tiap server). Diganti `ss -tulnp` tanpa sudo — cukup
  untuk kebutuhan monitoring (port + status kelihatan, nama proses untuk
  service root memang kosong), menghindari kebutuhan setup sudoers sama
  sekali.
- **Deteksi Docker otomatis** (`feba8a0`): checkbox manual "Ada Docker"
  dihapus. `docker ps -a` selalu dicoba; exit code 127 (command not found)
  → snapshot tidak disimpan, section Docker otomatis tidak tampil.
- **Dashboard sebagai pohon** (`e5b0a37`): server yang jadi jump host
  (root) tampil dulu, anak-anaknya (server via dia) menjorok di bawahnya —
  sebelumnya urutannya acak/insert-order, membingungkan dibaca.
- **Dropdown jump host disaring** (`a81bf02`): hanya server root (tanpa
  `via` sendiri) yang bisa dipilih sebagai jump host — sesuai kondisi nyata
  pemilik projek (bastion selalu diakses langsung, tidak berlapis).
- **Chart latency** (`7fba49e`) dan **monitoring RAM/Disk/CPU load/Uptime**
  (`14006e0`): Chart.js via CDN. Command gabungan (`free -m; df -h /;
  cat /proc/loadavg; uptime -p; nproc`) dijalankan sekali per polling,
  diparse (`src/services/resourceParser.js`), disimpan ke tabel
  `resource_snapshots` baru. Dashboard dapat kolom RAM/Disk (progress bar),
  halaman detail dapat stat cards + grafik RAM%/CPU load historis.
- **Fix progress bar tidak terlihat** (`1d4d8de`): `.usage-bar-fill` pakai
  `<span>` (default `display: inline`), CSS `width` inline diabaikan
  browser pada elemen inline. Tambah `display: block`.
- **Fix bug SERIUS: command ke server via jump host dieksekusi sebagian di
  jump host** (`d9dd295`): `buildRemoteSshCommand()` menyambung command
  majemuk (`free -m; echo ---; df -h /; ...`) tanpa quote jadi satu
  argumen. Shell di JUMP HOST yang menginterpretasi `;`, bukan diteruskan
  utuh ke `ssh` — jadi cuma bagian pertama yang benar-benar sampai ke
  server target, sisanya dieksekusi di jump host. Dampak: semua server
  internal (KST Lab, KST Edura, Load Balancer KST, App/DB/LB/Minio
  Sulteng) menampilkan RAM/disk/load/uptime/docker/port **milik jump
  host**, bukan milik dirinya — ditemukan dari laporan pemilik projek
  ("kenapa disk nya sama semua"). Fix: quote seluruh command jadi satu
  argumen tunggal. Diverifikasi: KST Lab via KST-DEV sekarang beda jelas
  dari KST-DEV (RAM 32GB vs 7.9GB, 32 core vs 4 core, hostname `kst-lab`
  vs `KST-DEV`).
- **Auto-refresh dashboard** (bagian dari `f862ebd`): tombol manual +
  reload tiap 30 detik dengan indikator hitung mundur.
- **9 server nyata diinput ke database pemilik projek** (KST-DEV, Prod
  Sulawesi (AVO), + 7 server internal) — sempat terhapus 2x karena migrasi
  skema (kolom `ssh_key_path` lalu `has_docker` dihapus), diisi ulang
  manual oleh pemilik projek + dibantu script sekali-pakai untuk 8 dari 9.
- **MVP diterima pemilik projek**: "saya rasa di versi awal ini sudah
  cukup secara konsep juga ok. commit ke versi latest ya."

### Belum selesai
- **Jump host berlapis** (bastion ke bastion lain, baru ke target server)
  belum pernah diuji — kode `connect()` rekursif seharusnya mendukung
  (jump host boleh punya `via` sendiri), tapi belum divalidasi ke kasus
  nyata karena topologi pemilik projek saat ini semua bastion diakses
  langsung.
- Notifikasi otomatis (email/Telegram/Slack saat server down) — sengaja
  di luar lingkup MVP (lihat `PLAN.md` bagian "Tidak termasuk").
- Histori resource jangka panjang / agregasi (mis. rata-rata harian) belum
  ada — saat ini cuma raw snapshot 100 titik terakhir per grafik.
- `sudo ss -tulnp` (info proses/PID lengkap) sengaja tidak dipakai lagi —
  kalau nanti dibutuhkan untuk investigasi keamanan, tinggal ganti balik
  command di `statusChecker.js` + setup sudoers manual (didokumentasikan
  di README.md).

### Keputusan
- **Registry server: DB + form web**, bukan file YAML — revisi dari plan
  awal, atas permintaan eksplisit pemilik projek.
- **Private key: auto-discovery dari `~/.ssh/`**, tidak pernah
  diupload/disimpan oleh app — atas permintaan pemilik projek ("harusnya
  dia sudah bisa baca priv key sendiri dari server/OS kita"). Trade-off
  keamanan yang disadari: kompromi mesin tempat app berjalan = kompromi
  semua server yang key-nya bisa dijangkau dari situ. Dicatat di
  `PLAN.md` bagian Risiko.
- **Jump host: shell-out, bukan ProxyJump murni** — dipilih lewat
  `AskUserQuestion` setelah pemilik projek mengungkap bahwa key server
  internal tersimpan di dalam jump host, bukan di mesin app. Trade-off:
  app lewat jump host bisa menjalankan command apa saja yang key di jump
  host itu izinkan — permukaan risiko lebih luas dari sekadar key di
  mesin app sendiri.
- **`ss` tanpa sudo** — dipilih setelah didiskusikan trade-off dengan
  pemilik projek (info proses/PID vs kebutuhan setup sudoers manual di
  tiap server). Bisa diganti balik kapan saja kalau kebutuhan berubah.
- **Docker terdeteksi otomatis**, bukan checkbox manual — setelah kasus
  nyata pemilik projek salah centang untuk Load Balancer KST.
- **Dropdown jump host cuma server root** (tidak mendukung UI untuk jump
  host berlapis) — pemilik projek pilih ini secara eksplisit lewat
  `AskUserQuestion`, walau mengorbankan fleksibilitas jump host berlapis
  di masa depan.

### Jalan buntu
- **ProxyJump murni via `ssh2` `forwardOut`** untuk server dengan `via` —
  implementasi pertama, tervalidasi secara teknis tapi TIDAK COCOK dengan
  topologi nyata pemilik projek begitu dicoba ke server sungguhan. Jangan
  diulang kecuali ada server baru yang memang key-nya ada di mesin app
  (bukan di jump host).
- **Checkbox manual "Ada Docker"** — sempat diimplementasi penuh (Tahap
  1b), lalu dihapus total di sesi ini karena rawan human error (kasus
  nyata: perlu diminta manual uncheck untuk Load Balancer KST).
- **Command majemuk tanpa quote saat dikirim lewat jump host** — jangan
  pernah menyambung command shell mentah (`cmd1; cmd2; ...`) ke dalam
  `ssh ... -- <command>` tanpa membungkusnya sebagai satu argumen
  ter-quote. Ini sumber bug paling serius di sesi ini (data resource/
  docker/port server internal salah tertukar dengan milik jump host,
  tidak error — jadi tidak ketahuan dari log, cuma dari data yang terlihat
  janggal).

### Langkah berikutnya
- Pemilik projek: setelah restart app dengan commit `d9dd295`, cek ulang
  data RAM/Disk/Docker/Port untuk semua 7 server internal (KST Lab, KST
  Edura, Load Balancer KST, App/DB/LB/Minio Sulteng) — sebelumnya semua
  itu menampilkan data jump host, sekarang seharusnya data masing-masing
  server sendiri.
- Buat user produksi kalau belum (`node src/scripts/createUser.js`) —
  `admin`/`testpassword123` dari testing sebaiknya tidak dipakai
  produksi.
- Kalau nanti pemilik projek minta jump host berlapis, mulai dari
  `src/routes/servers.js` fungsi `jumpHostCandidates()` (saat ini
  memfilter `s.via == null`) dan `buildRemoteSshCommand()` di
  `sshClient.js` (saat ini mengasumsikan satu level jump).
- App masih dijalankan manual (`npm start`) di mesin pemilik projek,
  belum di-deploy sebagai systemd service di server kantor 24/7 seperti
  rencana awal (lihat `PLAN.md` bagian Pilihan Teknis, baris
  "Deployment").

### Catatan
- Repo git lokal murni, belum ada remote — `git push` di `/handoff`
  langkah 7 tidak applicable untuk sesi ini.
- Database (`data/sxops.sqlite*`) berisi data server nyata pemilik
  projek, sengaja tidak di-commit (`.gitignore`). Skema sudah stabil
  sejak commit `14006e0` (tabel `resource_snapshots` ditambahkan) — tidak
  ada rencana perubahan skema lagi dalam waktu dekat, jadi risiko harus
  hapus-ulang database seperti 2x sebelumnya di sesi ini seharusnya sudah
  lewat.
- Private key SSH pemilik projek ada di `C:\Users\ASUS TUF A15\.ssh\`
  (`id_ed25519`, `id_rsa`, `id_kst_investigate`, dll) — tidak pernah
  dibaca isinya oleh agent, hanya path-nya yang relevan untuk
  auto-discovery.
