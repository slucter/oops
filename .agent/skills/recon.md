---
name: recon
description: Gunakan ketika pemilik projek MENJELASKAN target automasi — situs yang akan di-scrape, API yang dipakai, platform chat, bursa, beserta pola, aturan, rate limit, atau cara kerjanya. Menyusun penjelasan itu jadi model tertulis di TARGET-*.md supaya session berikutnya tidak perlu dijelaskan ulang.
---

# /recon [penjelasan target atau pola]

Bot dan automation bekerja terhadap **sesuatu di luar kode** — halaman web,
API, platform chat, bursa, sistem terjadwal. Yang menentukan benar-salahnya kode
adalah perilaku target itu, dan perilaku itu tidak terbaca dari source.

Skill ini mengubah penjelasanmu tentang target menjadi **model tertulis** yang
tersimpan di repo. Dengan begitu session berikutnya — agent apa pun, model apa
pun — tidak perlu kamu jelaskan ulang dari nol.

**Sumber utamanya adalah penjelasanmu**, bukan penjelajahan mandiri agent. Kamu
yang tahu targetnya; tugas agent adalah menyerap, menyusun, menemukan lubang,
dan memverifikasi seperlunya.

---

## Langkah 1 — Serap penjelasan

Baca penjelasan pemilik projek sampai habis. Lalu **rangkum kembali dengan
kata-katamu sendiri** dan tanyakan apakah pemahamanmu benar.

Ini bukan formalitas. Salah paham soal perilaku target akan menular ke seluruh
kode bot, dan biasanya baru ketahuan setelah bot jalan berjam-jam dengan hasil
salah.

Sambil membaca, pisahkan mana yang:
- **Fakta** — "endpoint-nya POST /api/v2/order"
- **Pola** — "kalau gagal, dia balas 429 lalu perlu tunggu 60 detik"
- **Dugaan** — "sepertinya ada rate limit, tapi belum pernah saya uji"

Tandai yang ketiga. Dugaan yang dicatat sebagai fakta adalah sumber bug yang
paling sulit dilacak.

## Langkah 2 — Gali yang belum disebut

Penjelasan awal hampir selalu punya lubang. Tanyakan yang **jawabannya mengubah
rancangan**, dikelompokkan 3–5 sekaligus.

Sesuaikan dengan jenis targetnya:

### Kalau target web / scraping
- Kontennya muncul langsung di HTML, atau dimuat JavaScript setelahnya?
- Bagaimana agent tahu halaman sudah siap? (elemen penanda, tunggu jaringan senyap)
- Selector yang dipakai — stabil, atau kelas yang berubah tiap deploy?
- Ada paginasi / infinite scroll? Bagaimana tahu sudah habis?
- Butuh login? Sesi bertahan berapa lama, dan bagaimana tanda kedaluwarsanya?
- Ada proteksi anti-bot? (CAPTCHA, deteksi headless, pembatasan berdasar IP)
- Berapa laju aman? Pernah kena blokir?

### Kalau target API
- Autentikasi: jenis apa, token berlaku berapa lama, cara memperbaruinya?
- Rate limit: berapa, per apa (IP/akun/endpoint), dan cara tahu sudah mendekati?
- Bentuk respons: konsisten, atau ada field yang kadang hilang?
- Kode error mana yang **boleh diulang**, mana yang **tidak boleh**?
- Ada paginasi / cursor? Bagaimana tahu sudah halaman terakhir?
- Operasinya idempoten? (penting: kalau retry, apakah bisa jadi dobel?)

### Kalau target platform chat
- Webhook atau polling? Kalau webhook, apakah bisa terkirim dua kali?
- Bagaimana pesan diidentifikasi unik — supaya tidak diproses ganda?
- State percakapan disimpan di mana, dan apa yang terjadi kalau bot restart?
- Batas: panjang pesan, jumlah pesan per detik, ukuran lampiran?
- Bagaimana perilaku di grup vs japri?

### Kalau target terjadwal / monitoring
- Jalan tiap berapa? Apa yang terjadi kalau satu putaran belum selesai saat
  putaran berikutnya mulai?
- Zona waktu apa yang dipakai — server, target, atau pengguna?
- Kalau satu putaran terlewat, perlu dikejar atau cukup dilewati?
- Bagaimana tahu bot masih hidup dan sehat? (bukan cuma "prosesnya jalan")

### Selalu tanyakan, apa pun jenisnya
- **Bagaimana bentuk kegagalannya?** Error jelas, atau diam-diam menghasilkan
  data salah?
- **Apa tanda bot bekerja benar?** Harus bisa diperiksa, bukan sekadar "tidak error".
- Pernah rusak sebelumnya? Karena apa?
- Ada yang berubah di sisi target belakangan ini?

