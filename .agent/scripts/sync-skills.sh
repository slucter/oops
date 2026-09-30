#!/usr/bin/env bash
# Menyalin skill dari .agent/skills/ (sumber kebenaran) ke format tiap agent.
# Jalankan setiap kali kamu mengubah isi .agent/skills/.
#
# Pemakaian: bash .agent/scripts/sync-skills.sh

set -eu
cd "$(dirname "$0")/../.."

[ -d .agent/skills ] || { echo "Folder .agent/skills tidak ditemukan."; exit 1; }

n=0
for f in .agent/skills/*.md; do
  [ -f "$f" ] || continue
  name=$(basename "$f" .md)
  mkdir -p ".claude/skills/$name"
  cp "$f" ".claude/skills/$name/SKILL.md"
  n=$((n + 1))
done

echo "$n skill disalin ke .claude/skills/"

# Bersihkan skill yang sumbernya sudah dihapus
for d in .claude/skills/*/; do
  [ -d "$d" ] || continue
  name=$(basename "$d")
  if [ ! -f ".agent/skills/$name.md" ]; then
    rm -rf "$d"
    echo "Dihapus (sumber tidak ada lagi): $name"
  fi
done

echo "Selesai."
