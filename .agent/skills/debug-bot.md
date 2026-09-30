---
name: debug-bot
description: Gunakan ketika bot, scraper, atau automation bermasalah TANPA pesan error jelas — hasilnya salah atau kosong padahal tidak error, berhenti sendiri tanpa jejak, kadang jalan kadang tidak, atau "kemarin normal hari ini tidak" padahal kode tidak diubah. Memasang titik observasi karena tidak ada stack trace untuk diikuti.
---

# /debug-bot [gejala yang kamu lihat]

Bug di aplikasi biasa biasanya melempar *exception* dengan *stack trace* yang
menunjuk barisnya. Bug di bot sering tidak begitu:

- bot jalan terus, tidak ada error, tapi datanya salah atau kosong
- berhasil 9 kali, gagal sekali, tanpa pola yang jelas
- berjalan berjam-jam lalu berhenti tanpa jejak
- di lokal jalan, di server tidak
- kemarin jalan, hari ini tidak, padahal kode tidak diubah

Tidak ada *stack trace* untuk diikuti. Skill ini menggantikannya dengan
**observasi terstruktur**.

Untuk bug yang **punya** *stack trace* jelas, pakai `/perbaiki` — lebih langsung.

---

## Langkah 0 — Muat konteks

Baca `.agent/context/TARGET-*.md` (model target dari `/recon`), `REPO-MAP.md`,
dan jurnal terakhir.

Model target penting di sini: sebagian besar kegagalan bot berasal dari
**perubahan di sisi target**, bukan dari kode yang tiba-tiba rusak sendiri.

Kalau belum ada model target, dan penyebabnya kemungkinan di luar — jalankan
`/recon` dulu.

## Langkah 1 — Perjelas gejalanya

Tanyakan ke pemilik projek, dan jangan mulai menebak sebelum terjawab:

- **Apa yang kamu lihat?** Keluaran salah, kosong, proses berhenti, atau
  menggantung?
- **Apa yang seharusnya terjadi?**
- **Kapan mulai?** Setelah kode diubah, atau tiba-tiba sendiri?
- **Seberapa sering?** Selalu, kadang-kadang, atau sekali saja?
- **Ada pola waktu?** Jam tertentu, setelah berjalan lama, hari tertentu?
- **Ada log?** Apa isinya menjelang kegagalan?

**Pertanyaan paling menentukan: "kapan terakhir kali ini jalan benar, dan apa
yang berubah sejak itu?"** — di sisi kode maupun di sisi target.

Kalau jawabannya "kode tidak diubah sama sekali", kecurigaan utama langsung
mengarah ke target atau lingkungan, bukan ke kode.

## Langkah 2 — Tentukan kelas kegagalannya

Empat kelas, dan masing-masing ditangani berbeda. Tentukan dulu yang mana:

| Kelas | Tanda | Kecurigaan utama |
|---|---|---|
| **Gagal diam** | jalan normal, hasil salah/kosong | validasi tidak ada; target berubah bentuk |
| **Berhenti mendadak** | proses mati, tidak ada jejak | kehabisan memori, *exception* tertelan, koneksi putus |
| **Kadang gagal** | tidak konsisten | kondisi balapan, rate limit, *timing*, data tertentu |
| **Menggantung** | jalan tapi tidak maju | tidak ada *timeout*, menunggu elemen yang tak pernah muncul |

Kelas menentukan ke mana kamu memasang observasi.

## Langkah 3 — Petakan alur bot

Sebelum memasang apa pun, pahami dulu jalurnya. Untuk bot, jalur itu biasanya
berbentuk putaran dengan beberapa tahap:

```
mulai → auth → ambil data → olah → simpan/kirim → tunggu → ulang
```

Tulis tahapnya berurutan, dengan `file:baris` tiap tahap. Untuk tiap tahap,
catat: masuknya apa, keluarnya apa, dan apa yang **diasumsikan benar**.

Asumsi yang tidak pernah diperiksa adalah tempat bug bersembunyi. Contoh:
"diasumsikan respons selalu punya field `items`" — dan suatu hari target
mengirim respons tanpa field itu.

## Langkah 4 — Pasang titik observasi

Ini pengganti *stack trace*. Di **setiap batas tahap**, catat apa yang lewat:

```python
import json, time

def observasi(tahap, data, catatan=""):
    print(json.dumps({
        "t": time.strftime("%H:%M:%S"),
        "tahap": tahap,
        "jenis": type(data).__name__,
        "jumlah": len(data) if hasattr(data, "__len__") else None,
        "contoh": str(data)[:200],
        "catatan": catatan,
    }, ensure_ascii=False), flush=True)
```

```javascript
const observasi = (tahap, data, catatan = "") =>
  console.log(JSON.stringify({
    t: new Date().toISOString().slice(11, 19),
    tahap,
    jenis: Array.isArray(data) ? "array" : typeof data,
    jumlah: data?.length ?? null,
    contoh: JSON.stringify(data)?.slice(0, 200),
    catatan,
  }));
```

