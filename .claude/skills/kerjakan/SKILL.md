---
name: kerjakan
description: Gunakan ketika pemilik projek bilang "kerjakan", "jalankan rencananya", "lanjutkan tahap berikutnya", atau minta rencana yang sudah disetujui dieksekusi. Mengerjakan tahap demi tahap secara mandiri: kerjakan, verifikasi, commit, perbarui status, lanjut — berhenti sendiri kalau gagal atau butuh keputusan.
---

# /kerjakan [tahap tertentu, atau kosong untuk lanjut dari posisi terakhir]

Setelah `/projek-baru` menghasilkan rencana bertahap, skill ini yang
mengeksekusinya — satu putaran per tahap, mandiri, sampai rencana selesai atau
ada yang menghentikan.

Tujuannya: kamu tidak perlu mengetik "lanjut" setiap kali satu tahap kelar.

---

## Sebelum mulai

Harus ada rencana. Baca `.agent/context/PLAN.md`.

Kalau belum ada, jalankan `/projek-baru` dulu. Mengeksekusi tanpa rencana
berarti membangun tanpa tahu kriteria selesainya, dan itu selalu berakhir
dengan kerja yang harus dibongkar.

Kalau statusnya belum `disetujui`, **jangan mulai**. Minta persetujuan dulu.

---

## Putaran per tahap

Untuk setiap tahap, jalankan enam langkah ini berurutan. Jangan melompat.

### 1. Baca tahapnya

Ambil tahap berikutnya yang belum bertanda selesai. Pastikan kamu paham:
- tujuannya apa,
- kriteria selesainya apa — harus bisa diperiksa, bukan "sudah beres",
- bergantung pada tahap mana.

Kalau kriteria selesainya kabur, **tanyakan sekarang**, sebelum menulis kode.
Tahap tanpa kriteria yang jelas tidak bisa dinyatakan selesai secara jujur.

### 2. Kerjakan

Ikuti aturan di `00-core.md`: pahami kode yang ada dulu, kerjakan sebatas
lingkup tahap ini, jangan menambah abstraksi yang belum dibutuhkan.

Kalau di tengah jalan kamu melihat pekerjaan yang seharusnya masuk tahap lain —
**catat, jangan kerjakan**. Menggabung tahap merusak kemampuan melacak apa yang
sudah benar-benar selesai.

### 3. Verifikasi

Ini yang membedakan "selesai" dari "seharusnya jalan". Wajib:

```bash
bash .agent/scripts/verifikasi.sh
```

Skrip itu mendeteksi jenis projek sendiri (Node, Python, Go, Rust, PHP) lalu
menjalankan lint, test, dan build yang sesuai. Keluar dengan kode 1 kalau ada
yang gagal, jadi hasilnya tidak bisa disalahartikan.

Kalau jenis projeknya tidak terdeteksi, jalankan perintahnya manual — lihat
`REPO-MAP.md` bagian "Perintah".

Untuk perubahan UI: jalankan aplikasinya dan pakai fiturnya. Lulus *type check*
membuktikan bentuknya benar, bukan fiturnya benar.

**Kalau tidak bisa diverifikasi** (tidak ada test, tidak ada akses browser),
katakan terus terang di laporan. Jangan menyatakan selesai untuk sesuatu yang
belum kamu lihat berjalan.

### 4. Kalau gagal — berhenti, jangan paksakan

Gagal verifikasi berarti tahap ini **belum selesai**. Jangan lanjut ke tahap
berikutnya.

Coba perbaiki, maksimal **dua kali**. Kalau masih gagal:
- catat di `WORKING-STATE.md` apa yang gagal dan apa yang sudah dicoba,
- laporkan ke pemilik projek,
- **berhenti**.

Dua percobaan itu batas yang sehat. Menambal berulang-ulang tanpa memahami
penyebabnya menghasilkan kode yang jauh lebih sulit diperbaiki nanti.

### 5. Commit

Ikuti `10-git.md`. Satu tahap = satu commit (atau beberapa kalau memang
beberapa perubahan terpisah).

```
feat(auth): add token expiry validation

Tahap 2 dari rencana: sesi tetap hidup setelah ganti password.
```

### 6. Perbarui status

- Tandai tahap selesai di `PLAN.md`.
- Perbarui `WORKING-STATE.md`: tahap mana yang baru selesai, tahap berikutnya
  apa.

**Langkah ini tidak boleh dilewati.** Kalau session terputus setelah tahap 3
selesai tapi status belum diperbarui, session berikutnya akan mengulang tahap 3.

### 7. Lanjut atau berhenti

**Lanjut sendiri ke tahap berikutnya** kalau semuanya lancar.

**Berhenti dan tanya** kalau:
- verifikasi gagal setelah dua percobaan,
- tahap berikutnya butuh keputusan yang belum diambil (pilihan pustaka, bentuk
  skema, nama yang akan jadi API publik),
- kamu menemukan rencananya keliru — asumsi di `PLAN.md` ternyata tidak berlaku,
- butuh kredensial atau akses yang belum ada,
- tahap berikutnya menyentuh sesuatu yang sulit dibatalkan (migrasi database,
  perubahan API publik, hapus data).

Berhenti pada saat yang tepat lebih berharga daripada menyelesaikan semua tahap
dengan asumsi yang salah.

---

## Saat rencana selesai

1. Jalankan verifikasi penuh sekali lagi — seluruh test, bukan hanya yang
   terkait tahap terakhir.
2. Perbarui `REPO-MAP.md` kalau struktur berubah (`/peta`).
3. Tulis ADR untuk keputusan penting yang diambil selama eksekusi (`/keputusan`).
4. Jalankan `/handoff`.
5. Laporkan: tahap apa saja yang selesai, apa yang diverifikasi bagaimana, apa
   yang menyimpang dari rencana awal.

---

## Batasan yang harus dipatuhi

**Jangan mengubah rencana diam-diam.** Kalau selama eksekusi kamu menyadari
rencananya keliru, hentikan dan sampaikan — jangan lanjut dengan rencana versimu
sendiri. Pemilik projek menyetujui rencana yang tertulis, bukan tafsiranmu.

**Jangan melompati tahap.** Urutan tahap disusun berdasarkan ketergantungan.
Melompat berarti membangun di atas fondasi yang belum ada.

**Jangan menumpuk commit sampai akhir.** Commit per tahap adalah titik pulih.
Kalau tahap 5 ternyata salah arah, kamu bisa kembali ke tahap 4 tanpa kehilangan
apa pun.
