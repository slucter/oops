---
name: handoff
description: Gunakan di AKHIR session — ketika pemilik projek bilang "sudah dulu", "simpan", "besok lanjut", "cukup", atau ketika pekerjaan besar baru saja rampung. Menulis jurnal, commit, memperbarui dokumen konteks supaya session berikutnya bisa melanjutkan.
---

# /handoff

Dijalankan di **akhir** session. Ini satu-satunya hal yang menjembatani session
sekarang dengan session berikutnya — tanpa ini, konteks hilang total.

Jalankan juga ketika pemilik projek bilang "sudah dulu", "simpan", atau saat
kamu merasa pekerjaan besar baru saja rampung.

---

## Langkah 1 — Kumpulkan apa yang terjadi

```bash
git status
git log --oneline <commit-awal-session>..HEAD
git diff --stat
```

Susun jawaban jujur untuk:
- Apa yang **selesai** — dan sudah diverifikasi bagaimana?
- Apa yang **setengah jadi** — berhenti di mana, kenapa?
- Apa yang **dicoba lalu dibatalkan** — dan kenapa jangan diulang?
- Ada **hambatan** yang menghentikan langkah?

Bagian "dicoba lalu dibatalkan" gampang terlupakan tapi paling berharga. Tanpa
itu, session berikutnya akan mengulangi jalan buntu yang sama.

## Langkah 2 — Rapikan yang tergantung

Sebelum menutup:
- Hapus kode percobaan, `console.log` sisa debug, file sementara yang kamu buat.
- Kalau ada fungsi yang sengaja kamu tinggal kosong, beri `TODO` dengan alasan.
- Jangan tinggalkan kode yang tidak bisa dikompilasi. Kalau terpaksa, tulis
  besar-besar di jurnal.

## Langkah 3 — Commit

Ikuti `.agent/rules/10-git.md`. Periksa `git status` sebelum `git add`, pastikan
tidak ada file rahasia yang ikut. Pecah jadi beberapa commit kalau perubahannya
memang beberapa hal terpisah.

Push ke branch kerja.

## Langkah 4 — Perbarui dokumen konteks

- Struktur projek berubah (folder/modul baru)? Jalankan `/peta`.
- Ada keputusan arsitektur diambil? Jalankan `/keputusan`.
- Tahap di `PLAN.md` selesai? Tandai.
- Pemilik projek menyatakan preferensi baru? Tulis ke `.agent/memory/`.
- Ada kredensial baru disebut? Jalankan `/simpan-rahasia`.

## Langkah 5 — Tulis jurnal

Tambahkan di **paling atas** `.agent/context/JOURNAL.md` (terbaru di atas):

```markdown
## <YYYY-MM-DD> · <judul singkat>

**Agent:** <nama & model agent>
**Branch:** <branch> · **Commit:** <hash pendek terakhir>

### Selesai
- <apa, dan diverifikasi bagaimana>

### Belum selesai
- <apa, berhenti di mana, kenapa>

### Keputusan
- <keputusan dan alasannya — kalau besar, tulis ADR dan tautkan ke sini>

### Jalan buntu
- <yang dicoba dan gagal, supaya tidak diulang>

### Langkah berikutnya
- <tugas konkret berikutnya, cukup jelas untuk dikerjakan orang/agent lain>

### Catatan
<hambatan, kredensial baru yang tersedia — sebut nama, bukan nilai>
```

Syarat entri jurnal yang baik:
- Bisa dibaca oleh agent yang sama sekali tidak tahu isi percakapan tadi.
- "Langkah berikutnya" harus konkret — "perbaiki auth" tidak cukup, "tambahkan
  pengecekan kedaluwarsa token di `src/auth/verify.ts:34`" cukup.
- **Tidak ada nilai rahasia.** Sebut namanya saja.

## Langkah 6 — Kosongkan status kerja

Isi `WORKING-STATE.md` sudah dipindahkan ke jurnal, jadi kembalikan ke kerangka
kosong — supaya session berikutnya tidak salah mengira ada kerja yang tergantung:

```bash
git checkout .agent/context/WORKING-STATE.md 2>/dev/null \
  || echo "(kembalikan manual — kerangkanya ada di file itu sendiri)"
```

Pengecualian: kalau session ini **tidak** selesai tuntas dan memang ada kerja
yang sengaja digantung, jangan dikosongkan. Biarkan terisi supaya session
berikutnya langsung tahu posisinya.

## Langkah 7 — Commit dokumennya

```bash
git add .agent/context/ .agent/memory/
git commit -m "docs(agent): session journal <tanggal>"
git push
```

## Langkah 8 — Lapor singkat

Dua-tiga kalimat ke pemilik projek: apa yang selesai, apa yang menggantung, apa
langkah berikutnya. Tidak perlu mengulang isi jurnal.
