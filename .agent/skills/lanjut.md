---
name: lanjut
description: Gunakan di AWAL setiap session, sebelum menyentuh kode — juga ketika pemilik projek bilang "lanjut", "kemarin sampai mana", "sudah sampai mana", atau langsung memberi tugas di projek yang sudah berjalan. Memuat peta repo, jurnal terakhir, status kerja yang tergantung, keputusan, dan kredensial, lalu melaporkan posisi terakhir.
---

# /lanjut

Dijalankan di **awal** session, terutama kalau session sebelumnya bukan kamu
atau bukan agent yang sama. Tujuannya: dalam beberapa menit, kamu punya
pemahaman yang setara dengan agent yang baru saja menutup session kemarin.

Jalankan ini juga ketika pemilik projek membuka dengan kalimat seperti
"lanjutkan", "kemarin sampai mana", atau langsung memberi tugas di projek yang
sudah berjalan.

---

## Langkah 0 — Muat konteks otomatis

Cara tercepat, jalan di agent manapun:

```bash
bash .agent/scripts/muat-konteks.sh
```

Skrip itu mencetak kondisi git, peta repo, jurnal terakhir, daftar ADR,
preferensi pemilik projek, dan kredensial yang tersedia — dalam satu keluaran.

Kalau skripnya tidak ada atau gagal, baca manual lewat Langkah 1.

## Langkah 0b — Ada kerja yang tergantung?

```bash
cat .agent/context/WORKING-STATE.md
```

Kalau file itu **terisi** (bukan kerangka kosong), berarti session sebelumnya
terputus di tengah kerja — entah konteksnya habis, ter-compact, atau ditutup
mendadak. Isinya memberi tahu posisi persisnya.

Dalam hal itu: jangan memulai sesuatu yang baru. Lanjutkan dari situ, tapi
verifikasi dulu dengan `git status` dan `git diff` apa yang **sudah benar-benar
terjadi** — jangan mengulang pekerjaan yang ternyata sudah selesai.

## Langkah 1 — Baca berkas konteks

Kalau Langkah 0 berhasil, bagian ini opsional. Baca berurutan:

1. `.agent/rules/00-core.md` — aturan yang mengikat
2. `.agent/rules/10-git.md` — kalau ini repo git
3. `.agent/context/REPO-MAP.md` — bentuk projek
4. `.agent/context/JOURNAL.md` — **entri paling atas**, plus 2-3 entri di
   bawahnya kalau yang teratas merujuk ke sana
5. `.agent/context/PLAN.md` — kalau ada, lihat tahap mana yang sedang berjalan
6. `.agent/context/decisions/` — daftar judulnya; baca isinya hanya yang
   relevan dengan tugas sekarang
7. `.agent/memory/MEMORY.md` — preferensi pemilik projek
8. `.env.example` — kredensial yang tersedia

Kalau sebagian file belum ada, itu sinyal projeknya baru atau harness baru
dipasang. Lanjutkan dengan yang ada, dan catat mana yang perlu dibuat.

## Langkah 2 — Periksa kondisi nyata

Dokumen bisa basi. Periksa keadaan sebenarnya:

```bash
git status
git log --oneline -15
git branch --show-current
```

Perhatikan:
- Ada perubahan yang belum ter-commit? Itu kerja yang tergantung di tengah.
- Branch sekarang apa? Cocok dengan yang disebut jurnal?
- Commit terakhir sesuai dengan yang diklaim jurnal?

**Kalau dokumen dan kenyataan bertentangan, percayai kenyataan.** Jurnal
mencatat apa yang benar saat ditulis, bukan apa yang benar sekarang. Perbarui
dokumen yang ternyata salah.

## Langkah 3 — Verifikasi cepat

Kalau jurnal terakhir mengklaim sesuatu "sudah selesai dan jalan", dan langkah
berikutnya bergantung pada klaim itu, buktikan dulu — jalankan test, atau
nyalakan aplikasinya. Membangun di atas klaim yang ternyata salah jauh lebih
mahal daripada satu perintah verifikasi.

## Langkah 4 — Lapor

Sampaikan ringkas, tanpa daftar berjudul panjang:

- Projek ini apa, satu kalimat.
- Posisi terakhir: tahap/tugas apa yang sedang berjalan.
- Kondisi git: branch, ada perubahan menggantung atau tidak.
- Hambatan atau pertanyaan terbuka yang tercatat di jurnal.
- Usulan langkah berikutnya — satu usulan konkret, bukan daftar pilihan.

Lalu tunggu arahan. Jangan langsung mulai mengerjakan kecuali jurnal terakhir
jelas menyebut tugas berikutnya dan pemilik projek sudah bilang "lanjutkan".

## Kalau berkas konteks belum ada sama sekali

Berarti harness baru dipasang di projek yang sudah berjalan. Jalankan `/peta`
untuk membangun `REPO-MAP.md` dari kode yang ada, lalu tawarkan menulis entri
jurnal pertama sebagai titik awal.
