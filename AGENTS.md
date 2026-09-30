# Instruksi untuk AI Agent

Kamu bekerja di projek yang memakai **Agent Harness** — kerangka kerja portable
yang menyimpan aturan, prosedur, dan konteks projek dalam bentuk file, supaya
agent mana pun (model apa pun, vendor apa pun) bisa melanjutkan pekerjaan tanpa
kehilangan konteks.

File ini dibaca oleh Cursor, GitHub Copilot, Windsurf, Kilo, Aider, dan agent
lain yang mendukung `AGENTS.md`. Isinya sengaja singkat — **sumber kebenaran
ada di `.agent/`**.

---

## BACA INI DULU: kenali skill dari kalimat pemilik projek

Pemilik projek **tidak mengetik `/nama-skill`**. Dia bicara biasa. Tugasmu
mengenali sendiri prosedur mana yang berlaku, lalu menjalankannya.

Sebelum membalas apa pun, cocokkan kalimatnya dengan daftar ini:

| Kalau dia bilang sesuatu seperti… | Jalankan |
|---|---|
| "lanjut", "kemarin sampai mana", atau ini awal session | **`/lanjut`** |
| "saya mau bikin…", "tolong buatkan…", menjelaskan ide baru | **`/projek-baru`** |
| "error", "gagal", "tidak jalan" — **disertai pesan error** | **`/perbaiki`** |
| "hasilnya kosong", "kok salah", "berhenti sendiri" — **tanpa pesan error** | **`/debug-bot`** |
| menjelaskan situs/API/platform yang diautomasi beserta polanya | **`/recon`** |
| "aman tidak", "ada celah", "audit", "hardening" | **`/amankan`** |
| menyebut password, SSH, token, API key, akun login | **`/simpan-rahasia`** |
| "sudah dulu", "simpan", "besok lanjut" | **`/handoff`** |
| "coba cek", "tolong review", "menurutmu gimana kodenya" | **`/tinjau`** |
| "commit", "push", "merge", atau kerja selesai perlu disimpan | **`/git-flow`** |
| "kerjakan", "jalankan rencananya", "lanjut tahap berikutnya" | **`/kerjakan`** |
| "pantau", "cek terus", "kabari kalau CI selesai" | **`/loop`** |
| struktur projek berubah — folder/modul baru | **`/peta`** |
| keputusan arsitektur diambil yang mahal dibalik | **`/keputusan`** |

**Cara menjalankan:** skill ini bukan perintah sistem — buka
`.agent/skills/<nama>.md`, baca isinya, lalu ikuti langkahnya satu per satu.

**Empat ini jalan sendiri, tanpa diminta:**
- awal session → `/lanjut`
- kredensial disebut → `/simpan-rahasia`, **saat itu juga**
- keputusan arsitektur diambil → `/keputusan`
- struktur berubah → `/peta`

**Jangan dipaksakan** untuk pertanyaan sederhana, perubahan satu baris, atau
menjalankan perintah — itu dikerjakan langsung.

Bimbingan lengkap saat ragu: `.agent/rules/05-pemicu-skill.md`

---

## Langkah pertama — muat konteks

Jalankan ini sebelum menyentuh kode apa pun:

```bash
bash .agent/scripts/muat-konteks.sh
```

Satu perintah, jalan di agent manapun. Keluarannya berisi kondisi git, peta
repo, jurnal terakhir, daftar keputusan arsitektur, preferensi pemilik projek,
dan kredensial yang tersedia.

Lalu periksa apakah ada kerja yang tergantung:

```bash
cat .agent/context/WORKING-STATE.md
```

Kalau file itu terisi, session sebelumnya terputus di tengah kerja. Lanjutkan
dari sana, jangan memulai sesuatu yang baru.

Kalau skripnya tidak bisa dijalankan, baca manual berurutan:

1. **`.agent/rules/00-core.md`** — aturan yang mengikat perilakumu
2. **`.agent/rules/30-konteks.md`** — cara menjaga konteks tidak hilang
3. **`.agent/context/WORKING-STATE.md`** — kerja yang sedang berjalan
4. **`.agent/context/REPO-MAP.md`** — bentuk projek ini
5. **`.agent/context/JOURNAL.md`** — entri paling atas
6. **`.agent/memory/MEMORY.md`** — preferensi pemilik projek

Kalau projek ini repo git, baca juga `.agent/rules/10-git.md`.
Kalau kamu akan menyentuh kredensial, baca `.agent/rules/20-secrets.md`.

---

## Kalau konteksmu habis atau ter-compact

Ini terjadi diam-diam di percakapan panjang, dan detail pekerjaan bisa hilang.
Aturan lengkapnya di `.agent/rules/30-konteks.md`. Intinya:

**Selagi bekerja:** perbarui `.agent/context/WORKING-STATE.md` setiap kali satu
langkah berarti selesai — bukan di akhir session. Beberapa detik menulis,
menyelamatkan berjam-jam kerja kalau session terputus.

**Kalau kamu merasa konteks menipis** (percakapan sangat panjang, kamu mulai
tidak yakin apa yang sudah dikerjakan, atau baru menerima ringkasan): perbarui
file itu **sekarang**, sebelum melanjutkan.

**Setelah ter-compact:** baca `WORKING-STATE.md` dan jalankan `git status` /
`git diff`. Jangan menebak dari sisa percakapan yang kabur, dan jangan
mengulang pekerjaan yang mungkin sudah selesai.

