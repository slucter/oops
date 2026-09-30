# Deploy KST Lab — catatan operasional

Bukan bagian dari aplikasi, hanya catatan untuk siapa pun yang perlu
mengelola instance produksi ini nanti.

## Lokasi

- Server: KST Lab, `10.10.10.15:1500` (juga bisa diakses langsung dari
  `36.88.32.238:1500` — dikonfirmasi pemilik projek, tanpa perlu lewat
  jump host KST-DEV lagi)
- Kode: `~/oops` (user `iyan`), branch `development`
- Port aplikasi: `1509` (dicek dulu via `ss -tulnp` — port 1500-1508
  sudah dipakai service lain di server ini, jangan pakai)
- Reverse proxy publik: nginx di Load Balancer KST (`10.10.10.5`, hostname
  `kst-service-kepeg`, akses lewat KST Lab sebagai perantara — tidak
  reachable langsung dari luar jaringan KST) → `https://mon.kawandev.xyz`
  (SSL Let's Encrypt via Certbot, auto-renewal terjadwal, expire
  2026-12-29). Config: `/etc/nginx/sites-available/mon.kawandev.xyz.conf`
  di Load Balancer KST. Proxy meneruskan `/agent` (WebSocket, dengan
  header Upgrade) dan `/` (HTTP biasa) sama-sama ke `10.10.10.15:1509`.
- **Live sejak 2026-09-30**: `https://mon.kawandev.xyz` diverifikasi
  bekerja dari internet publik (halaman login, redirect HTTP→HTTPS,
  dan `wss://mon.kawandev.xyz/agent` — token invalid ditolak 401
  seperti dirancang, konfirmasi WebSocket upgrade diteruskan nginx
  dengan benar).

## Akun

- Login dashboard: user `kawan` (password diset langsung oleh pemilik
  projek saat pembuatan, tidak dicatat di repo manapun)
- SSH ke KST Lab: key yang sama seperti biasa dipakai pemilik projek,
  `~/.ssh/` di mesin dev — bisa langsung ke `36.88.32.238:1500` tanpa
  password, tanpa perlu lewat jump host KST-DEV
- SSH ke Load Balancer KST (`10.10.10.5:22`): IP privat, HARUS lewat
  perantara (mis. dari KST Lab). User `iyan`, sudo BUTUH password
  (beda dari KST Lab yang NOPASSWD) — password tidak dicatat di repo

## Service

Dijalankan sebagai `systemctl --user` (bukan system-wide), dengan
`loginctl enable-linger iyan` supaya tetap hidup setelah reboot server
tanpa perlu login manual. Detail unit file ada di
`~/.config/systemd/user/oops-server.service` di server itu sendiri
(bukan di repo — dibuat langsung saat deploy).

Cek status: `systemctl --user status oops-server`
Lihat log: `journalctl --user -u oops-server -f`

## Update kode

```bash
cd ~/oops
git pull origin development
npm install --production
systemctl --user restart oops-server
```
