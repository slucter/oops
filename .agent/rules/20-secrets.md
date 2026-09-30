# Aturan Rahasia & Kredensial

Pemilik projek ingin agent **mengingat** kredensial lintas-session, sehingga
tidak perlu menjelaskan ulang akses SSH, database, atau login tiap kali. Aturan
ini mengatur caranya supaya ingatan itu tidak berubah jadi kebocoran.

---

## Pembagian dua file

Ada dua file, dan perbedaannya mutlak:

| File | Isi | Git |
|---|---|---|
| `.env` | **Nilai asli**: password, private key, token | tidak pernah di-commit |
| `.env.example` | **Katalog**: nama, kegunaan, format — tanpa nilai | di-commit |

`.env.example` yang membuat agent *paham*: kredensial apa saja yang ada di
projek ini, untuk apa, dan bagaimana bentuknya. `.env` yang membuat agent
*bisa memakai*.

Session baru membaca `.env.example` untuk tahu apa yang tersedia, lalu membaca
`.env` kalau memang perlu nilainya.

## Bentuk katalog

Setiap entri di `.env.example` wajib punya komentar penjelas:

```bash
# Database staging. Dipakai skrip migrasi dan test integrasi.
# Host: db-staging.internal:5432 · User: app_rw
DATABASE_URL=postgresql://user:password@host:5432/dbname

# SSH ke server deploy. Key ada di ~/.ssh/deploy_prod (bukan di repo).
# Dipakai oleh scripts/deploy.sh.
DEPLOY_SSH_HOST=
DEPLOY_SSH_USER=
```

Yang boleh masuk katalog: nama variabel, kegunaan, hostname, username, format,
lokasi file kunci. Yang **tidak boleh**: password, token, private key, string
koneksi lengkap yang mengandung sandi.

## Saat pemilik projek memberikan kredensial

Ketika dalam percakapan pemilik projek menyebut kredensial apa pun — password
database, host SSH, API key, kredensial login — lakukan ini:

1. Tulis nilainya ke `.env`.
2. Tambahkan entri berkomentar di `.env.example`, tanpa nilai.
3. Pastikan `.env` ada di `.gitignore`.
4. Catat di jurnal bahwa kredensial itu tersedia — **sebut namanya saja**,
   jangan nilainya.

Skill `/simpan-rahasia` menjalankan keempat langkah ini.

## Larangan mutlak

- Jangan menulis nilai rahasia ke file selain `.env`.
- Jangan menulis nilai rahasia ke jurnal, ADR, memory, `REPO-MAP.md`, pesan
  commit, atau komentar kode.
- Jangan menulis nilai rahasia ke dalam kode, meskipun "sementara".
- Jangan menampilkan isi `.env` di layar kecuali pemilik projek memintanya
  secara eksplisit. Kalau perlu memastikan sebuah kunci ada, cek keberadaan
  namanya, bukan nilainya:
  `grep -q '^DATABASE_URL=' .env && echo ada`
- Jangan mengirim nilai rahasia ke layanan eksternal mana pun — termasuk
  perender diagram, pastebin, gist.

## Pengaman berlapis

Karena `.env` berada di dalam folder repo, ada tiga lapis pelindung:

1. **`.gitignore`** — mencantumkan `.env` dan pola turunannya.
2. **Hook `pre-commit`** (`.agent/scripts/pre-commit`) — menolak commit yang
   mengandung file rahasia atau pola yang tampak seperti kunci. Pasang dengan
   `.agent/scripts/install-hooks.sh`.
3. **Aturan ini** — agent memeriksa `git status` sebelum setiap commit.

Kalau ketiganya gagal dan rahasia sempat ter-commit, anggap kredensial itu
**sudah bocor**. Menghapus commit tidak cukup. Yang benar: ganti kredensialnya
di sistem asal, lalu bersihkan riwayat.

## Kalau repo akan dipublikasikan

`.env` di dalam repo aman selama repo-nya privat. Kalau suatu saat repo ini
jadi publik atau dibagikan ke pihak luar, pindahkan nilainya keluar:

```bash
mkdir -p ~/.agent-vault
mv .env ~/.agent-vault/<nama-projek>.env
ln -s ~/.agent-vault/<nama-projek>.env .env   # symlink tetap ter-gitignore
```

Katalog di `.env.example` tidak berubah, jadi agent tetap paham.
