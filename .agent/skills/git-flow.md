---
name: git-flow
description: Gunakan ketika pemilik projek menyebut operasi git — commit, push, branch, merge, pull request — atau ketika pekerjaan selesai dan perlu disimpan. Juga ketika projek belum di-git init sama sekali. Menangani mode lokal (tanpa remote) dan mode penuh (dengan remote).
---

# /git-flow [operasi]

Skill ini menjalankan alur git harian. Pemilik projek memilih mode **otomatis**:
sebagian besar operasi berjalan tanpa bertanya. Yang tidak bisa dibatalkan tetap
butuh konfirmasi.

Baca `.agent/rules/10-git.md` untuk aturan lengkapnya. Skill ini adalah
pelaksanaannya.

---

## Sebelum apa pun — kenali kondisinya

```bash
git rev-parse --is-inside-work-tree 2>/dev/null && echo "repo: ada" || echo "repo: belum"
git remote get-url origin 2>/dev/null && echo "remote: ada" || echo "remote: belum"
```

Tiga kemungkinan:

**Belum ada repo git** — buat sendiri, jangan menunggu diminta:
```bash
git init -q .
git symbolic-ref HEAD refs/heads/main 2>/dev/null || true
git add .
git commit -m "chore: initial commit"
bash .agent/scripts/install-hooks.sh
```

**Ada repo, belum ada remote** — mode lokal. Commit dan branch jalan normal.
**Jangan** menjalankan `push`, `pull`, atau `fetch` — akan gagal. Cukup commit
rutin; itu sudah cukup melindungi kerja.

**Ada repo dan remote** — mode penuh. Semua operasi di bawah berlaku.

Periksa ini sekali di awal session, bukan tiap kali commit.

---

## Commit

### 1. Lihat apa yang ada

```bash
git status --short
git diff --stat
git branch --show-current
```

### 2. Saring file berbahaya

Wajib, sebelum `git add`:

```bash
git status --short | grep -iE '\.(env|key|pem|p12|pfx|keystore)$|credentials|secrets?\.(json|ya?ml)|id_rsa|\.sqlite$|\.dump$'
```

Kalau ada hasilnya, **jangan commit**. Laporkan ke pemilik projek. Kemungkinan
`.gitignore` bocor — perbaiki dulu.

### 3. Stage per nama

```bash
git add src/auth/verify.ts src/auth/verify.test.ts
```

Jangan `git add -A` atau `git add .` — keduanya mudah menyeret file yang tidak
kamu maksud.

### 4. Pecah kalau perlu

Kalau perubahannya beberapa hal yang berbeda, buat beberapa commit. Perbaikan
bug yang tercampur penataan ulang sulit ditinjau dan sulit di-*revert*.

### 5. Commit

```bash
git commit -m "$(cat <<'EOF'
fix(auth): reject tokens issued before password change

Session tetap hidup setelah pengguna mengganti password, sehingga
kredensial yang bocor masih bisa dipakai.
EOF
)"
```

Format: Conventional Commits. Ringkasan bahasa Inggris, huruf kecil, maks 72
karakter, tanpa titik. Badan menjelaskan **kenapa**.

### 6. Kalau hook gagal

Commit **tidak terjadi**. Perbaiki penyebabnya, `git add` ulang, buat commit
**baru**. Jangan `--amend` — itu akan mengubah commit *sebelumnya* dan bisa
menghapus kerja. Jangan `--no-verify`.

---

## Branch

```bash
git checkout -b feat/nama-fitur
```

Pola: `feat/`, `fix/`, `refactor/`, `chore/` + deskripsi singkat berhuruf kecil
dengan tanda hubung.

Jangan bekerja langsung di `main` untuk apa pun yang lebih besar dari perbaikan
satu baris.

---

## Push

Hanya berlaku kalau ada remote. Tanpa remote, lewati bagian ini sepenuhnya —
commit lokal sudah cukup.

```bash
git push -u origin $(git branch --show-current)
```

Push ke branch kerja berjalan otomatis. **Push ke `main`/`master`** — periksa
dulu apakah projek ini memang memakai alur langsung-ke-main. Kalau ada branch
lain yang aktif, tanyakan.

`git push --force` dan `--force-with-lease` **selalu** butuh konfirmasi.

### Kalau remote baru ditambahkan

Saat pemilik projek memberikan URL remote untuk pertama kali:

```bash
git remote add origin <url>
git push -u origin main
```

Seluruh riwayat commit lokal ikut terdorong sekaligus — tidak ada yang hilang
karena selama ini bekerja tanpa remote.

---

## Merge

```bash
git checkout main && git pull
git merge feat/nama-fitur
```

Kalau konflik:
1. Baca kedua sisi. Pahami apa yang masing-masing coba lakukan.
2. Selesaikan dengan menggabungkan maksud keduanya — **jangan** membuang satu
   sisi hanya supaya cepat selesai.
3. Kalau tidak yakin sisi mana yang benar, **tanya**. Jangan menebak.

Setelah merge, **jalankan test**. Merge yang bersih secara tekstual tetap bisa
merusak perilaku — dua perubahan yang masing-masing benar bisa bertabrakan
secara semantik.

---

## Yang butuh konfirmasi

Jangan pernah menjalankan ini tanpa persetujuan eksplisit di percakapan:

| Perintah | Kenapa |
|---|---|
| `git push --force` | Menimpa kerja orang lain di remote |
| `git reset --hard` | Membuang perubahan permanen |
| `git clean -fd` | Menghapus file tak terlacak permanen |
| `git branch -D` | Menghapus branch beserta commit yang belum di-merge |
| `git rebase` pada commit ter-push | Menulis ulang riwayat bersama |
| `git commit --amend` pada commit ter-push | Sama, menulis ulang riwayat bersama |

Sebelum perintah apa pun yang bisa membuang perubahan, jalankan `git status`.
Kalau ada kerja belum ter-commit yang bukan milikmu, `git stash -u` dulu, dan
beri tahu pemilik projek di mana simpanannya.

---

## Pull request

Kalau diminta:

```bash
gh pr create --title "<judul singkat, di bawah 70 karakter>" --body "$(cat <<'EOF'
## Ringkasan
- <perubahan utama>

## Cara menguji
- [ ] <langkah verifikasi>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Periksa **seluruh** commit di branch, bukan hanya yang terakhir:

```bash
git log main..HEAD --oneline
git diff main...HEAD --stat
```

Membuat PR berarti orang lain akan melihatnya — konfirmasi dulu ke pemilik
projek sebelum membuatnya.
