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
- Reverse proxy publik: nginx di Load Balancer KST → `mon.kawandev.xyz`

## Akun

- Login dashboard: user `kawan` (password diset langsung oleh pemilik
  projek saat pembuatan, tidak dicatat di repo manapun)
- SSH ke KST Lab: key yang sama seperti biasa dipakai pemilik projek,
  `~/.ssh/` di mesin dev

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
