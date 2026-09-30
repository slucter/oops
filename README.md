# sxops — Dashboard Monitoring Server

Dashboard web untuk memantau status UP/DOWN server kantor dan client,
termasuk server internal di balik jump host, beserta info Docker dan port
yang listen.

## Setup

```bash
npm install
cp .env.example .env
# isi SESSION_SECRET di .env dengan string acak (mis. `openssl rand -hex 32`)

cp config/servers.example.yaml config/servers.yaml
# edit config/servers.yaml sesuai server nyata (host, user, path private key, jump host)

node src/scripts/createUser.js <username> <password>
```

## Prasyarat di tiap server target

User SSH yang dipakai butuh izin sudo tanpa password, dibatasi hanya untuk
command yang dipakai dashboard ini (jangan beri full sudo). Tambahkan di
server target lewat `visudo -f /etc/sudoers.d/sxops`:

```
<user> ALL=(root) NOPASSWD: /usr/sbin/ss
```

Kalau server itu juga punya Docker dan `has_docker: true` di config, pastikan
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

- `config/servers.yaml` — daftar server (tidak di-commit, lihat `.gitignore`)
- `src/services/sshClient.js` — koneksi SSH, termasuk chaining lewat jump host (`via`)
- `src/services/statusChecker.js` — cek status + ambil `docker ps -a` / `sudo ss -tulnp`
- `src/scheduler/` — polling berkala
- `src/routes/`, `src/views/` — web app (Express + EJS)
- `data/sxops.sqlite` — database hasil cek (tidak di-commit)
