---
name: perbaiki
description: Gunakan ketika ada yang RUSAK dan ADA pesan error atau stack trace yang jelas — "error", "gagal", "tidak jalan", "kenapa begini", disertai pesan error. Memetakan alur kode dulu, reproduksi, cari akar masalah, perbaiki sesempit mungkin, buktikan. JANGAN pakai ini kalau botnya gagal tanpa pesan error — pakai debug-bot.
---

# /perbaiki [deskripsi masalah]

Dua kegagalan paling umum dalam perbaikan bug:

1. Menambal gejala tanpa memahami penyebab — bug kembali dalam bentuk lain.
2. **Memperbaiki tanpa memahami alur** — perbaikannya benar secara lokal, tapi
   merusak sesuatu di hulu atau hilir yang tidak pernah dilihat.

Skill ini memaksakan urutan yang mencegah keduanya. Yang pertama dan terpenting:
**pahami alurnya dulu, jangan langsung menyentuh kode.**

> **Kalau ini bot atau automation dan tidak ada pesan error yang jelas** —
> hasilnya salah/kosong tapi tidak *crash*, berhenti sendiri tanpa jejak, atau
> kadang jalan kadang tidak — pakai `/debug-bot`. Skill ini mengandalkan
> reproduksi dan *stack trace*; kalau keduanya tidak ada, prosedurnya tidak
> berlaku.

---

## Langkah 0 — Muat konteks projek

Kalau belum dilakukan di session ini, baca dulu:
- `.agent/context/REPO-MAP.md` — khususnya bagian **alur utama**, **aturan tak
  tertulis**, dan **area rawan**
- `.agent/context/JOURNAL.md` entri terakhir — mungkin bug ini akibat perubahan
  kemarin
- ADR yang menyangkut area terkait — mungkin perilaku yang tampak seperti bug
  itu sebenarnya **disengaja**

Poin terakhir penting. Sebelum menyebut sesuatu bug, pastikan itu bukan
keputusan sadar yang alasannya tercatat. Kalau ada ADR yang menjelaskannya,
sampaikan ke pemilik projek sebelum mengubah apa pun.

## Langkah 1 — Petakan alurnya

**Belum boleh menulis perbaikan.** Tugas di tahap ini cuma satu: memahami
bagaimana kode ini bekerja ketika berjalan normal.

Telusuri jalur lengkap dari titik masuk sampai titik keluar:

- Dari mana permintaan/aksi ini bermula? (route, handler event, perintah CLI,
  pekerjaan terjadwal)
- Lewat fungsi apa saja sampai ke titik gagal? Catat berurutan dengan
  `file:baris`.
- Data apa yang mengalir, dan berubah bentuk di mana saja?
- Efek samping apa yang terjadi sepanjang jalan? (tulis ke database, panggil API
  luar, cache, kirim event)
- Di mana batas modulnya — apa kontrak antar-lapisan?

Cara menelusuri: baca titik masuk, ikuti pemanggilan fungsi satu per satu.
`grep` nama fungsi untuk menemukan **semua** pemanggilnya, bukan cuma yang
terlihat.

Lalu jawab: **siapa lagi yang memakai kode ini?**

```bash
grep -rn "namaFungsi" --include=*.{ts,js,py,go} . | grep -v node_modules
```

Ini yang menentukan seberapa jauh dampak perbaikanmu. Fungsi yang dipanggil satu
tempat aman diubah; yang dipanggil dua belas tempat butuh kehati-hatian.

Tulis ringkasan alurnya untuk dirimu sendiri sebelum lanjut. Kalau kamu tidak
bisa menuliskan alurnya dalam 5 baris, kamu belum paham — teruskan menelusuri.

## Langkah 2 — Reproduksi

**Jangan memperbaiki apa pun sebelum kamu melihat bug-nya terjadi.**

Kumpulkan dari pemilik projek: langkah pemicu, yang diharapkan, yang terjadi,
pesan error lengkap beserta *stack trace*.

