#!/usr/bin/env bash
# Merekam kondisi projek saat ini ke jurnal.
#
# Portable — jalan di agent manapun (Claude Code, Kilo, Cursor, OpenCode,
# Aider, Copilot) karena ini skrip shell biasa, bukan fitur agent tertentu.
#
# Pemakaian:
#   bash .agent/scripts/simpan-konteks.sh                 # entri otomatis
#   bash .agent/scripts/simpan-konteks.sh "judul entri"   # dengan judul
#   bash .agent/scripts/simpan-konteks.sh --lihat         # tampilkan kondisi saja

set -eu
cd "$(dirname "$0")/../.."

JOURNAL=".agent/context/JOURNAL.md"
MODE="tulis"
TITLE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --lihat|--show) MODE="lihat" ;;
    -h|--help)
      echo "Pemakaian: bash .agent/scripts/simpan-konteks.sh [judul] [--lihat]"
      exit 0 ;;
    *) TITLE="$1" ;;
  esac
  shift
done

# --- Kumpulkan kondisi nyata ---
TANGGAL=$(date +%Y-%m-%d)
JAM=$(date +%H:%M)

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  BRANCH=$(git branch --show-current 2>/dev/null || echo "(detached)")
  COMMIT=$(git log -1 --format='%h %s' 2>/dev/null || echo "(belum ada commit)")
  BELUM=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  BERUBAH=$(git status --porcelain 2>/dev/null | head -12 | sed 's/^/  /')
  TERAKHIR=$(git log -6 --format='  %h %s' 2>/dev/null || echo "  (belum ada)")
else
  BRANCH="(bukan repo git)"
  COMMIT="—"
  BELUM="0"
  BERUBAH=""
  TERAKHIR="  (bukan repo git)"
fi

[ -z "$TITLE" ] && TITLE="snapshot $JAM"

# --- Mode lihat: tampilkan saja ---
if [ "$MODE" = "lihat" ]; then
  echo "Kondisi projek — $TANGGAL $JAM"
  echo "  Branch : $BRANCH"
  echo "  Commit : $COMMIT"
  echo "  Belum ter-commit: $BELUM berkas"
  [ -n "$BERUBAH" ] && { echo "  Berubah:"; echo "$BERUBAH"; }
  echo "  Commit terakhir:"
  echo "$TERAKHIR"
  exit 0
fi

# --- Susun entri ---
[ -f "$JOURNAL" ] || {
  mkdir -p .agent/context
  printf '# Jurnal Session\n\nEntri terbaru di **paling atas**.\n\n---\n\n' > "$JOURNAL"
}

ENTRY=$(cat <<EOF
## $TANGGAL $JAM · $TITLE

**Branch:** $BRANCH · **Commit:** $COMMIT
**Belum ter-commit:** $BELUM berkas

### Kondisi saat snapshot
Commit terakhir:
$TERAKHIR
EOF
)

if [ -n "$BERUBAH" ]; then
  ENTRY="$ENTRY

Berkas yang berubah:
$BERUBAH"
fi

ENTRY="$ENTRY

### Selesai
- _(isi: apa yang selesai dan diverifikasi bagaimana)_

### Belum selesai
- _(isi: berhenti di mana, kenapa)_

### Langkah berikutnya
- _(isi: tugas konkret berikutnya)_

---
"

# --- Sisipkan di bawah penanda, supaya entri terbaru di atas ---
TMP=$(mktemp)
if grep -q '^---$' "$JOURNAL"; then
  awk -v entry="$ENTRY" '
    !done && /^---$/ { print; print ""; print entry; done=1; next }
    { print }
  ' "$JOURNAL" > "$TMP"
else
  { cat "$JOURNAL"; printf '\n%s\n' "$ENTRY"; } > "$TMP"
fi
mv "$TMP" "$JOURNAL"

echo "Entri jurnal ditambahkan: $TANGGAL $JAM · $TITLE"
echo
echo "Kerangka entri sudah dibuat, tapi bagian Selesai / Belum selesai /"
echo "Langkah berikutnya masih kosong. Isi dengan konteks yang sebenarnya —"
echo "itu bagian yang berguna untuk session berikutnya."
echo
echo "  $JOURNAL"
