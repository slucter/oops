# Pemicu Skill Otomatis

Pemilik projek **tidak perlu mengetik `/nama-skill`**. Kenali sendiri dari
kalimatnya, prosedur mana yang berlaku, lalu jalankan.

Skill di harness ini bukan perintah sistem — isinya prosedur tertulis. Kamu
membacanya lalu mengikuti langkahnya. Karena itu kamu bisa memicunya sendiri
kapan pun situasinya cocok.

---

## Tabel pemicu

Baca dari atas ke bawah. Yang cocok duluan, itu yang dipakai.

| Kalau pemilik projek… | Jalankan | File |
|---|---|---|
| membuka session / bilang "lanjut", "kemarin sampai mana", atau langsung memberi tugas di projek berjalan | `/lanjut` | `.agent/skills/lanjut.md` |
| menjelaskan projek baru, ide, atau "saya mau bikin…" | `/projek-baru` | `.agent/skills/projek-baru.md` |
| melaporkan sesuatu rusak, error, "kenapa begini", "tidak jalan" — **dengan** pesan error jelas | `/perbaiki` | `.agent/skills/perbaiki.md` |
| melaporkan bot/automation bermasalah **tanpa** error jelas: hasil salah, kosong, berhenti sendiri, kadang jalan kadang tidak | `/debug-bot` | `.agent/skills/debug-bot.md` |
| menjelaskan target automasi: situs, API, platform, polanya, aturannya | `/recon` | `.agent/skills/recon.md` |
| menyebut keamanan, celah, "aman tidak", audit, hardening | `/amankan` | `.agent/skills/amankan.md` |
| menyebut kredensial apa pun: password, SSH, token, API key, login | `/simpan-rahasia` | `.agent/skills/simpan-rahasia.md` |
| bilang "sudah dulu", "simpan", "besok lanjut" | `/handoff` | `.agent/skills/handoff.md` |
| minta tinjauan, "coba cek", "menurutmu gimana kodenya" | `/tinjau` | `.agent/skills/tinjau.md` |
| menyebut git: commit, push, branch, merge | `/git-flow` | `.agent/skills/git-flow.md` |
| bilang "kerjakan", "jalankan rencananya", "lanjutkan tahap berikutnya" | `/kerjakan` | `.agent/skills/kerjakan.md` |
| minta sesuatu dipantau berulang: CI, deploy, log bot yang sedang jalan | `/loop` | `.agent/skills/loop.md` |
| struktur projek berubah, atau peta terasa tidak cocok lagi | `/peta` | `.agent/skills/peta.md` |
| mengambil keputusan arsitektur yang mahal dibalik | `/keputusan` | `.agent/skills/keputusan.md` |

## Pemicu yang berjalan sendiri, tanpa diminta

Empat ini jalan otomatis karena kalau menunggu diminta, sering terlambat:

- **Awal session** → `/lanjut`. Selalu, sebelum menyentuh kode.
- **Kredensial disebut dalam percakapan** → `/simpan-rahasia`, **saat itu juga**.
  Jangan ditunda ke akhir session — session bisa terputus.
- **Keputusan arsitektur diambil** → `/keputusan`, sebelum melanjutkan koding.
- **Struktur projek berubah** (modul/folder baru) → `/peta` sebelum `/handoff`.

## Cara memilih saat beberapa terasa cocok

**`/perbaiki` atau `/debug-bot`?**
Pertanyaannya: ada *stack trace* atau pesan error yang menunjuk lokasi?
- Ada → `/perbaiki`
- Tidak ada, gejalanya "hasil salah tapi tidak error" → `/debug-bot`

**`/recon` atau `/debug-bot`?**
- Pemilik projek **menjelaskan** target → `/recon`
- Pemilik projek **mengeluhkan** bot rusak → `/debug-bot` (yang akan memanggil
  `/recon` sendiri kalau ternyata targetnya yang berubah)

**`/tinjau` atau `/amankan`?**
- "cek kodenya" umum → `/tinjau`
- menyebut keamanan/celah → `/amankan`

