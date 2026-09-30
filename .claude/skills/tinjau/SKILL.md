---
name: tinjau
description: Gunakan ketika pemilik projek minta kode diperiksa — "coba cek", "menurutmu gimana", "tolong review", "ada yang salah tidak", sebelum merge atau sebelum diserahkan. Mencari cacat yang benar-benar bisa menyebabkan kegagalan, bukan keluhan gaya penulisan.
---

# /tinjau [target: perubahan belum ter-commit, branch, atau PR]

Tinjauan yang berguna menemukan hal yang **akan rusak**. Tinjauan yang tidak
berguna mengeluhkan penamaan variabel dan menyarankan abstraksi yang tidak
diminta.

Skill ini mengejar yang pertama.

---

## Langkah 1 — Lihat perubahannya

```bash
git diff                    # belum di-stage
git diff --staged           # sudah di-stage
git diff main...HEAD        # seluruh branch
```

Baca **seluruh** diff sebelum berkomentar apa pun. Cacat sering muncul dari
interaksi antar-bagian, bukan dari satu baris.

## Langkah 2 — Pahami maksudnya

Sebelum menilai, pahami apa yang seharusnya dicapai perubahan ini — dari pesan
commit, jurnal, atau `PLAN.md`.

Kamu tidak bisa menilai apakah kode benar tanpa tahu apa artinya "benar" di sini.

## Langkah 3 — Cari cacat

Urut dari yang paling berdampak:

**Kebenaran**
- Ada jalur yang menghasilkan nilai salah? Susun kasusnya secara konkret:
  masukan apa, keluarannya jadi apa.
- Kasus tepi: kosong, nol, negatif, null, sangat besar, karakter unicode.
- Kondisi balapan, operasi async tanpa `await`, urutan yang tidak dijamin.
- Error yang tertelan diam-diam.

**Dampak ke luar**
- Siapa lagi yang memanggil fungsi yang diubah? Apakah kontraknya berubah?
  ```bash
  grep -rn "namaFungsi" --include=*.{ts,js,py,go} . | grep -v node_modules
  ```
- Apakah perubahan skema database kompatibel dengan data lama?
- Apakah ada API publik yang berubah bentuk?

**Keamanan**
- Masukan tak tepercaya sampai ke query, perintah shell, atau render HTML?
- Ada pemeriksaan otorisasi yang hilang di endpoint baru?
- Rahasia ter-*hardcode* atau ter-log?

**Bukti**
- Apakah ada test yang membuktikan perubahan ini benar?
- Kalau ini perbaikan bug, apakah ada test yang **gagal sebelumnya**?

**Kebersihan**
- Kode percobaan, `console.log`, `TODO` yang ditinggal diam-diam?
- Fungsi yang sekarang jadi tidak terpakai?

## Langkah 4 — Verifikasi setiap temuan

Sebelum melaporkan, buktikan ke dirimu sendiri: **masukan apa yang menghasilkan
kegagalan apa?**

Kalau kamu tidak bisa menyusun skenario kegagalan yang konkret, itu bukan cacat
— itu preferensi. Buang.

Baca kode di sekitarnya sebelum menyimpulkan ada yang salah. Sering kali
penanganan yang kamu kira hilang ada beberapa baris di atas.

## Langkah 5 — Laporkan

Urut dari yang paling parah:

```markdown
### <parah/sedang/ringan> · `path/file.ts:42`

<Cacatnya apa, satu kalimat.>

**Kapan gagal:** <masukan atau keadaan konkret → akibatnya>

**Usulan:** <perbaikan konkret>
```

Kalau tidak menemukan cacat nyata, katakan begitu. Jangan mengarang temuan
supaya tinjauan terlihat berisi.

Pisahkan dengan jelas antara **cacat** (harus diperbaiki) dan **saran** (boleh
diabaikan). Jangan mencampur keduanya dalam satu daftar.

## Yang tidak perlu dikomentari

- Gaya penulisan yang sudah ditangani formatter
- Preferensi penamaan kalau namanya sudah cukup jelas
- Saran abstraksi untuk kode yang baru muncul dua kali
- Optimasi performa tanpa pengukuran yang menunjukkan ada masalah
- Penulisan ulang yang tidak diminta
