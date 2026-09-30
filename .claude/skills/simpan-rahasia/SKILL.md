---
name: simpan-rahasia
description: Gunakan SEGERA ketika pemilik projek menyebut kredensial apa pun dalam percakapan — password, host SSH, string koneksi database, API key, token, akun login. Jangan ditunda sampai akhir session. Menyimpan nilainya ke .env dan katalognya ke .env.example.
---

# /simpan-rahasia

Dijalankan ketika pemilik projek menyebut kredensial apa pun dalam percakapan —
host SSH, string koneksi database, API key, akun login. Tujuannya: session
berikutnya tahu akses itu ada dan cara memakainya, tanpa pemilik projek harus
menjelaskan ulang, dan tanpa nilai rahasia bocor ke git.

Jalankan **segera** saat kredensial disebut, jangan ditunda sampai akhir session
— session bisa terputus.

Baca `.agent/rules/20-secrets.md` sebelum menjalankan ini.

---

## Langkah 1 — Pastikan pelindungnya terpasang

```bash
grep -q '^\.env$' .gitignore 2>/dev/null || echo "PERINGATAN: .env belum di-gitignore"
ls .git/hooks/pre-commit 2>/dev/null || echo "PERINGATAN: hook pre-commit belum dipasang"
```

Kalau salah satu belum ada, pasang dulu:
```bash
bash .agent/scripts/install-hooks.sh
```

Jangan menulis apa pun ke `.env` sebelum `.gitignore` memuatnya.

## Langkah 2 — Tulis nilai ke .env

```bash
# Contoh — sesuaikan
cat >> .env <<'EOF'

# Database staging
DATABASE_URL=postgresql://app_rw:sandi@db-staging.internal:5432/appdb
EOF
```

Kalau kuncinya sudah ada, perbarui — jangan menambah duplikat.

## Langkah 3 — Catat katalog di .env.example

Ini bagian yang membuat agent *paham*. Tambahkan entri dengan komentar
penjelas, **tanpa nilai rahasia**:

```bash
cat >> .env.example <<'EOF'

# Database staging. Dipakai skrip migrasi dan test integrasi.
# Host: db-staging.internal:5432 · User: app_rw · DB: appdb
# Nilai ada di .env (tidak di-commit).
DATABASE_URL=
EOF
```

Yang **boleh** ditulis di sini: nama variabel, kegunaan, hostname, port,
username, nama database, format nilai, file mana yang memakainya, lokasi file
kunci.

Yang **tidak boleh**: password, token, private key, string koneksi lengkap.

## Langkah 4 — Verifikasi

```bash
git status --short | grep -E '\.env$' && echo "BAHAYA: .env akan ter-commit"
git check-ignore -v .env
```

Perintah kedua harus menampilkan baris `.gitignore` yang memblokirnya. Kalau
tidak menampilkan apa-apa, `.env` **tidak terlindungi** — hentikan dan
perbaiki.

## Langkah 5 — Catat keberadaannya

Sebutkan di entri jurnal session ini, **nama saja**:

> Kredensial database staging tersedia (`DATABASE_URL`). Katalog di `.env.example`.

Jangan pernah menulis nilainya ke jurnal, memory, ADR, atau pesan commit.

## Langkah 6 — Commit katalognya saja

```bash
git add .env.example .gitignore
git commit -m "chore(env): catalog staging database credential"
```

Perhatikan: `.env` **tidak** ikut. Kalau `git status` menunjukkan `.env` masuk
ke staging, ada yang salah — hentikan dan periksa `.gitignore`.

---

## Cara session berikutnya memakainya

Agent baru membaca `.env.example`, melihat kredensial apa yang tersedia dan
untuk apa. Kalau butuh nilainya, baca dari `.env` — atau lebih baik, muat lewat
mekanisme env projek (`dotenv`, `os.environ`) tanpa menampilkannya ke layar.

Untuk sekadar memastikan sebuah kunci ada, periksa namanya:
```bash
grep -q '^DATABASE_URL=' .env && echo tersedia
```
