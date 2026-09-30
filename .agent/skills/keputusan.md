---
name: keputusan
description: Gunakan ketika keputusan arsitektur diambil yang mahal dibalik — pilihan database, bentuk skema, batas modul, pilihan antara beberapa opsi yang sama-sama masuk akal. Mencatat konteks, alasan, alternatif yang ditolak, dan konsekuensinya sebagai ADR.
---

# /keputusan

Masalah yang diselesaikan skill ini: agent di session berikutnya melihat
keputusan lama yang tampak aneh, lalu "memperbaikinya" — padahal keputusan itu
punya alasan yang tidak terbaca dari kode.

ADR (Architecture Decision Record) menyimpan alasan itu.

---

## Kapan menulis ADR

Tulis kalau keputusan itu:
- mahal dibalik nanti (pilihan database, bentuk skema, batas modul),
- memilih satu dari beberapa opsi yang sama-sama masuk akal,
- akan tampak salah bagi orang yang tidak tahu konteksnya,
- berasal dari batasan luar (regulasi, biaya, sistem lama).

**Tidak perlu** ADR untuk: gaya penulisan kode, penamaan, pilihan pustaka kecil
yang gampang diganti, hal yang sudah jelas dari kode.

Patokan: kalau seseorang enam bulan lagi mungkin bertanya "kenapa dulu begini?",
tulis ADR.

## Cara menulis

Buat file di `.agent/context/decisions/` dengan nama
`NNNN-judul-ringkas.md` (nomor urut empat digit):

```markdown
# ADR-<NNNN>: <judul>

**Tanggal:** <YYYY-MM-DD>
**Status:** diterima
**Menggantikan:** <ADR-XXXX, kalau ada>

## Konteks
<Keadaan yang memaksa keputusan ini. Batasan yang berlaku. Apa yang sudah
dicoba. Tulis supaya orang yang tidak ikut percakapan tetap paham.>

## Keputusan
<Apa yang diputuskan. Kalimat aktif dan tegas: "Kami memakai X untuk Y.">

## Alasan
<Kenapa ini, bukan yang lain.>

## Alternatif yang ditolak
| Pilihan | Kenapa ditolak |
|---|---|
| ... | ... |

## Konsekuensi
Yang membaik:
- ...

Yang memburuk:
- ...

Yang harus diwaspadai:
- ...

## Kapan ini perlu ditinjau ulang
<Kondisi yang membuat keputusan ini tidak lagi berlaku. Contoh: "kalau pengguna
bersamaan melewati 10 ribu, pilihan SQLite perlu dievaluasi ulang.">
```

## Prinsip

- **Bagian "alternatif yang ditolak" adalah inti ADR.** Tanpa itu, pembaca akan
  mengusulkan ulang opsi yang sudah dipertimbangkan dan dibuang.
- **Tulis konsekuensi yang buruk dengan jujur.** ADR yang hanya berisi kelebihan
  adalah iklan, bukan catatan.
- **Jangan mengubah ADR lama.** Kalau keputusan berubah, tulis ADR baru yang
  menyatakan "Menggantikan ADR-XXXX", lalu ubah status ADR lama jadi
  `digantikan oleh ADR-YYYY`. Riwayat keputusan sama pentingnya dengan
  keputusan itu sendiri.
- Tautkan ADR dari `REPO-MAP.md` kalau menyangkut area utama.

## Langkah akhir

Commit ADR-nya, dan sebutkan di entri jurnal session ini.