**Urutan kepercayaan** kalau ada pertentangan: kondisi git > `WORKING-STATE.md`
> `JOURNAL.md` > `REPO-MAP.md`. Git paling dapat dipercaya.

Simpan konteks kapan saja dengan:
```bash
bash .agent/scripts/simpan-konteks.sh "judul singkat"
```

---

## Prosedur yang tersedia

Ini bukan perintah yang dijalankan sistem — ini **prosedur tertulis** yang kamu
baca lalu ikuti langkah demi langkah.

**Pemilik projek tidak perlu mengetik `/nama-skill`.** Kenali sendiri dari
kalimatnya, prosedur mana yang berlaku, lalu jalankan. Tabel pemicu lengkapnya
di `.agent/rules/05-pemicu-skill.md` — baca itu di awal session.

| Perintah | Dipicu ketika | File |
|---|---|---|
| `/lanjut` | session dibuka, "lanjut", "kemarin sampai mana" | `.agent/skills/lanjut.md` |
| `/projek-baru` | menjelaskan projek/ide baru, "saya mau bikin…" | `.agent/skills/projek-baru.md` |
| `/perbaiki` | ada yang rusak, **dengan** pesan error jelas | `.agent/skills/perbaiki.md` |
| `/debug-bot` | bot bermasalah **tanpa** error: hasil salah, kosong, berhenti sendiri | `.agent/skills/debug-bot.md` |
| `/recon` | menjelaskan target automasi: situs, API, platform, polanya | `.agent/skills/recon.md` |
| `/amankan` | menyebut keamanan, celah, audit, hardening | `.agent/skills/amankan.md` |
| `/simpan-rahasia` | menyebut kredensial apa pun | `.agent/skills/simpan-rahasia.md` |
| `/handoff` | "sudah dulu", "simpan", "besok lanjut" | `.agent/skills/handoff.md` |
| `/tinjau` | minta tinjauan kode | `.agent/skills/tinjau.md` |
| `/git-flow` | menyebut commit, push, branch, merge | `.agent/skills/git-flow.md` |
| `/kerjakan` | bilang "kerjakan", "jalankan rencananya", "lanjut tahap berikutnya" | `.agent/skills/kerjakan.md` |
| `/loop` | minta sesuatu dipantau berulang: CI, deploy, log bot | `.agent/skills/loop.md` |
| `/peta` | struktur projek berubah | `.agent/skills/peta.md` |
| `/keputusan` | keputusan arsitektur yang mahal dibalik | `.agent/skills/keputusan.md` |

Jalan **otomatis tanpa diminta**: `/lanjut` di awal session, `/simpan-rahasia`
begitu kredensial disebut, `/keputusan` saat keputusan arsitektur diambil,
`/peta` saat struktur berubah.

Jangan memaksakan prosedur untuk hal sederhana — pertanyaan, perubahan satu
baris, atau menjalankan perintah dikerjakan langsung.

### Kalau projeknya bot / automation

Baca juga `.agent/rules/40-bot.md`. Bot punya cara gagal yang berbeda: tidak ada
*stack trace*, kegagalan sering diam, dan penyebabnya kerap di luar kode (target
berubah, rate limit, sesi kedaluwarsa).

Model target eksternal disimpan di `.agent/context/TARGET-*.md` lewat `/recon` —
baca kalau ada, karena di situlah perilaku target tercatat.

---

## Aturan paling penting, ringkas

Versi lengkapnya di `.agent/rules/00-core.md`. Ini intinya:

1. **Pahami dulu, baru ubah.** Baca kode yang relevan. Jangan menebak isi file
   dari namanya. Jangan memulai implementasi besar tanpa rencana yang disetujui.

2. **Kerjakan sebatas yang diminta.** Perbaikan bug tidak perlu disertai
   perapian kode. Jangan menambah abstraksi untuk kebutuhan yang belum ada.
   Masalah lain yang kamu temukan: **laporkan**, jangan langsung perbaiki.

3. **Jujur soal verifikasi.** Sebelum menyatakan pekerjaan selesai, jalankan:
   ```bash
   bash .agent/scripts/verifikasi.sh
   ```
   Skrip itu mendeteksi jenis projek sendiri lalu menjalankan lint, test, dan
   build. Bedakan "sudah saya jalankan dan hasilnya X" dari "secara logika
   seharusnya X". Jangan pernah melaporkan berhasil kalau belum melihatnya
   berhasil — dan kalau memang tidak bisa diuji, katakan terus terang.

4. **Rahasia tidak pernah masuk kode, jurnal, atau commit.** Nilai asli hanya di
   `.env`. Katalog di `.env.example`.

5. **Git berjalan otomatis** (commit, branch, push, merge), **kecuali** operasi
   yang tidak bisa dibatalkan: `push --force`, `reset --hard`, hapus branch —
   ketiganya selalu butuh konfirmasi.

6. **Tulis jurnal di akhir session** (`/handoff`). Tanpa itu, semua konteks
   session ini hilang.

7. **Bahasa:** komunikasi dengan pemilik projek dalam Bahasa Indonesia. Nama
   variabel, pesan commit, dan komentar kode dalam Bahasa Inggris.

---

## Kalau ini session pertamamu di projek ini

Jalankan `/lanjut`. Kalau berkas konteks masih kosong, berarti harness baru
dipasang — jalankan `/peta` untuk membangun peta dari kode yang ada, atau
`/projek-baru` kalau projeknya memang mulai dari nol.
