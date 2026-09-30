# sxops — Dashboard Monitoring Server

Dashboard web untuk memantau status UP/DOWN server kantor dan client,
termasuk server internal di balik jump host, beserta info Docker dan port
yang listen.

## Setup

```bash
npm install
cp .env.example .env
# isi SESSION_SECRET di .env dengan string acak (mis. `openssl rand -hex 32`)

node src/scripts/createUser.js <username> <password>
```

Daftar server (host, port, user, jump host) ditambahkan lewat form web
setelah login, di menu "+ Tambah Server" pada dashboard — tidak perlu edit
file config, dan **tidak ada private key yang diupload**.

## Cara kerja autentikasi SSH

App tidak menyimpan private key sama sekali. Saat connect ke sebuah server,
app mencoba tiap key yang ditemukan di `~/.ssh/` milik OS tempat app ini
berjalan — sama seperti perilaku `ssh` command biasa — sampai ada yang
berhasil. Kalau `~/.ssh/config` punya blok `Host <alias>` yang cocok dengan
hostname target beserta `IdentityFile`, key itu dicoba lebih dulu.

Syarat:

- Key sudah ter-otorisasi (`authorized_keys`) di server target — setup ini
  di luar app, sama seperti setup SSH manual yang biasa dipakai.
- Key **tidak boleh punya passphrase** — app jalan otomatis/unattended,
  tidak ada tempat untuk memasukkan passphrase secara interaktif.
- App harus dijalankan dengan user yang `$HOME/.ssh/`-nya berisi key-key
  itu. Kalau nanti dijalankan sebagai systemd service dengan user khusus,
  pastikan key ada di `~/.ssh/` user tersebut (atau set `SSH_DIR` di `.env`).

**Implikasi keamanan:** karena semua key di `~/.ssh/` dicoba ke server
manapun yang didaftarkan, kompromi pada mesin tempat app ini berjalan
berarti kompromi pada semua server yang key-nya ada di situ. App ini
sebaiknya berjalan di server yang sudah di-harden, dan dashboard-nya
sendiri diproteksi login (lihat di bawah).

## Prasyarat di tiap server target

Port listen dicek dengan `ss -tulnp` **tanpa sudo** — sengaja, supaya tidak
perlu setup apa pun di server target untuk fitur ini. Konsekuensinya: nama
proses/PID untuk service yang jalan sebagai root (nginx, docker daemon,
dll) tidak akan terlihat, hanya port dan statusnya. Cukup untuk kebutuhan
"server hidup, port apa yang kebuka" — kalau nanti perlu info proses
lengkap (mis. untuk investigasi keamanan), command ini bisa diganti balik
ke `sudo ss -tulnp` di `src/services/statusChecker.js`, dengan syarat user
SSH diberi `NOPASSWD` sudo **khusus** untuk `ss` di server itu (cek path
pastinya dengan `which ss`, lalu `visudo -f /etc/sudoers.d/sxops`).

Kalau server itu juga punya Docker dan dicentang "Ada Docker" di form, pastikan
user SSH tergabung di group `docker` (`sudo usermod -aG docker <user>`) supaya
`docker ps -a` tidak perlu sudo terpisah.

## Menjalankan

```bash
npm start
```

Buka `http://localhost:3000`, login dengan user yang dibuat lewat
`createUser.js`. Scheduler polling berjalan otomatis di proses yang sama
(interval diatur lewat `CHECK_INTERVAL_MINUTES` di `.env`, default 2 menit).

## Struktur

- `src/services/serverStore.js` — CRUD server (tabel `servers` di SQLite)
- `src/services/sshKeyDiscovery.js` — cari private key di `~/.ssh/`, baca `~/.ssh/config`
- `src/services/sshClient.js` — koneksi SSH (coba tiap key sampai berhasil), termasuk chaining lewat jump host (`via`)
- `src/services/statusChecker.js` — cek status + ambil `docker ps -a` / `ss -tulnp`
- `src/scheduler/` — polling berkala
- `src/routes/`, `src/views/` — web app (Express + EJS)
- `data/sxops.sqlite` — database (server, hasil cek) — tidak di-commit