**`/projek-baru` atau langsung kerjakan?**
- Fitur baru di projek yang sudah berjalan → kerjakan biasa, tidak perlu skill
- Projek dari nol, atau modul besar yang butuh perencanaan → `/projek-baru`

## Beberapa skill dalam satu tugas

Wajar, dan sering. Jalankan berurutan:

> "bot scraper-ku hasilnya kosong padahal kemarin normal"

`/debug-bot` → ternyata selector berubah → `/recon` untuk memperbarui model
target → `/perbaiki` untuk kodenya → commit lewat `/git-flow`.

Tidak perlu mengumumkan tiap peralihan. Cukup katakan singkat apa yang sedang
kamu lakukan, lalu lakukan.

## Kapan **tidak** memakai skill

Jangan memaksakan prosedur untuk hal sederhana. Ini semua dikerjakan langsung:

- pertanyaan ("apa fungsi file ini?", "kenapa pakai X?")
- perubahan satu-dua baris yang jelas
- menjalankan perintah, melihat log
- perbaikan ketik, ganti nama, format ulang

Skill adalah prosedur untuk pekerjaan yang punya **cara gagal**. Kalau tidak ada
yang bisa gagal, kerjakan saja.

## Kalau ragu

Untuk tugas besar yang arah salahnya mahal, sebutkan dulu rencanamu dalam satu
kalimat:

> "Saya jalankan prosedur debug bot dulu — pasang titik observasi untuk melihat
> tahap mana yang menghasilkan kosong. Lanjut?"

Untuk tugas kecil, langsung kerjakan. Bertanya untuk hal sepele justru
memperlambat.

---

## Pemilik projek tetap boleh memanggil manual

Mengetik `/nama-skill` selalu berlaku dan **mengalahkan** deteksi otomatis.
Kalau dia mengetik `/perbaiki` padahal kamu mengira `/debug-bot` lebih cocok,
ikuti yang dia ketik — boleh sampaikan pendapatmu, tapi jangan menolak.

---

## Bantuan deteksi otomatis

Ada skrip yang membaca kalimat pemilik projek dan menyarankan skill:

```bash
echo "<kalimat pemilik projek>" | bash .agent/scripts/pemicu-skill.sh
```

Di Claude Code, skrip ini terpasang sebagai hook `UserPromptSubmit` — jalan
otomatis tiap prompt. Di agent lain, panggil manual kalau kamu ragu.

**Keluarannya saran, bukan perintah.** Skrip mencocokkan kata kunci; kamu yang
memahami maksud sebenarnya. Kalau saranannya tidak cocok dengan konteks
percakapan, abaikan.

## Kalau kata kuncinya tidak jelas

Tanya dirimu tiga hal ini, berurutan:

1. **Ada yang rusak?**
   - Ya, dengan pesan error → `/perbaiki`
   - Ya, tanpa pesan error, dan ini bot → `/debug-bot`
   - Tidak → lanjut ke nomor 2

2. **Ini pekerjaan baru atau lanjutan?**
   - Baru dan besar → `/projek-baru`
   - Lanjutan dari rencana → `/kerjakan`
   - Awal session → `/lanjut`

3. **Ini soal menyimpan atau memeriksa sesuatu?**
   - Menyimpan konteks → `/handoff`
   - Memeriksa kode → `/tinjau` (umum) atau `/amankan` (keamanan)
   - Menyimpan kredensial → `/simpan-rahasia`

Kalau setelah tiga pertanyaan itu masih tidak ada yang cocok, **kerjakan
langsung tanpa skill**. Memaksakan prosedur untuk pekerjaan yang tidak
membutuhkannya hanya memperlambat.

## Tanda kamu salah memilih skill

Hentikan dan tinjau ulang kalau:

- Prosedurnya menyuruh sesuatu yang jelas tidak berlaku ("reproduksi bug"
  padahal tidak ada bug).
- Langkah pertamanya sudah terasa dipaksakan.
- Pemilik projek terlihat bingung dengan arah yang kamu ambil.

Lebih baik mengakui salah pilih di langkah pertama daripada menjalankan
prosedur yang keliru sampai selesai.
