# Agent Harness

Projek ini memakai Agent Harness. Sumber kebenaran ada di `.agent/`.
Baca `AGENTS.md` di akar projek untuk instruksi lengkap.

## Langkah pertama tiap session

```bash
bash .agent/scripts/muat-konteks.sh
cat .agent/context/WORKING-STATE.md
```

Kalau `WORKING-STATE.md` terisi, session sebelumnya terputus di tengah kerja —
lanjutkan dari sana setelah memverifikasi dengan `git status`.

## Konteks habis / ter-compact

Perbarui `.agent/context/WORKING-STATE.md` setiap satu langkah berarti selesai.
Setelah ter-compact, baca file itu dan `git status` — jangan menebak, jangan
mengulang kerja yang mungkin sudah selesai.

Aturan lengkap: `.agent/rules/30-konteks.md`

## Prosedur

`.agent/skills/` — `/projek-baru`, `/perbaiki`, `/amankan`, `/handoff`,
`/lanjut`, `/peta`, `/keputusan`, `/simpan-rahasia`, `/git-flow`, `/tinjau`.
Buka file skill-nya dan ikuti langkahnya.

## Skill dipicu otomatis

Pemilik projek TIDAK perlu mengetik /nama-skill. Kenali dari kalimatnya:

- session dibuka / "lanjut"        -> /lanjut
- projek atau ide baru             -> /projek-baru
- rusak, ADA pesan error jelas     -> /perbaiki
- bot rusak, TANPA error jelas     -> /debug-bot
- menjelaskan target automasi      -> /recon
- menyebut keamanan / celah        -> /amankan
- menyebut kredensial apa pun      -> /simpan-rahasia (segera, jangan ditunda)
- "sudah dulu" / "simpan"          -> /handoff
- minta tinjauan kode              -> /tinjau
- menyebut commit/push/merge       -> /git-flow
- "kerjakan" / "jalankan rencananya" -> /kerjakan
- pantau CI / deploy / log berulang  -> /loop
- struktur projek berubah          -> /peta
- keputusan arsitektur             -> /keputusan

Tabel lengkap: .agent/rules/05-pemicu-skill.md

Jangan memaksakan prosedur untuk hal sederhana — pertanyaan, perubahan satu
baris, atau menjalankan perintah dikerjakan langsung.

## Kalau projeknya bot / automation

Baca .agent/rules/40-bot.md. Bot gagal dengan cara berbeda: tanpa stack trace,
sering diam, penyebabnya kerap di luar kode (target berubah, rate limit, sesi
kedaluwarsa).

Model target eksternal ada di .agent/context/TARGET-*.md (dibuat /recon).

## Bantuan deteksi skill

Kalau ragu skill mana yang cocok, jalankan:

  echo "<kalimat pemilik projek>" | bash .agent/scripts/pemicu-skill.sh

Skrip itu mencocokkan kata kunci dan menyarankan skill. Keluarannya saran,
bukan perintah — kamu yang memahami maksud sebenarnya.

Kalau kata kuncinya tidak jelas, tanya berurutan:
1. Ada yang rusak? Dengan pesan error -> /perbaiki. Tanpa, dan ini bot -> /debug-bot
2. Pekerjaan baru dan besar -> /projek-baru. Lanjutan rencana -> /kerjakan
3. Menyimpan konteks -> /handoff. Memeriksa kode -> /tinjau atau /amankan

Kalau tidak ada yang cocok, kerjakan langsung tanpa skill.
