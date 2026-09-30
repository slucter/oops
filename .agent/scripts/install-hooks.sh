#!/usr/bin/env bash
# Memasang hook git dan memastikan .gitignore melindungi file rahasia.
# Jalankan dari akar projek: bash .agent/scripts/install-hooks.sh

set -eu

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Bukan repositori git — hook tidak dipasang."
  echo "Jalankan 'git init' dulu kalau projek ini memang mau dilacak git."
  exit 0
fi

root=$(git rev-parse --show-toplevel)
cd "$root"

# 1. Pasang hook
hookdir=$(git rev-parse --git-path hooks)
mkdir -p "$hookdir"

if [ -f "$hookdir/pre-commit" ] && ! grep -q 'agent/scripts' "$hookdir/pre-commit" 2>/dev/null; then
  cp "$hookdir/pre-commit" "$hookdir/pre-commit.backup"
  echo "Hook pre-commit lama dicadangkan ke pre-commit.backup"
fi

cp .agent/scripts/pre-commit "$hookdir/pre-commit"
chmod +x "$hookdir/pre-commit"
echo "Hook pre-commit terpasang (pengaman rahasia)."

# post-commit: ikut menyimpan dokumen konteks
if [ -f .agent/scripts/post-commit ]; then
  if [ -f "$hookdir/post-commit" ] && ! grep -q 'harness' "$hookdir/post-commit" 2>/dev/null; then
    cp "$hookdir/post-commit" "$hookdir/post-commit.backup"
    echo "Hook post-commit lama dicadangkan ke post-commit.backup"
  fi
  cp .agent/scripts/post-commit "$hookdir/post-commit"
  chmod +x "$hookdir/post-commit"
  echo "Hook post-commit terpasang (auto-simpan konteks)."
fi

# 2. Pastikan .gitignore melindungi rahasia
touch .gitignore
added=0
for pat in '.env' '.env.*' '!.env.example' '*.key' '*.pem' '*.p12' '*.pfx' 'id_rsa' 'id_ed25519' 'credentials.json' 'secrets.json' 'secrets.yaml' 'secrets.yml'; do
  if ! grep -qxF "$pat" .gitignore; then
    if [ "$added" -eq 0 ]; then
      printf '\n# --- rahasia (agent harness) ---\n' >> .gitignore
      added=1
    fi
    printf '%s\n' "$pat" >> .gitignore
  fi
done
[ "$added" -eq 1 ] && echo "Pola rahasia ditambahkan ke .gitignore." || echo ".gitignore sudah lengkap."

# 3. Peringatkan kalau .env sudah terlanjur terlacak
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  cat <<'MSG'

PERINGATAN: .env sudah terlacak git.
Menambahkannya ke .gitignore TIDAK menghapusnya dari riwayat.

Keluarkan dari pelacakan (isinya tetap ada di disk):
  git rm --cached .env
  git commit -m "chore: stop tracking .env"

Nilai yang sudah pernah ter-commit harus dianggap bocor — ganti
kredensialnya di sistem asal.
MSG
fi

echo "Selesai."
