#!/usr/bin/env bash
# Menyiapkan harness di projek baru setelah folder ini disalin ke sana.
#
# Pemakaian: bash .agent/scripts/bootstrap.sh

set -eu
cd "$(dirname "$0")/../.."

echo "Menyiapkan Agent Harness"
echo "========================"
echo

# 1. Skill
bash .agent/scripts/sync-skills.sh
echo

# 2. Git: init kalau belum, lalu pasang hook
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if command -v git >/dev/null 2>&1; then
    git init -q .
    # Pakai 'main' sebagai nama branch awal kalau git mendukungnya
    git symbolic-ref HEAD refs/heads/main 2>/dev/null || true
    echo "Repositori git dibuat (branch: $(git branch --show-current 2>/dev/null || echo main))."
    echo "Belum ada remote — alur git berjalan lokal dulu."
    GIT_BARU=1
  else
    echo "git tidak ditemukan — dilewati."
  fi
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  bash .agent/scripts/install-hooks.sh

  origin=$(git remote get-url origin 2>/dev/null || true)
  if [ -n "$origin" ]; then
    echo "Remote origin: $origin"
    echo "Commit, push, dan merge akan berjalan otomatis."
  else
    echo "Belum ada remote origin — commit berjalan lokal."
    echo "Tambahkan nanti dengan: git remote add origin <url>"
  fi
fi
echo

# 3. Siapkan .env
if [ ! -f .env ] && [ -f .env.example ]; then
  printf '# Nilai rahasia. TIDAK PERNAH di-commit.\n# Katalognya ada di .env.example.\n' > .env
  echo "File .env dibuat (kosong)."
fi

# 4. Periksa perlindungan
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git check-ignore -q .env 2>/dev/null; then
    echo "Perlindungan .env aktif."
  else
    echo "PERINGATAN: .env belum terlindungi .gitignore. Periksa .gitignore."
  fi

  # 5. Commit awal kalau repo baru dibuat — supaya ada titik pulih sejak awal
  if [ "${GIT_BARU:-0}" = "1" ] && ! git log -1 >/dev/null 2>&1; then
    git add . >/dev/null 2>&1 || true
    if ! git diff --cached --quiet 2>/dev/null; then
      if git commit -q -m "chore: initial commit with agent harness" 2>/dev/null; then
        echo "Commit awal dibuat: $(git log -1 --format='%h %s')"
      else
        echo "Commit awal dilewati — periksa dengan 'git status'."
      fi
    fi
  fi
fi

cat <<'MSG'

Selesai.

Langkah berikutnya — buka projek ini dengan AI agent kamu, lalu:

  Projek baru dari nol       -> jalankan  /projek-baru
  Projek yang sudah ada kode -> jalankan  /peta

Agent akan membaca AGENTS.md dan .agent/ secara otomatis.
MSG
