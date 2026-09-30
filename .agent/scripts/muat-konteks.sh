#!/usr/bin/env bash
# Mencetak seluruh konteks projek dalam satu keluaran, siap dibaca AI agent.
#
# Portable — jalan di agent manapun. Agent yang punya hook (Claude Code) bisa
# memanggilnya otomatis di awal session; agent lain memanggilnya lewat skill
# /lanjut, atau kamu jalankan manual lalu tempel hasilnya.
#
# Pemakaian:
#   bash .agent/scripts/muat-konteks.sh            # ringkas (default)
#   bash .agent/scripts/muat-konteks.sh --penuh    # sertakan isi REPO-MAP utuh

set -eu
cd "$(dirname "$0")/../.."

PENUH=0
[ "${1:-}" = "--penuh" ] && PENUH=1

potong() {  # potong() <file> <jumlah-baris>
  [ -f "$1" ] || return 0
  head -n "$2" "$1"
  total=$(wc -l < "$1")
  [ "$total" -gt "$2" ] && echo "... (dipotong, $total baris total — baca $1 untuk selengkapnya)"
}

echo "=============================================="
echo " KONTEKS PROJEK — dimuat $(date '+%Y-%m-%d %H:%M')"
echo "=============================================="
echo
echo "Agent: baca seluruh keluaran ini sebelum menyentuh kode."
echo

# --- 0. Pengingat pemicu skill ---
cat <<'PEMICU'
## Kenali skill dari kalimat pemilik projek

Dia tidak mengetik /nama-skill. Cocokkan kalimatnya dengan ini:

  "lanjut" / awal session                     -> /lanjut
  "mau bikin..." / ide baru                   -> /projek-baru
  rusak + ADA pesan error                     -> /perbaiki
  hasil salah/kosong, TANPA pesan error       -> /debug-bot
  menjelaskan situs/API yang diautomasi       -> /recon
  "aman tidak" / celah / audit                -> /amankan
  sebut password/SSH/token/API key            -> /simpan-rahasia  (SEGERA)
  "sudah dulu" / "simpan"                     -> /handoff
  "coba cek" / "review"                       -> /tinjau
  "commit" / "push" / "merge"                 -> /git-flow
  "kerjakan" / "jalankan rencananya"          -> /kerjakan
  "pantau" / "cek terus"                      -> /loop
  struktur projek berubah                     -> /peta
  keputusan arsitektur diambil                -> /keputusan

Cara menjalankan: buka .agent/skills/<nama>.md, ikuti langkahnya.
Jangan dipaksakan untuk pertanyaan sederhana atau perubahan satu baris.

PEMICU

# --- 1. Kondisi git ---
echo "## Kondisi saat ini"
echo
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Branch: $(git branch --show-current 2>/dev/null || echo '(detached)')"
  echo "Commit: $(git log -1 --format='%h %s (%ar)' 2>/dev/null || echo '(belum ada)')"
  n=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  echo "Belum ter-commit: $n berkas"
  if [ "$n" -gt 0 ]; then
    echo
    echo "Berkas yang menggantung — ini kerja yang belum selesai:"
    git status --porcelain | head -15 | sed 's/^/  /'
  fi
  echo
  echo "Commit terakhir:"
  git log -6 --format='  %h %s' 2>/dev/null
else
  echo "Bukan repositori git."
fi
echo

# --- 2. Status kerja yang tergantung ---
WS=".agent/context/WORKING-STATE.md"
if [ -f "$WS" ] && ! grep -q '_(belum pernah)_' "$WS" 2>/dev/null; then
  echo "=============================================="
  echo "## ADA KERJA YANG TERGANTUNG"
  echo
  echo "Session sebelumnya terputus di tengah kerja (konteks habis, ter-compact,"
  echo "atau ditutup mendadak). Lanjutkan dari sini — jangan memulai yang baru."
  echo
  sed -n '/^\*\*Diperbarui/,/^## Cara memakai/p' "$WS" | sed '/^## Cara memakai/d'
  echo
  echo "Verifikasi dulu dengan 'git diff' apa yang sudah benar-benar terjadi."
  echo
