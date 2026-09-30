---
name: loop
description: Gunakan ketika pemilik projek minta sesuatu DIPANTAU BERULANG sampai suatu kondisi tercapai — status CI, proses deploy, log bot yang sedang berjalan, antrean. Bukan untuk mengeksekusi rencana bertahap (itu kerjakan).
---

# /loop [interval] [apa yang dipantau]

Untuk pekerjaan yang perlu **diperiksa berulang kali** sampai suatu kondisi
tercapai: menunggu CI selesai, memantau deploy, mengawasi bot yang baru
dijalankan, menunggu antrean kosong.

> **Ini bukan `/kerjakan`.** `/kerjakan` mengeksekusi rencana bertahap sampai
> selesai. `/loop` memeriksa keadaan yang berubah di luar kendalimu, berulang,
> sampai kondisinya terpenuhi.

---

## Kalau kamu Claude Code

Ada fitur bawaan `/loop`:

```
/loop 5m periksa status CI di branch ini, laporkan kalau gagal
/loop     pantau log bot, laporkan kalau ada error        (interval otomatis)
```

Tanpa interval, agent menentukan sendiri jedanya berdasarkan seberapa cepat
keadaan yang dipantau berubah.

Pakai itu — lebih baik daripada mengulang perintah manual.

## Kalau kamu agent lain

Fitur `/loop` tidak ada, tapi polanya bisa ditiru dengan shell:

```bash
# Tunggu sampai kondisi terpenuhi, maksimal 20 kali
for i in $(seq 1 20); do
  if <perintah-pemeriksaan>; then
    echo "kondisi terpenuhi di percobaan ke-$i"
    break
  fi
  echo "percobaan $i — belum, tunggu 30 detik"
  sleep 30
done
```

Contoh nyata:

```bash
# Tunggu CI selesai
for i in $(seq 1 20); do
  st=$(gh run list --limit 1 --json status,conclusion -q '.[0].status')
  [ "$st" = "completed" ] && { gh run list --limit 1; break; }
  sleep 30
done

# Pantau bot sampai muncul error
timeout 300 tail -f bot.log | grep -m1 -E 'ERROR|CRITICAL'
```

---

## Aturan yang berlaku untuk keduanya

**Selalu batasi jumlah putaran.** Loop tanpa batas yang menunggu kondisi yang
tidak akan pernah terpenuhi akan berputar selamanya — memboroskan waktu dan,
untuk agent berbayar, memboroskan biaya.

**Pilih jeda sesuai kecepatan perubahan.** CI yang butuh 8 menit tidak perlu
dicek tiap 10 detik; sekali cek tiap 2 menit sudah cukup. Memeriksa terlalu
sering hanya menambah beban tanpa mempercepat apa pun.

**Laporkan hanya saat ada perubahan berarti.** Melaporkan "masih menunggu" dua
puluh kali berturut-turut tidak berguna. Laporkan saat: kondisi terpenuhi,
terjadi kegagalan, atau batas putaran tercapai.

**Berhenti saat kondisinya sudah jelas.** Kalau CI sudah gagal, tidak ada
gunanya menunggu putaran berikutnya — langsung laporkan.

**Jangan pakai loop untuk menunggu pekerjaanmu sendiri.** Kalau kamu menjalankan
perintah di latar belakang, tunggu hasilnya secara langsung. Loop untuk keadaan
**eksternal** yang tidak akan memberitahumu sendiri.

---

## Kapan sebaiknya tidak memakai loop

- Pekerjaan bertahap yang sudah ada rencananya → `/kerjakan`
- Sesuatu yang bisa diselesaikan sekali jalan → kerjakan langsung
- Menunggu keputusan pemilik projek → tanya, lalu berhenti dan tunggu

Loop yang dipasang untuk hal yang tidak berubah hanyalah cara mahal untuk
menunggu.
