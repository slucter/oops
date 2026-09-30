# Status Kerja Saat Ini

> **File ini adalah penyelamat saat konteks session habis atau ter-compact.**
>
> Agent: perbarui file ini **setiap kali menyelesaikan satu langkah berarti** —
> jangan tunggu akhir session. Kalau konteks tiba-tiba terpotong, file ini
> satu-satunya yang tahu kamu sedang di mana.
>
> Isinya ditimpa (bukan ditambah). Riwayat panjang tempatnya di `JOURNAL.md`.

---

**Diperbarui:** _(belum pernah)_
**Agent:** —
**Branch:** —

## Sedang mengerjakan
_(satu kalimat: tugas apa yang sedang berjalan sekarang)_

## Kenapa
_(konteks singkat: kenapa tugas ini dikerjakan, apa yang memicunya)_

## Sudah dilakukan di session ini
- _(langkah yang sudah selesai, dengan file:baris kalau relevan)_

## Langkah berikutnya yang konkret
1. _(langkah paling dekat — cukup jelas untuk langsung dikerjakan)_
2. _(berikutnya)_

## Yang sudah dicoba dan gagal
- _(supaya tidak diulang setelah konteks hilang)_

## Berkas yang sedang disentuh
- _(daftar file yang sedang dalam perubahan)_

## Catatan penting
_(keputusan yang diambil di tengah jalan, temuan tak terduga, hambatan)_

---

## Cara memakai file ini

**Saat konteks baru saja ter-compact atau session baru dimulai di tengah kerja:**
baca file ini lebih dulu, sebelum apa pun. Dia memberi tahu posisimu persis.

**Saat selesai satu langkah:** perbarui bagian "Sudah dilakukan" dan "Langkah
berikutnya". Cukup beberapa detik, tapi menyelamatkan session kalau terpotong.

**Saat session benar-benar selesai:** jalankan `/handoff` — isinya dipindahkan
ke `JOURNAL.md` sebagai entri permanen, lalu file ini dikosongkan kembali.
