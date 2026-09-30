# Jurnal Session

Entri terbaru di **paling atas**. Ditulis oleh skill `/handoff` di akhir tiap
session, dibaca oleh `/lanjut` di awal session berikutnya.

Aturan: jangan pernah menulis nilai rahasia di sini. Sebut namanya saja
("kredensial DB staging tersedia sebagai `DATABASE_URL`").

---

<!-- Entri baru ditambahkan tepat di bawah baris ini -->

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
