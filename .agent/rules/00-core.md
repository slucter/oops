# Aturan Inti

Aturan di file ini mengikat. Kalau instruksi lain bertentangan dengan yang di
sini, yang di sini menang — kecuali pemilik projek secara eksplisit mencabutnya
dalam percakapan.

---

## 0. Kenali sendiri skill yang dibutuhkan

Pemilik projek **tidak perlu mengetik `/nama-skill`**. Dari kalimatnya, kenali
prosedur mana yang berlaku lalu jalankan sendiri.

Tabel pemicunya ada di `.agent/rules/05-pemicu-skill.md` — baca itu di awal
session bersama file ini.

Empat yang jalan otomatis tanpa diminta: `/lanjut` di awal session,
`/simpan-rahasia` begitu kredensial disebut, `/keputusan` saat keputusan
arsitektur diambil, `/peta` saat struktur berubah.

Jangan memaksakan prosedur untuk hal sederhana — pertanyaan, perubahan satu
baris, atau menjalankan perintah dikerjakan langsung.

## 1. Pahami dulu, baru ubah

Sebelum menulis atau mengubah kode:

- Baca kode yang relevan. Jangan menebak isi file dari namanya.
- Kalau ada `REPO-MAP.md`, baca. Kalau menyentuh area yang punya ADR, baca ADR-nya.
- Kalau permintaannya ambigu dan tebakan yang salah akan memakan waktu, tanya.
  Satu pertanyaan lebih murah daripada satu jam kerja yang dibuang.

Jangan memulai implementasi besar tanpa rencana yang sudah disetujui. Untuk
pekerjaan yang menyentuh banyak file atau menambah dependensi, ajukan rencana
dulu.

## 2. Kerjakan yang diminta, sebatas yang diminta

- Perbaikan bug tidak perlu disertai perapian kode di sekitarnya.
- Jangan menambah abstraksi untuk kebutuhan yang belum ada.
- Tiga baris mirip lebih baik daripada abstraksi yang dipaksakan.
- Jangan menambah *feature flag*, lapisan kompatibilitas, atau penanganan error
  untuk skenario yang tidak mungkin terjadi.
- Kalau kamu melihat masalah lain di luar lingkup, **laporkan**, jangan langsung
  perbaiki sendiri.

## 3. Jangan tinggalkan pekerjaan setengah jadi

Kalau kamu bilang selesai, artinya:
- kode jalan (sudah dijalankan, bukan cuma "seharusnya jalan"),
- tidak ada `TODO` yang kamu tinggalkan diam-diam,
- tidak ada fungsi kosong yang menunggu diisi nanti.

Kalau memang belum selesai, katakan bagian mana yang belum dan kenapa.

## 4. Jujur soal apa yang sudah diverifikasi

Sebelum menyatakan pekerjaan selesai, jalankan:

```bash
bash .agent/scripts/verifikasi.sh
```

Skrip itu mendeteksi jenis projek (Node, Python, Go, Rust, PHP) lalu menjalankan
lint, test, dan build yang sesuai. Keluar dengan kode 1 kalau ada yang gagal.

Kalau tidak ada pemeriksaan yang bisa dijalankan, skrip akan mengatakannya —
dan itu berarti kamu **tidak boleh** mengklaim sudah diverifikasi.

Bedakan dengan jelas:
- "sudah saya jalankan dan hasilnya X" — kamu benar-benar menjalankannya,
- "secara logika seharusnya X" — kamu belum menjalankannya.

Jangan pernah melaporkan sesuatu berhasil kalau kamu belum melihatnya berhasil.
Kalau kamu tidak bisa menguji (misalnya perubahan UI tanpa akses browser),
katakan terus terang bahwa itu belum teruji.

Lulus *type check* dan *test suite* membuktikan kode benar secara bentuk, bukan
bahwa fiturnya benar.

## 5. Komentar kode: hemat

Standarnya: jangan menulis komentar. Tulis hanya kalau **alasannya** tidak
terbaca dari kode — batasan tersembunyi, *workaround* untuk bug tertentu,
perilaku yang akan mengejutkan pembaca.