Pasang di tiap batas tahap:
```python
observasi("respons-mentah", resp.text, f"status={resp.status_code}")
observasi("setelah-parse", items)
observasi("setelah-filter", hasil, f"dibuang={len(items)-len(hasil)}")
```

Tiga hal yang **wajib** dicatat, karena di situlah bug paling sering sembunyi:
1. **Jumlah** di tiap tahap — dari 50 jadi 0 langsung menunjukkan tahap mana yang salah
2. **Respons mentah sebelum diolah** — untuk melihat apakah target berubah bentuk
3. **Waktu tiap tahap** — untuk menemukan yang menggantung

`flush=True` penting: tanpa itu, log bisa hilang saat proses mati mendadak.

## Langkah 5 — Jalankan dan rekam

```bash
python bot.py 2>&1 | tee /tmp/jejak-$(date +%H%M%S).log
```

Untuk kegagalan yang jarang, jalankan berulang sampai tertangkap:
```bash
for i in $(seq 1 20); do
  echo "=== putaran $i ==="
  python bot.py 2>&1 | tail -30
done | tee /tmp/jejak-berulang.log
```

Lalu bandingkan putaran yang berhasil dengan yang gagal — **perbedaan di antara
keduanya adalah petunjuk terkuat** yang bisa kamu dapat.

## Langkah 6 — Persempit

Baca jejaknya dan cari **tahap pertama** yang keluarannya tidak sesuai harapan.
Jangan melihat gejala akhir; gejala akhir hampir selalu jauh dari penyebab.

Pola yang sering muncul:

| Yang terlihat di jejak | Artinya |
|---|---|
| jumlah 50 → 50 → 0 | filter/parse yang salah, bukan pengambilan data |
| respons mentah beda dari biasanya | **target yang berubah**, kode tidak salah |
| tahap N lambat sekali lalu berhenti | *timeout* tidak dipasang |
| gagal hanya di putaran ke-N | rate limit, sesi kedaluwarsa, atau kebocoran memori |
| gagal hanya untuk data tertentu | kasus tepi di data, bukan di alur |

## Langkah 7 — Pisahkan: kode atau target?

Ini percabangan terpenting dalam debug bot, dan sering salah diambil.

Uji targetnya secara terpisah, di luar kode bot:
```bash
curl -i -s "<endpoint>" | head -40
```

- **Target berperilaku beda dari model** → yang rusak di luar. Perbarui
  `TARGET-*.md` lewat `/recon`, lalu sesuaikan kode.
- **Target normal, kode yang salah menanganinya** → lanjut ke `/perbaiki` dengan
  temuan ini.

Jangan menambal kode untuk menutupi perubahan target tanpa mencatat
perubahannya. Tambalan seperti itu akan membingungkan orang berikutnya, dan
biasanya rusak lagi saat target berubah sekali lagi.

## Langkah 8 — Perbaiki

Ikuti `/perbaiki` mulai Langkah 4 (pahami akar masalah). Tambahan khusus bot:

**Jangan hanya memperbaiki kasus ini — buat kegagalan berikutnya terlihat.**
Kegagalan diam terjadi karena tidak ada yang memeriksa. Tambahkan pemeriksaan
di batas tahap:

```python
if not items:
    raise ValueError(f"Tidak ada item dari {url} — biasanya 40-60. Target mungkin berubah.")

if len(items) > 500:
    raise ValueError(f"{len(items)} item — jauh di atas normal. Periksa paginasi.")
```

Batas yang masuk akal lebih baik daripada tidak ada batas. Bot yang berhenti
dengan pesan jelas jauh lebih baik daripada bot yang diam-diam menyimpan data
salah selama seminggu.

## Langkah 9 — Bersihkan dan catat

- **Hapus titik observasi sementara.** Yang benar-benar berguna, ubah jadi log
  permanen dengan level yang pantas (`debug`/`info`).
- Perbarui `TARGET-*.md` kalau penyebabnya perubahan target.
- Catat di jurnal: gejala, kelas kegagalan, akar masalah, pemeriksaan baru yang
  ditambahkan.
- Commit.

---

## Kalau tetap tidak ketemu

Sampaikan terus terang, jangan menebak lalu mengaku sudah diperbaiki. Laporkan:

- apa yang sudah dipersempit dan **sudah dikesampingkan**
- jejak yang terkumpul dan apa yang terbaca darinya
- dugaan terkuat beserta alasannya
- apa yang dibutuhkan untuk melangkah (akses log server, jalan lebih lama,
  contoh data yang memicu)

Bug bot yang jarang muncul kadang memang butuh beberapa kali percobaan. Itu
lebih jujur daripada tambalan asal yang menutupi gejala.
