# Agent Harness

Kerangka kerja portable untuk pengembangan berbantuan AI agent.

Folder `.agent/` adalah **satu-satunya sumber kebenaran**. Semua konfigurasi
khusus-vendor (`.claude/`, `.cursor/`, `.kilo/`, `.github/`) hanyalah adapter
tipis yang menunjuk ke sini. Kalau kamu ganti AI agent, isi `.agent/` tetap
berlaku dan agent baru cukup diarahkan membaca folder ini.

## Peta isi

| Path | Isi | Di-commit? |
|---|---|---|
| `.agent/rules/` | Aturan wajib yang mengikat perilaku agent | ya |
| `.agent/skills/` | Prosedur bernama yang bisa dipanggil (`/projek-baru`, dll) | ya |
| `.agent/context/` | Pengetahuan tentang projek ini: peta repo, ADR, jurnal | ya |
| `.agent/memory/` | Preferensi & fakta lintas-sesi | ya |
| `.agent/scripts/` | Skrip bantu (hook git, bootstrap) | ya |
| `.agent/templates/` | Cetakan untuk ADR, jurnal, dll | ya |
| `.env` | Nilai rahasia sungguhan | **TIDAK PERNAH** |
| `.env.example` | Katalog: kredensial apa saja yang ada, tanpa nilainya | ya |

## Urutan baca saat session dimulai

Agent yang baru membuka projek ini harus membaca, berurutan:

1. `.agent/rules/00-core.md` — aturan yang tidak bisa dilanggar
2. `.agent/context/REPO-MAP.md` — bentuk projek ini
3. `.agent/context/JOURNAL.md` — entri terakhir: apa yang sedang berjalan
4. `.agent/memory/MEMORY.md` — preferensi pemilik projek
5. `.env.example` — kredensial apa yang tersedia dan untuk apa

Empat file pertama cukup untuk paham "projek ini apa dan sedang di mana".

## Skill yang tersedia

| Perintah | Kegunaan |
|---|---|
| `/projek-baru` | Menggali kebutuhan, menyusun rencana, baru menulis kode |
| `/lanjut` | Memuat konteks di awal session, melaporkan posisi terakhir |
| `/perbaiki` | Perbaikan bug terarah: reproduksi dulu, akar masalah, baru tambal |
| `/handoff` | Menutup session: tulis jurnal, commit, rapikan |
| `/simpan-rahasia` | Menyimpan kredensial ke `.env` + mencatat katalognya |
| `/peta` | Regenerasi `REPO-MAP.md` setelah struktur berubah |
| `/keputusan` | Mencatat keputusan arsitektur sebagai ADR |
| `/git-flow` | Operasi git: commit, branch, push, merge |
| `/tinjau` | Meninjau perubahan sebelum diserahkan |

## Memasang ke projek baru

Salin seluruh isi folder ini ke akar projek, lalu jalankan `/projek-baru`
(untuk projek dari nol) atau `/peta` (untuk projek yang sudah ada kodenya).
