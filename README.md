# sxops — Dashboard Monitoring via Agent WebSocket

Dashboard web untuk memantau status UP/DOWN, RAM, disk, CPU load, Docker,
dan port listen dari banyak server — tanpa SSH. Server yang dipantau
("client") menjalankan agent kecil yang **connect keluar** ke dashboard ini
lewat WebSocket dan mengirim datanya sendiri secara berkala.

> Versi sebelumnya (SSH pull + jump host) diarsipkan di branch `v1` /
> tag `v1.0`.

## Arsitektur singkat

1. Di dashboard, klik **"+ Tambah Client"** → sistem generate token unik dan
   menampilkan satu baris command instalasi.
2. Command itu dijalankan di server yang mau dipantau (user biasa, tidak
   perlu root):
   ```bash
   curl -fsSL "https://mon.kawandev.xyz/install.sh?token=<token>" | bash
   ```
3. Script instalasi mendownload agent (Node.js), mendaftarkannya sebagai
   `systemd --user` service dengan `Restart=always`, dan menjalankannya.
4. Agent connect ke dashboard lewat WebSocket (`/agent?token=...`), mengirim
   metrik (RAM/disk/CPU load/uptime/hostname) tiap 30 detik, dan merespons
   permintaan `docker ps -a` / `ss -tulnp` saat pemilik dashboard membuka
   halaman detail client.
5. Kalau agent berhenti mengirim metrik lebih dari `CLIENT_STALE_SECONDS`
   (default 90 detik), client otomatis ditandai DOWN.

## Setup server monitoring

```bash
npm install
cp .env.example .env
# isi SESSION_SECRET dengan string acak (mis. `openssl rand -hex 32`)
# isi PUBLIC_BASE_URL dengan URL publik dashboard ini (wajib untuk produksi,
# dipakai menyusun command instalasi dan URL yang dituju agent)

node src/scripts/createUser.js <username> <password>
npm start
```

Buka `http://localhost:3000`, login, lalu "+ Tambah Client" untuk mulai.

## Master Group

Menu **"Master Group"** (link di header dashboard) untuk kelola daftar grup
secara terpisah dari client. Client yang sudah terdaftar (dengan status
apa pun — pending/up/down) bisa di-assign ke grup lewat halaman edit
client. Grup yang dihapus tidak menghapus client di dalamnya — client itu
otomatis pindah ke "Belum dikelompokkan".

## Docker & port listen (on-demand)

Berbeda dari metrik dasar (push otomatis tiap 30 detik), `docker ps -a` dan
`ss -tulnp` diambil **on-demand** — server mengirim permintaan lewat
WebSocket saat tombol "Refresh Docker"/"Refresh Port" diklik di halaman
detail client, agent jalankan command dan balas hasilnya (timeout 10
detik). Kalau client sedang tidak terkoneksi, tombol akan menampilkan
pesan jelas alih-alih gagal diam-diam.

`ss -tulnp` dijalankan tanpa sudo di agent (sama seperti v1) — nama
proses/PID untuk service yang jalan sebagai root tidak akan terlihat,
tapi port dan statusnya tetap ada.

## Keamanan

- **Endpoint WebSocket publik ke internet** — token client (24 byte acak,
  hex) divalidasi saat handshake, sebelum koneksi diterima. Token bisa
  dicabut per-client (tombol "Buat ulang token" di halaman edit client)
  tanpa memengaruhi client lain.
- **Payload dari agent adalah klaim sepihak** — divalidasi ketat dari sisi
  tipe data dan ukuran (`src/services/payloadValidator.js`), tapi app tidak
  bisa (dan tidak berusaha) memverifikasi kebenaran isinya. Ini batasan
  yang disadari, bukan bug.
- **`install.sh` WAJIB disajikan lewat HTTPS di produksi** — script itu
  dieksekusi langsung (`| bash`) di server client; kalau traffic-nya bisa
  disadap (HTTP polos), script bisa diganti jadi apa saja. Reverse proxy
  (nginx) di depan app ini harus pegang TLS sebelum dipakai instalasi
  sungguhan.
- Agent jalan sebagai **user biasa** (bukan root), lewat `systemd --user` +
  `loginctl enable-linger` supaya tetap hidup lewat reboot tanpa perlu user
  login aktif.

## Struktur

- `src/ws/server.js` — WebSocket server: autentikasi token, terima
  metrik/command_result, kirim command, deteksi client stale → DOWN
- `src/services/clientStore.js` — CRUD client + token (tabel `clients`)
- `src/services/groupStore.js` — CRUD Master Group (tabel `groups`)
- `src/services/clientDataService.js` — simpan metrik, catat perubahan
  status, upsert hasil command on-demand
- `src/services/payloadValidator.js` — validasi tipe/ukuran payload dari
  agent sebelum diproses
- `src/routes/install.js` — endpoint `/install.sh` (generate script bash)
- `src/routes/clients.js`, `src/routes/groups.js` — CRUD via web
- `agent/agent.js` — kode agent yang jalan di server client (Node.js,
  di-download oleh `install.sh`, bukan bagian dari server ini)
- `agent/resourceParser.js` — parser `free`/`df`/`loadavg` (dipakai agent,
  jalan lokal di client — bukan lewat SSH)
- `data/sxops.sqlite` — database (client, metrik, hasil command) — tidak
  di-commit
