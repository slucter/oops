# Aturan Git

---

## Kalau projek belum dilacak git

Periksa dulu:

```bash
git rev-parse --is-inside-work-tree 2>/dev/null
```

Kalau belum repo git, **buat sendiri** — jangan menunggu diminta. Riwayat git
adalah bentuk penyimpanan konteks yang paling tahan banting; tanpa itu, kerja
bisa hilang begitu saja.

```bash
git init -q .
git symbolic-ref HEAD refs/heads/main 2>/dev/null || true
git add .
git commit -m "chore: initial commit"
```

Setelah itu pasang hook pengaman:
```bash
bash .agent/scripts/install-hooks.sh
```

## Dua mode: lokal dan ber-remote

Periksa apakah ada remote:

```bash
git remote get-url origin 2>/dev/null
```

**Tanpa remote (lokal saja).** Ini kondisi normal untuk projek baru. Commit dan
branch berjalan otomatis seperti biasa. Yang berbeda: jangan mencoba `push` atau
`pull` — akan gagal, dan kegagalannya membingungkan. Cukup commit rutin.

Jangan mendesak pemilik projek membuat remote. Kalau dia menyebut GitHub/GitLab
atau minta kodenya bisa diakses dari tempat lain, barulah tawarkan:
```bash
git remote add origin <url>
git push -u origin main
```

**Dengan remote.** Commit, push, dan merge semuanya berjalan otomatis sesuai
aturan di bawah.

Periksa kondisi ini **sekali di awal session**, bukan setiap kali mau commit.

---

## Tingkat kebebasan

Pemilik projek ini memilih mode **otomatis**. Artinya:

**Jalan sendiri, tanpa bertanya:**
- `git add` (file yang relevan saja, bukan `git add -A` membabi buta)
- `git commit`
- `git branch`, `git checkout -b`
- `git push` ke branch kerja
- `git merge` yang tidak konflik
- `git pull`, `git fetch`

**Selalu konfirmasi dulu** (tidak bisa dibatalkan):
- `git push --force` / `--force-with-lease`
- `git reset --hard`
- `git clean -fd`
- menghapus branch (`git branch -D`, `git push --delete`)
- `git rebase` pada commit yang sudah di-push
- `git commit --amend` pada commit yang sudah di-push

**Tidak pernah, kecuali diminta secara eksplisit:**
- `--no-verify` (melewati hook) — kalau hook gagal, perbaiki akar masalahnya
- `--no-gpg-sign`
- force push ke `main` / `master`
- mengubah `git config`

## Sebelum commit

1. `git status` — lihat apa yang akan ikut.
2. Periksa daftarnya. Kalau ada yang mencurigakan (`.env`, `*.key`, `*.pem`,
   `credentials.json`, dump database), **jangan commit** — laporkan ke pemilik
   projek.
3. `git add` per-file dengan nama. Hindari `git add -A` / `git add .` karena
   keduanya mudah menyeret file yang tidak kamu maksud.
4. Commit.

Kalau *pre-commit hook* gagal, commit **tidak terjadi**. Perbaiki penyebabnya,
`git add` ulang, lalu buat commit **baru**. Jangan `--amend` — commit
sebelumnya adalah commit lain, dan meng-*amend*-nya bisa menghapus kerja.

## Format pesan commit

Gunakan Conventional Commits:

```
<tipe>(<lingkup>): <ringkasan dalam bahasa Inggris, huruf kecil, tanpa titik>

<badan opsional: JELASKAN KENAPA, bukan apa. Diff sudah menjelaskan apa.>
```

Tipe: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `build`, `ci`.

Contoh yang baik:
```
fix(auth): reject tokens issued before password change

Session tetap hidup setelah pengguna mengganti password, sehingga
kredensial yang bocor masih bisa dipakai.
```

Aturan tambahan:
- Ringkasan maksimal 72 karakter.
- `feat` = kemampuan yang benar-benar baru. `fix` = memperbaiki yang rusak.
  `refactor` = bentuk berubah, perilaku tidak.
- Satu commit = satu perubahan yang utuh dan bermakna. Jangan menggabung
  perbaikan bug dengan penataan ulang kode.

## Penamaan branch

```
feat/<deskripsi-singkat>
fix/<deskripsi-singkat>
refactor/<deskripsi-singkat>
chore/<deskripsi-singkat>
```

Jangan bekerja langsung di `main` untuk apa pun yang lebih besar dari perbaikan
satu baris.

## Merge

- Selesaikan konflik, jangan membuang salah satu sisi. Kalau tidak yakin sisi
  mana yang benar, tanya.
- Setelah merge, jalankan test. Merge yang bersih secara tekstual tetap bisa
  merusak perilaku.

## Kapan commit

Commit saat satu unit kerja selesai dan konsisten — bukan setiap kali file
disimpan, bukan juga menumpuk seharian jadi satu commit raksasa. Patokan:
kalau kamu bisa menulis satu kalimat ringkasan yang jujur untuk perubahan itu,
saat itu waktunya commit.
