---
name: projek-baru
description: Gunakan ketika pemilik projek menjelaskan projek atau ide BARU — "saya mau bikin", "tolong buatkan aplikasi", "rencananya begini". Menggali kebutuhan lewat wawancara terarah, menyusun rencana bertahap, dan meminta persetujuan SEBELUM satu baris kode pun ditulis.
---

# /projek-baru

Tujuan skill ini: mengubah penjelasan awal yang biasanya masih kabur menjadi
rencana yang cukup konkret untuk dieksekusi — dan menangkap konteks yang
dibutuhkan session-session berikutnya.

**Aturan yang tidak boleh dilanggar: jangan menulis kode implementasi sampai
rencananya disetujui.** Boleh membaca, boleh meneliti, boleh membuat kerangka
folder. Tidak boleh mengimplementasi.

---

## Langkah 1 — Dengar dulu

Baca penjelasan pemilik projek sampai habis. Rangkum kembali dengan kata-katamu
sendiri dalam 2–3 kalimat, lalu tanyakan apakah pemahamanmu sudah benar.

Ini bukan basa-basi. Salah paham di titik ini akan menular ke seluruh rencana.

## Langkah 2 — Gali kekosongan

Penjelasan awal hampir selalu punya lubang. Tugasmu menemukan lubang yang
**mahal kalau salah tebak**, lalu menanyakannya.

Periksa area berikut. Tanyakan hanya yang jawabannya belum jelas dan benar-benar
mengubah rancangan:

**Pengguna & masalah**
- Siapa yang memakai ini? Berapa banyak?
- Masalah apa yang sebenarnya diselesaikan? Sekarang mereka mengatasinya
  bagaimana?

**Lingkup**
- Apa yang **tidak** termasuk? (ini sering lebih menentukan daripada yang
  termasuk)
- Versi pertama minimal isinya apa supaya sudah berguna?

**Teknis**
- Bahasa, framework, database — sudah ditentukan atau bebas?
- Ada sistem lain yang harus diintegrasikan?
- Akan dijalankan di mana? (lokal, VPS, serverless, container)

**Data**
- Entitas utamanya apa saja, dan bagaimana hubungan antar-mereka?
- Ada data lama yang harus dimigrasi?

**Akses & kredensial**
- Butuh database, SSH, API pihak ketiga, akun pihak ketiga?
- Kalau ya, catat nanti lewat `/simpan-rahasia`.

**Batasan**
- Tenggat waktu? Target performa? Kewajiban kepatuhan?
- Siapa lagi yang akan menyentuh kode ini?

Ajukan pertanyaan **berkelompok**, 3–5 sekaligus, bukan satu-satu. Kalau sebuah
pertanyaan punya jawaban standar yang masuk akal, tawarkan sebagai usulan
("saya usulkan PostgreSQL karena X — setuju?") daripada membiarkannya terbuka.

Berhenti bertanya ketika sisa ketidakjelasan tidak lagi mengubah langkah
pertama. Sisanya bisa diputuskan sambil jalan.

## Langkah 3 — Perkaya

Sekarang tambahkan yang pemilik projek belum sebut tapi akan dia butuhkan.
Untuk tiap poin, jelaskan **kenapa** dan biarkan dia yang memutuskan:

- Kebutuhan tersirat (autentikasi, penanganan error, log, validasi)
- Kasus tepi yang mudah terlupakan (input kosong, akses bersamaan, kegagalan jaringan)
- Keputusan yang mahal dibalik kalau salah sejak awal (bentuk skema, batas modul)
- Risiko keamanan yang melekat pada jenis projek ini
- Kebutuhan operasional (backup, pemantauan, cara deploy)

Jangan menambah fitur. Tambahkan **pertimbangan**.

## Langkah 4 — Susun rencana

Tulis ke `.agent/context/PLAN.md`:

```markdown
# Rencana: <nama projek>

Dibuat: <tanggal>
Status: menunggu persetujuan

## Masalah
<apa yang diselesaikan, untuk siapa — 3-5 kalimat>

## Lingkup
Termasuk:
- ...

Tidak termasuk (sengaja):
- ...

## Pilihan teknis
| Keputusan | Pilihan | Alasan |
|---|---|---|
| ... | ... | ... |

## Model data
<entitas utama dan hubungannya>

## Tahapan
### Tahap 1 — <nama> · <perkiraan>
Tujuan: <kondisi yang tercapai setelah tahap ini>
- [ ] ...
Selesai kalau: <kriteria yang bisa diuji>

### Tahap 2 — ...

## Risiko
| Risiko | Dampak | Penanganan |
|---|---|---|

## Pertanyaan terbuka
- ...
```

Syarat rencana yang baik:
- Tahap 1 harus menghasilkan sesuatu yang **bisa dijalankan**, sekecil apa pun.
- Tiap tahap punya kriteria selesai yang bisa diperiksa, bukan "sudah beres".
- Tahap disusun berdasarkan ketergantungan, dan yang paling berisiko didahulukan
  — supaya kalau rancangan salah, ketahuannya cepat.

## Langkah 5 — Minta persetujuan

Sajikan rencananya. Tanyakan eksplisit apakah boleh mulai.

Kalau ada revisi, perbarui `PLAN.md` dan tanyakan lagi. Ulangi sampai disetujui.

## Langkah 6 — Siapkan fondasi

Setelah **disetujui**:

1. Ubah status di `PLAN.md` jadi `disetujui <tanggal>`.
2. Buat `.agent/context/REPO-MAP.md` — jalankan `/peta`.
3. Catat pilihan teknis penting sebagai ADR — jalankan `/keputusan`.
4. Kalau ada kredensial yang disebut — jalankan `/simpan-rahasia`.
5. Kalau belum ada git dan pemilik projek mau, `git init` lalu commit awal.
6. Tulis entri jurnal pertama.

Baru setelah ini, mulai Tahap 1.
