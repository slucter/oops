#!/usr/bin/env bash
# Membaca prompt pemilik projek dan menyarankan skill yang cocok.
#
# Dipakai sebagai hook UserPromptSubmit di Claude Code, tapi juga bisa
# dipanggil manual di agent lain:
#   echo "bot saya hasilnya kosong" | bash .agent/scripts/pemicu-skill.sh
#
# Keluarannya adalah saran, bukan paksaan — agent tetap yang memutuskan.

set -u

# Claude Code mengirim JSON lewat stdin; agent lain mungkin mengirim teks polos.
raw=$(cat 2>/dev/null || true)
[ -z "$raw" ] && exit 0

# Ambil field prompt kalau JSON, kalau tidak pakai apa adanya
if printf '%s' "$raw" | grep -q '"prompt"'; then
  p=$(printf '%s' "$raw" | sed -n 's/.*"prompt"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -c 2000)
else
  p=$(printf '%s' "$raw" | head -c 2000)
fi
[ -z "$p" ] && exit 0

# Huruf kecil semua, supaya pencocokan tidak peduli kapitalisasi
low=$(printf '%s' "$p" | tr '[:upper:]' '[:lower:]')

cocok() { printf '%s' "$low" | grep -qE "$1"; }

saran=""
tambah() { saran="$saran
  $1"; }

# --- Kredensial: paling penting, karena mudah terlewat ---
if cocok '(password|passwd|sandi|kata sandi|api[ _-]?key|apikey|token|kredensial|credential|ssh |ssh:|akun.*(nya|ini)|secret|.env|nya adalah|nya:|user.*pass|konek.*(db|database))' && ! cocok '(halaman login|form login|endpoint login|fitur login|alur login|proses login|sistem login)'; then
  tambah "/simpan-rahasia — kredensial disebut. Simpan SEKARANG ke .env + katalog di .env.example, jangan ditunda."
fi

# --- Bot gagal tanpa error vs bug biasa ---
if cocok '(bot|scraper|scraping|automation|otomasi|crawl)' \
   && cocok '(kosong|nol|tidak ada hasil|hasilnya salah|salah terus|berhenti sendiri|mati sendiri|stuck|hang|kadang|tiba-tiba|padahal kemarin|dobel|duplikat|ganda|rate.?limit|ke.?blokir|diblokir|timeout|lambat|nyangkut|error terus|gagal terus|kenapa.*terus)'; then
  tambah "/debug-bot — bot gagal tanpa pesan error jelas. Pasang titik observasi, jangan langsung menambal."
elif cocok '(error|gagal|rusak|tidak jalan|ga jalan|nggak jalan|crash|exception|traceback|bug)'; then
  tambah "/perbaiki — ada yang rusak. Petakan alur dulu, reproduksi, cari akar masalah. (Kalau ternyata tidak ada pesan error dan ini bot, pakai /debug-bot.)"
fi

# --- Target automasi dijelaskan ---
if cocok '(endpoint|selector|rate.?limit|scrape|webhook|api.*(nya|ini)|situsnya|websitenya|platformnya)' \
   && cocok '(polanya|aturannya|cara kerja|struktur|formatnya|responsnya|biasanya)'; then
  tambah "/recon — target automasi sedang dijelaskan. Susun jadi model di .agent/context/TARGET-*.md."
fi

# --- Projek baru ---
if cocok '(mau (bikin|buat|develop)|ingin (bikin|buat)|tolong buatkan|projek baru|project baru|bikin aplikasi|bikin bot|rencananya)'; then
  tambah "/projek-baru — wawancara kebutuhan dulu, susun rencana bertahap, MINTA PERSETUJUAN sebelum menulis kode."
fi

# --- Keamanan ---
if cocok '(aman|keamanan|celah|vulnerab|rentan|hardening|audit|exploit|diserang|security|xss|injection)'; then
  tambah "/amankan — audit keamanan. Telusuri masukan tak tepercaya sampai operasi berbahaya."
fi

# --- Tutup session ---
if cocok '(sudah dulu|cukup dulu|besok lanjut|simpan dulu|selesai dulu|istirahat|udahan)'; then
  tambah "/handoff — tutup session: tulis jurnal, commit, kosongkan WORKING-STATE."
fi

# --- Lanjut session ---
if cocok '(sampai mana|terakhir kali|sebelumnya gimana|lanjutkan yang kemarin|kita lanjut|ayo lanjut)' && ! cocok '(besok lanjut|nanti lanjut|padahal kemarin|kemarin normal)'; then
  tambah "/lanjut — muat konteks dulu: WORKING-STATE, jurnal, git status. Jangan menebak posisinya."
fi

# --- Eksekusi rencana ---
if cocok '(kerjakan|jalankan rencana|lanjutkan tahap|eksekusi|gas|lanjut tahap)'; then
  tambah "/kerjakan — eksekusi rencana bertahap: kerjakan, verifikasi, commit, perbarui status, lanjut."
fi

# --- Tinjauan ---
if cocok '(coba cek|tolong cek|review|tinjau|menurutmu|ada yang salah|periksa kode)'; then
  tambah "/tinjau — cari cacat yang benar-benar bisa gagal, bukan keluhan gaya penulisan."
fi

# --- Git ---
if cocok '(commit|push|merge|branch|pull request| pr |git )'; then
  tambah "/git-flow — cek dulu: repo sudah ada? remote ada? Lalu ikuti alurnya."
fi

# --- Pemantauan berulang ---
if cocok '(pantau|monitor|cek terus|kabari kalau|tunggu sampai|setiap [0-9]+ (menit|detik|jam))'; then
  tambah "/loop — pantau berulang. Selalu batasi jumlah putaran."
fi

[ -z "$saran" ] && exit 0

cat <<EOF
[harness] Skill yang mungkin berlaku untuk permintaan ini:
$saran

Buka .agent/skills/<nama>.md dan ikuti langkahnya. Ini saran berdasarkan kata
kunci — kalau tidak cocok dengan maksud sebenarnya, abaikan.
EOF
exit 0
