# Aturan Bot & Automation

Berlaku kalau projek ini berupa bot, scraper, automation, atau apa pun yang
berjalan tanpa diawasi terhadap sistem di luar kendali kita.

Bedanya dengan aplikasi biasa: pengguna aplikasi langsung tahu kalau ada yang
salah. Bot bisa **salah selama berminggu-minggu tanpa ada yang sadar**.

---

## 1. Kegagalan harus berisik

Aturan terpenting di sini. Bot yang berhenti dengan pesan jelas jauh lebih baik
daripada bot yang diam-diam menyimpan data salah.

Jangan pernah menulis ini:

```python
try:
    data = ambil_data()
except Exception:
    data = []          # bot lanjut dengan data kosong, tidak ada yang tahu
```

Tulis ini:

```python
try:
    data = ambil_data()
except Exception as e:
    log.error("Gagal mengambil data dari %s: %s", url, e)
    raise              # berhenti, supaya ketahuan
```

Menangkap *exception* hanya boleh kalau kamu **benar-benar tahu cara
memulihkannya**, dan pemulihan itu dicatat di log.

## 2. Validasi hasil, bukan cuma ketiadaan error

"Tidak error" bukan berarti "benar". Bot yang mengambil 0 item karena selector
berubah akan terlihat sukses sempurna.

Setiap tahap yang menghasilkan data harus punya pemeriksaan kewajaran:

```python
if not items:
    raise ValueError(f"0 item dari {url} — biasanya {NORMAL_MIN}-{NORMAL_MAX}. Target mungkin berubah.")

if len(items) > NORMAL_MAX * 5:
    raise ValueError(f"{len(items)} item — jauh di atas normal. Periksa paginasi.")
```

Batas kasar yang masuk akal sudah jauh lebih baik daripada tidak ada batas.
Angka normalnya ada di `TARGET-*.md` bagian "cara memastikan bot bekerja benar".

## 3. Semua operasi jaringan butuh timeout

Tanpa *timeout*, bot bisa menggantung selamanya menunggu balasan yang tidak
akan pernah datang. Ini penyebab "bot berhenti tanpa jejak" yang paling umum.

```python
requests.get(url, timeout=30)          # bukan requests.get(url)
page.wait_for_selector(sel, timeout=10_000)
```

Berlaku untuk: permintaan HTTP, kueri database, penantian elemen, koneksi
soket — semuanya.

## 4. Retry harus punya aturan

Retry membabi buta memperparah keadaan: kalau target sedang kena rate limit,
retry cepat justru memperpanjang blokir.

Aturannya:
- **Tunggu makin lama tiap percobaan** (1s, 2s, 4s, 8s), jangan interval tetap.
- **Batasi jumlahnya** (3–5 kali), lalu menyerah dengan pesan jelas.
- **Pilah mana yang layak diulang.** 429 dan 503 layak. 401 dan 404 tidak —
  mengulangnya tidak akan mengubah apa pun.
- **Jangan retry operasi yang tidak idempoten** tanpa pengaman. Mengulang
  "kirim pesan" atau "buat order" bisa menghasilkan duplikat.

## 5. State harus tahan restart

Bot pasti akan restart — *deploy*, *crash*, server *reboot*. State yang hanya
ada di memori akan hilang.

- Simpan posisi kerja (cursor, id terakhir) ke disk atau database, bukan variabel.
- Setelah restart, lanjutkan dari posisi terakhir, jangan mulai dari nol.
- Untuk pemrosesan pesan/event: catat id yang sudah diproses, supaya tidak
  dobel. Webhook **bisa** mengirim ulang event yang sama.

## 6. Log terstruktur, bukan print

Kalau bot berjalan berjam-jam, log adalah satu-satunya jendela ke dalamnya.

```python
log.info("putaran selesai", extra={
    "diambil": len(items),
    "disimpan": tersimpan,
    "dilewati": dilewati,
    "durasi_s": round(durasi, 1),
})
```

Yang wajib masuk log:
- **jumlah di tiap tahap** — ini yang paling sering menyelamatkan saat debug
- waktu yang dihabiskan tiap tahap
- setiap retry beserta alasannya
- **respons mentah saat terjadi kegagalan** (dipotong, dan tanpa kredensial)

Jangan pernah menulis token, password, atau data pribadi ke log.

## 7. Hormati target

- Beri jeda antar-permintaan. Kalau tidak tahu batas amannya, mulai dari lambat.
- Patuhi `robots.txt` dan ketentuan layanan kecuali pemilik projek menyatakan
  punya izin.
- Pakai `User-Agent` yang jujur kalau targetnya mengizinkan.
- Kalau kena 429 atau blokir sementara, **melambat** — jangan ganti IP lalu
  lanjut dengan laju yang sama.

Kalau pemilik projek meminta teknik menghindari deteksi, tanyakan dulu konteks
otorisasinya. Automasi pada sistem milik sendiri atau yang sudah diizinkan itu
wajar; mengakali proteksi milik orang lain tidak.

## 8. Perubahan target dicatat, bukan ditambal diam-diam

Kalau bot rusak karena target berubah:
1. Perbarui `.agent/context/TARGET-*.md` — catat **apa** yang berubah.
2. Baru sesuaikan kodenya.
3. Sebutkan perubahan itu di pesan commit.

Tambalan tanpa catatan akan membingungkan orang berikutnya, dan biasanya rusak
lagi saat target berubah sekali lagi.

## 9. Jangan uji di produksi

- Pakai akun/kredensial uji kalau ada.
- Batasi jumlah data saat pengembangan (`limit=5`).
- Untuk bot yang **mengirim** sesuatu (pesan, order, email): sediakan mode
  kering (*dry run*) yang mencatat apa yang akan dikirim tanpa benar-benar
  mengirim. Pakai itu sebagai default saat mengembangkan.

Kesalahan di bot pengirim tidak bisa ditarik kembali.

---

## Ringkas

| Prinsip | Kenapa |
|---|---|
| Gagal berisik, jangan diam | kegagalan diam bisa berlangsung berminggu-minggu |
| Validasi hasil, bukan ketiadaan error | "tidak error" ≠ "benar" |
| Timeout di semua operasi jaringan | penyebab utama bot menggantung |
| Retry bertahap dan terbatas | retry membabi buta memperparah |
| State bertahan setelah restart | bot pasti akan restart |
| Log jumlah di tiap tahap | jendela satu-satunya saat debug |
| Hormati target | blokir permanen lebih mahal daripada lambat |