Jangan menulis komentar yang menjelaskan *apa* yang dilakukan kode. Jangan
menulis komentar yang merujuk tugas saat ini ("ditambahkan untuk fitur X",
"dipakai oleh Y") — itu tempatnya di pesan commit, dan akan jadi basi.

## 6. Keamanan

- Jangan menulis kode yang rentan: *injection*, XSS, SQL injection, path
  traversal, kredensial ter-*hardcode*.
- Validasi masukan di batas sistem (input pengguna, API eksternal). Tidak perlu
  validasi berlebihan untuk kode internal.
- **Rahasia tidak pernah masuk kode.** Lihat `.agent/rules/20-secrets.md`.

## 7. Tindakan yang sulit dibatalkan

Tiga hal ini **selalu** butuh konfirmasi pemilik projek, tanpa pengecualian:

- `git push --force` (dan `--force-with-lease`)
- `git reset --hard`, `git clean -fd`, `git checkout .` saat ada perubahan belum ter-commit
- menghapus branch, tag, atau file yang tidak kamu buat sendiri

Alasannya: ketiganya menghancurkan kerja secara permanen. Operasi git lain
(commit, branch, push biasa, merge) berjalan otomatis — lihat
`.agent/rules/10-git.md`.

Sebelum menjalankan perintah apa pun yang bisa membuang perubahan, jalankan
`git status` dulu. Kalau ada kerja yang belum ter-commit dan bukan milikmu,
selamatkan dulu (`git stash -u`) sebelum melanjutkan.

## 8. Kontinuitas konteks

Agent tidak mengingat apa pun dari session sebelumnya. Lebih dari itu, konteks
dalam satu session pun bisa habis atau diringkas (*compact*) di tengah kerja.
Yang menjembatani semuanya adalah **file**, bukan ingatan.

Aturan lengkapnya di `.agent/rules/30-konteks.md`. Yang wajib:

- Di **awal** session: `bash .agent/scripts/muat-konteks.sh`, lalu periksa
  `.agent/context/WORKING-STATE.md` — kalau terisi, ada kerja yang tergantung.
- **Selagi bekerja**: perbarui `WORKING-STATE.md` setiap satu langkah berarti
  selesai. Jangan tunggu akhir session — session bisa terputus kapan saja.
- **Kalau konteks terasa menipis** (percakapan sangat panjang, kamu mulai ragu
  apa yang sudah dikerjakan, atau baru menerima ringkasan): perbarui file itu
  **sekarang**.
- **Setelah ter-compact**: baca `WORKING-STATE.md` + `git status`. Jangan
  menebak dari sisa percakapan, jangan mengulang kerja yang mungkin sudah
  selesai.
- Di **akhir** session: `/handoff` — pindahkan ke `JOURNAL.md`.
- Saat mengambil **keputusan arsitektur**: catat sebagai ADR (`/keputusan`).
- Saat **struktur projek berubah**: perbarui `REPO-MAP.md` (`/peta`).

Kalau ada pertentangan antar-sumber, urutan kepercayaannya:
**kondisi git > `WORKING-STATE.md` > `JOURNAL.md` > `REPO-MAP.md`.**

Kalau kamu belajar sesuatu yang akan berguna di session berikutnya dan tidak
bisa dibaca ulang dari kode, tulis ke `.agent/memory/`.

## 9. Bahasa

Berkomunikasi dengan pemilik projek dalam **Bahasa Indonesia**. Tapi tulis dalam
**Bahasa Inggris**: nama variabel, nama fungsi, pesan commit, komentar kode, dan
dokumentasi teknis di dalam kode. Ini menjaga kode tetap bisa dibaca kontributor
lain.

## 10. Gaya menjawab

- Ringkas. Pertanyaan sederhana dijawab langsung, tanpa daftar berjudul.
- Sebut lokasi kode dengan format `path/file.ts:42`.
- Jangan menutup setiap jawaban dengan ringkasan panjang tentang apa yang baru
  saja kamu lakukan.
- Jangan pakai emoji kecuali diminta.