Lalu picu sendiri. Kalau tidak bisa direproduksi, itu sendiri temuan penting —
sampaikan dan gali (beda lingkungan? beda data? kondisi balapan yang hanya
kadang muncul?).

Perbaikan tanpa reproduksi adalah tebakan. Katakan terus terang kalau kamu
terpaksa menebak.

## Langkah 3 — Persempit

Temukan baris yang bertanggung jawab:

- Telusuri *stack trace* dari bawah ke atas sampai masuk kode projek.
- `git log -p <file>` atau `git bisect` kalau dulu pernah berfungsi.
- Periksa asumsi di perbatasan: null, array kosong, tipe tak terduga, urutan
  eksekusi, kondisi balapan.
- Bandingkan dengan alur yang kamu petakan di Langkah 1 — di titik mana
  kenyataan menyimpang dari yang kamu kira?
- Log sementara boleh. **Hapus setelah selesai.**

## Langkah 4 — Pahami akar masalah

Sebelum mengetik perbaikan, jawab empat pertanyaan:

1. **Kenapa kode ini salah?** Asumsi apa yang dilanggar?
2. **Kenapa tidak ketahuan lebih awal?** Ada lubang di test atau validasi?
3. **Ada tempat lain dengan cacat yang sama?** Cari polanya.
4. **Apakah perbaikannya akan mengganggu pemanggil lain** yang kamu temukan di
   Langkah 1?

Kalau kamu tidak bisa menjawab nomor 1, kamu belum paham bug-nya — kembali ke
Langkah 3.

## Langkah 5 — Tentukan lapisan yang benar

Bug yang sama sering bisa ditambal di beberapa tempat. Pilih yang **paling dekat
dengan penyebab**, bukan yang paling dekat dengan gejala.

Contoh: nilai null meledak di lapisan tampilan. Bisa ditambal dengan pengecekan
null di tampilan, tapi kalau asalnya adalah query yang seharusnya tidak pernah
mengembalikan null, perbaikan yang benar ada di query — bukan di tampilan.

Kalau kamu ragu antara dua lapisan, tanyakan ke pemilik projek dengan
menjelaskan pertukarannya.

## Langkah 6 — Perbaiki sesempit mungkin

- Perbaiki **penyebab**, bukan gejala. Menangkap exception lalu mengabaikannya
  bukan perbaikan.
- Ubah sesedikit mungkin. Perbaikan bug bukan kesempatan menata ulang kode.
- Kalau melihat masalah lain di sekitarnya, **catat dan laporkan**, jangan ikut
  diperbaiki. Perbaikan yang tercampur sulit ditinjau dan sulit di-*revert*.

## Langkah 7 — Buktikan

Wajib:
1. Jalankan langkah reproduksi Langkah 2. Harus sudah tidak terjadi.
2. Jalankan seluruh test suite.
3. **Uji pemanggil lain** yang kamu temukan di Langkah 1 — ini yang paling
   sering terlewat.
4. Uji kasus tepi di sekitar perbaikan.

Sangat dianjurkan: tulis test yang **gagal sebelum** perbaikan dan **lulus
sesudahnya**. Itu satu-satunya jaminan bug ini tidak kembali diam-diam.

Kalau kamu tidak bisa menjalankan verifikasi, **katakan eksplisit** bahwa
perbaikannya belum teruji.

## Langkah 8 — Commit

```
fix(<lingkup>): <apa yang sekarang berfungsi benar>

<Akar masalahnya apa. Kenapa perbaikan ini menyelesaikannya.>
```

Jelaskan akar masalah di badan commit, bukan gejalanya.

## Langkah 9 — Lapor

- Alur yang kamu petakan, ringkas
- Bug-nya apa dan **penyebabnya** apa
- Yang diubah, dengan `file:baris`
- Diverifikasi bagaimana — termasuk pemanggil lain yang ikut diuji
- Masalah lain yang kamu temukan tapi **tidak** kamu perbaiki

Kalau bug ini mengungkap cacat rancangan yang lebih dalam, katakan — dan
tawarkan menulis ADR, jangan langsung menata ulang.