Berhenti bertanya ketika sisa ketidakjelasan tidak lagi mengubah langkah
pertama.

## Langkah 3 — Verifikasi yang bisa diverifikasi

Untuk hal yang ditandai **dugaan** di Langkah 1, dan yang murah dibuktikan,
buktikan — jangan langsung ditulis sebagai fakta.

Contoh pembuktian yang murah:
```bash
curl -i -s "<endpoint>" | head -30            # bentuk respons & header
curl -s -o /dev/null -w '%{http_code}\n' ...  # kode status
```

Untuk target berbayar, berisiko, atau yang butuh kredensial — **tanya dulu**
sebelum mengirim permintaan. Jangan memanggil API produksi hanya untuk
memuaskan rasa ingin tahu.

Kalau tidak bisa diverifikasi sekarang, tetap catat sebagai dugaan. Model yang
jujur soal ketidakpastiannya jauh lebih berguna daripada yang terlihat yakin
tapi salah.

## Langkah 4 — Susun modelnya

Tulis ke `.agent/context/TARGET-<nama>.md`:

```markdown
# Model Target: <nama>

Diperbarui: <tanggal> · Sumber: penjelasan pemilik projek + verifikasi <apa saja>

## Target ini apa
<2-3 kalimat: sistem apa, kita mengambil/mengirim apa, untuk tujuan apa>

## Cara mengakses
| Hal | Nilai | Sumber |
|---|---|---|
| Endpoint / URL | | dijelaskan / diverifikasi |
| Autentikasi | | |
| Kredensial | nama kunci di `.env.example` | |

## Alur normal
<Langkah demi langkah, dari awal sampai hasil.
1. Login ke /auth, dapat token (berlaku 1 jam)
2. GET /items?cursor=... — 50 item per halaman
3. Berhenti kalau `next_cursor` kosong>

## Bentuk data
<Struktur yang diterima/dikirim. Sertakan contoh nyata kalau ada.
Tandai field yang OPSIONAL — itu sumber crash paling sering.>

## Aturan & batasan
| Aturan | Rinci | Akibat kalau dilanggar |
|---|---|---|
| Rate limit | | |
| Masa berlaku sesi | | |
| Jam sibuk | | |

## Pola kegagalan yang diketahui
| Gejala | Penyebab | Penanganan |
|---|---|---|
| HTTP 429 | terlalu cepat | tunggu 60 detik, coba lagi |
| Respons kosong tanpa error | sesi kedaluwarsa | login ulang, JANGAN retry langsung |

## Bagian yang rapuh
<Yang paling mungkin berubah dan merusak bot. Sebut alasannya.
Contoh: "selector .item-price memakai kelas hasil build — berubah tiap deploy">

## Yang masih dugaan
<Hal yang belum diverifikasi. JANGAN dibangun sebagai asumsi keras.>

## Cara memastikan bot bekerja benar
<Pemeriksaan konkret, bukan "tidak ada error".
Contoh: "jumlah item per putaran biasanya 40-60; kalau 0 atau >200, ada yang salah">
```

Satu file per target. Kalau bot menyentuh beberapa sistem, buat beberapa file.

## Langkah 5 — Hubungkan ke kode

Kalau botnya sudah ada, petakan model ini ke kode yang menanganinya:

```bash
grep -rn "<endpoint>\|<selector>\|<nama-fungsi>" --include=*.{py,js,ts,go} . | grep -v node_modules
```

Tambahkan ke model:

```markdown
## Kode yang menangani ini
| Bagian target | File |
|---|---|
| Login | `src/auth.py:12` |
| Ambil daftar | `src/scraper.py:45` |
```

Ini yang membuat model berguna saat target berubah: kamu langsung tahu file mana
yang terdampak.

## Langkah 6 — Simpan

- Commit file modelnya.
- Tautkan dari `REPO-MAP.md` di bagian ketergantungan luar.
- Kalau ada kredensial baru disebut — jalankan `/simpan-rahasia`.
- Catat di jurnal bahwa model target ini dibuat/diperbarui.

---

## Menjaga model tetap benar

Model target **cepat basi** — jauh lebih cepat daripada peta kode, karena yang
dimodelkan dikendalikan pihak lain.

Perbarui setiap kali:
- bot rusak karena target berubah (catat **apa** yang berubah, itu paling berharga),
- kamu menemukan aturan baru (rate limit yang sebenarnya, perilaku tak terduga),
- dugaan akhirnya terbukti atau terbantah.

Tulis tanggal pembaruan. Model tanpa tanggal tidak bisa dinilai masih berlaku
atau tidak.