fi

# --- 3. Peta repo ---
echo "=============================================="
echo "## Peta repo"
echo
if [ -f .agent/context/REPO-MAP.md ]; then
  if grep -q "Belum diisi" .agent/context/REPO-MAP.md 2>/dev/null; then
    echo "BELUM DIISI. Jalankan /peta untuk membangunnya dari kode."
  elif [ "$PENUH" -eq 1 ]; then
    cat .agent/context/REPO-MAP.md
  else
    potong .agent/context/REPO-MAP.md 70
  fi
else
  echo "Tidak ada. Jalankan /peta untuk membuatnya."
fi
echo

# --- 3. Jurnal terakhir ---
echo "=============================================="
echo "## Jurnal — entri terakhir"
echo
if [ -f .agent/context/JOURNAL.md ]; then
  # Ambil dari entri '##' pertama sampai sebelum entri '##' ketiga
  awk '/^## /{c++} c>=1 && c<=2' .agent/context/JOURNAL.md | head -60
  [ -z "$(awk '/^## /{c++} c>=1' .agent/context/JOURNAL.md)" ] && echo "(belum ada entri)"
else
  echo "Tidak ada jurnal."
fi
echo

# --- 4. Rencana ---
if [ -f .agent/context/PLAN.md ]; then
  echo "=============================================="
  echo "## Rencana"
  echo
  potong .agent/context/PLAN.md 40
  echo
fi

# --- 4b. Model target (bot/automation) ---
targets=$(ls .agent/context/TARGET-*.md 2>/dev/null || true)
if [ -n "$targets" ]; then
  echo "=============================================="
  echo "## Model target eksternal"
  echo
  for f in $targets; do
    echo "  $(basename "$f")  —  $(grep -m1 '^Diperbarui:' "$f" 2>/dev/null | sed 's/Diperbarui: //' || echo 'tanpa tanggal')"
  done
  echo
  echo "Ini perilaku sistem di luar kode yang diautomasi. Baca sebelum mengubah"
  echo "kode yang menyentuhnya — dan curigai file ini lebih dulu kalau bot rusak"
  echo "tanpa perubahan kode."
  echo
fi

# --- 5. Keputusan ---
echo "=============================================="
echo "## Keputusan arsitektur (ADR)"
echo
adr=$(ls .agent/context/decisions/[0-9]*.md 2>/dev/null || true)
if [ -n "$adr" ]; then
  for f in $adr; do
    echo "  $(basename "$f")  —  $(head -1 "$f" | sed 's/^# *//')"
  done
  echo
  echo "Baca yang relevan sebelum mengubah area terkait."
else
  echo "(belum ada)"
fi
echo

# --- 6. Memori ---
echo "=============================================="
echo "## Preferensi pemilik projek"
echo
[ -f .agent/memory/MEMORY.md ] && potong .agent/memory/MEMORY.md 30 || echo "(tidak ada)"
echo

# --- 7. Kredensial ---
echo "=============================================="
echo "## Kredensial yang tersedia"
echo
if [ -f .env.example ]; then
  keys=$(grep -E '^[A-Z_][A-Z0-9_]*=' .env.example 2>/dev/null | cut -d= -f1 || true)
  if [ -n "$keys" ]; then
    echo "$keys" | sed 's/^/  /'
    echo
    echo "Kegunaan tiap kunci ada di .env.example. Nilainya di .env."
    echo "JANGAN menampilkan isi .env kecuali diminta."
  else
    echo "(belum ada yang dikatalogkan — pakai /simpan-rahasia saat ada)"
  fi
else
  echo "(tidak ada .env.example)"
fi
echo

echo "=============================================="
echo " Aturan lengkap: .agent/rules/00-core.md"
echo " Prosedur: .agent/skills/  (/perbaiki, /amankan, /handoff, dll)"
echo "=============================================="
