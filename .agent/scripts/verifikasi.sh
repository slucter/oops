#!/usr/bin/env bash
# Menjalankan pemeriksaan mutu projek: lint, test, build.
#
# Mendeteksi sendiri jenis projek dari file manifesnya, lalu menjalankan
# perintah yang sesuai. Portable — jalan di agent manapun.
#
# Pemakaian:
#   bash .agent/scripts/verifikasi.sh           # semua pemeriksaan
#   bash .agent/scripts/verifikasi.sh --cepat   # lewati build (untuk iterasi)
#
# Keluar dengan kode 1 kalau ada yang gagal, supaya bisa dipakai di skrip lain.

set -u
cd "$(dirname "$0")/../.."

CEPAT=0
[ "${1:-}" = "--cepat" ] && CEPAT=1

LULUS=0
GAGAL=0
LEWAT=0
GAGAL_LIST=""

jalankan() {  # jalankan <label> <perintah>
  label="$1"; shift
  printf '  %-22s ' "$label"
  if out=$("$@" 2>&1); then
    echo "lulus"
    LULUS=$((LULUS + 1))
  else
    echo "GAGAL"
    GAGAL=$((GAGAL + 1))
    GAGAL_LIST="$GAGAL_LIST|$label"
    printf '%s\n' "$out" | tail -25 | sed 's/^/      /'
  fi
}

ada_skrip() {  # ada_skrip <nama> — cek skrip npm
  [ -f package.json ] && grep -q "\"$1\"" package.json 2>/dev/null
}

echo "Verifikasi projek"
echo "================="
echo

# ---------- Node / JavaScript / TypeScript ----------
if [ -f package.json ]; then
  echo "Terdeteksi: Node.js"
  runner="npm run"
  [ -f pnpm-lock.yaml ] && runner="pnpm run"
  [ -f yarn.lock ] && runner="yarn"

  ada_skrip lint       && jalankan "lint"        $runner lint       || LEWAT=$((LEWAT+1))
  ada_skrip typecheck  && jalankan "typecheck"   $runner typecheck
  [ -f tsconfig.json ] && ! ada_skrip typecheck && jalankan "tsc --noEmit" npx tsc --noEmit
  ada_skrip test       && jalankan "test"        $runner test       || LEWAT=$((LEWAT+1))
  [ "$CEPAT" -eq 0 ] && ada_skrip build && jalankan "build" $runner build
  echo

# ---------- Python ----------
elif [ -f pyproject.toml ] || [ -f requirements.txt ] || [ -f setup.py ]; then
  echo "Terdeteksi: Python"

  command -v ruff    >/dev/null 2>&1 && jalankan "ruff"      ruff check .
  command -v flake8  >/dev/null 2>&1 && ! command -v ruff >/dev/null 2>&1 && jalankan "flake8" flake8 .
  command -v mypy    >/dev/null 2>&1 && [ -f mypy.ini -o -f pyproject.toml ] && jalankan "mypy" mypy .
  command -v pytest  >/dev/null 2>&1 && jalankan "pytest"    pytest -q
  echo

# ---------- Go ----------
elif [ -f go.mod ]; then
  echo "Terdeteksi: Go"
  jalankan "go vet"   go vet ./...
  jalankan "go test"  go test ./...
  [ "$CEPAT" -eq 0 ] && jalankan "go build" go build ./...
  command -v golangci-lint >/dev/null 2>&1 && jalankan "golangci-lint" golangci-lint run
  echo

# ---------- Rust ----------
elif [ -f Cargo.toml ]; then
  echo "Terdeteksi: Rust"
  jalankan "cargo clippy" cargo clippy -- -D warnings
  jalankan "cargo test"   cargo test
  [ "$CEPAT" -eq 0 ] && jalankan "cargo build" cargo build
  echo

# ---------- PHP ----------
elif [ -f composer.json ]; then
  echo "Terdeteksi: PHP"
  [ -f vendor/bin/phpunit ] && jalankan "phpunit" vendor/bin/phpunit
  [ -f vendor/bin/phpstan ] && jalankan "phpstan" vendor/bin/phpstan analyse
  echo

else
  echo "Jenis projek tidak dikenali — tidak ada manifes yang cocok."
  echo "Jalankan pemeriksaan secara manual, lalu catat perintahnya di"
  echo "REPO-MAP.md bagian 'Perintah' supaya terdeteksi lain kali."
  echo
fi

# ---------- Pemeriksaan umum ----------
echo "Pemeriksaan umum"

# Rahasia yang belum ter-commit tapi ada di staging
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  bocor=$(git diff --cached --name-only 2>/dev/null \
    | grep -iE '\.(env|key|pem)$|credentials|secrets?\.' || true)
  if [ -n "$bocor" ]; then
    echo "  rahasia di staging     GAGAL"
    printf '%s\n' "$bocor" | sed 's/^/      /'
    GAGAL=$((GAGAL + 1))
    GAGAL_LIST="$GAGAL_LIST|rahasia di staging"
  else
    echo "  rahasia di staging     lulus"
    LULUS=$((LULUS + 1))
  fi
fi

# Penanda kerja setengah jadi
sisa=$(grep -rn -E "(FIXME|XXX|HACK)\b|console\.log\(|debugger;|print\(['\"]debug" \
  --include=*.{js,jsx,ts,tsx,py,go,rs,php} . 2>/dev/null \
  | grep -vE 'node_modules|\.min\.|dist/|build/|vendor/|test|spec' | head -5 || true)
if [ -n "$sisa" ]; then
  echo "  sisa debug             perhatikan"
  printf '%s\n' "$sisa" | cut -c1-95 | sed 's/^/      /'
else
  echo "  sisa debug             bersih"
fi

echo
echo "================="
echo "Lulus: $LULUS  |  Gagal: $GAGAL"

if [ "$GAGAL" -gt 0 ]; then
  echo
  echo "Yang gagal:"
  printf '%s' "$GAGAL_LIST" | tr '|' '\n' | grep -v '^$' | sed 's/^/  - /'
  echo
  echo "Perbaiki dulu sebelum menyatakan pekerjaan selesai."
  exit 1
fi

if [ "$LULUS" -eq 0 ]; then
  echo
  echo "Tidak ada pemeriksaan yang berjalan. Jangan menyatakan 'sudah diverifikasi'"
  echo "— katakan terus terang bahwa perubahan ini belum teruji."
  exit 0
fi

echo "Semua pemeriksaan lulus."
