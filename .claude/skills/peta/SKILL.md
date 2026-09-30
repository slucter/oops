---
name: peta
description: Gunakan ketika struktur projek berubah (modul atau folder baru), ketika harness baru dipasang di projek yang sudah ada kodenya, atau ketika REPO-MAP.md terasa tidak cocok lagi dengan kenyataan. Memindai kode dan membangun ulang peta arsitektur.
---

# /peta

`REPO-MAP.md` adalah dokumen paling berharga di harness ini. Dia yang membuat
agent baru — model apa pun, vendor apa pun — langsung paham bentuk projek tanpa
harus menjelajah ratusan file.

Jalankan saat: harness baru dipasang di projek lama, modul/folder baru dibuat,
dependensi utama berubah, atau peta sudah terasa tidak cocok dengan kenyataan.

---

## Langkah 1 — Pindai

Kumpulkan fakta dari kode, jangan dari ingatan:

```bash
# Struktur, abaikan folder sampah
find . -type d \( -name node_modules -o -name .git -o -name dist \
  -o -name build -o -name __pycache__ -o -name .venv -o -name target \) -prune \
  -o -type d -print | head -60

# Manifes dependensi
ls package.json requirements.txt pyproject.toml go.mod Cargo.toml \
   composer.json pom.xml build.gradle Gemfile 2>/dev/null

# Titik masuk
ls main.* index.* app.* server.* cmd/ src/main* 2>/dev/null

# Konfigurasi
ls *.config.* .env.example docker-compose* Dockerfile Makefile 2>/dev/null
```

Baca manifes dependensi seluruhnya — di situ terbaca framework, cara test, dan
cara menjalankan. Baca titik masuk untuk memahami alur nyalanya aplikasi.

Untuk repo besar, jangan baca semua. Baca titik masuk, lalu telusuri import-nya
satu lapis. Itu sudah menangkap tulang punggungnya.

## Langkah 2 — Tulis

Tulis ke `.agent/context/REPO-MAP.md`:

```markdown
# Peta Repo

Diperbarui: <tanggal> · oleh <agent>

## Projek ini apa
<2-4 kalimat. Masalah apa yang diselesaikan, untuk siapa.>

## Tumpukan teknologi
| Lapisan | Teknologi | Versi |
|---|---|---|
| Bahasa | | |
| Framework | | |
| Database | | |
| Test | | |

## Struktur
```
<pohon folder, kedalaman 2-3, dengan keterangan per folder>
```

## Titik masuk
| File | Peran |
|---|---|
| `src/index.ts` | Menyalakan server HTTP |

## Alur utama
<Untuk 1-3 alur terpenting, telusuri dari masuk sampai keluar.
Contoh: "Login: POST /auth/login → `routes/auth.ts:12` →
`services/auth.ts:validateUser` → cek tabel `users` → terbitkan JWT">

## Model data
<entitas utama, hubungan, di mana skema didefinisikan>

## Perintah
| Kegunaan | Perintah |
|---|---|
| Pasang dependensi | |
| Jalankan (dev) | |
| Test | |
| Build | |
| Deploy | |

## Aturan tak tertulis
<Pola yang berlaku di kode ini tapi tidak terdokumentasi. Contoh:
"semua handler route mengembalikan `Result<T>`, tidak pernah melempar exception">

## Area rawan
<Bagian yang mudah rusak, punya utang teknis, atau butuh kehati-hatian. Sebut
alasannya.>

## Ketergantungan luar
<API pihak ketiga, layanan, yang dibutuhkan agar projek jalan>
```

## Prinsip

- **Tulis fakta, bukan tebakan.** Kalau tidak yakin sebuah folder untuk apa,
  baca isinya. Kalau tetap tidak jelas, tulis "belum jelas" — itu lebih jujur
  daripada karangan yang menyesatkan.
- **Sertakan nomor baris** untuk titik penting. `src/auth.ts:34` jauh lebih
  berguna daripada "di file auth".
- **Bagian "aturan tak tertulis" dan "area rawan" paling bernilai.** Struktur
  folder bisa dilihat sendiri; pola tersirat tidak.
- **Jangan salin dokumentasi.** Kalau sudah ada README bagus, tautkan.
- **Jangan masukkan nilai rahasia.**

## Langkah 3

Commit hasilnya. Ini dokumen yang di-commit dan ikut repo.
