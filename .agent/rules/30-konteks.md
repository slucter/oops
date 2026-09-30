# Aturan Kontinuitas Konteks

Agent AI tidak punya ingatan lintas-session. Lebih dari itu, **konteks dalam
satu session pun bisa habis** — percakapan panjang akan diringkas otomatis
(*compact*), dan detail pekerjaan yang sedang berjalan bisa hilang di tengah
jalan.

Aturan ini mencegah kerja yang hilang karena hal itu.

---

## Masalahnya

Tiga hal yang bisa memutus konteks, dan semuanya terjadi tanpa peringatan:

1. **Session berakhir** — kamu ditutup, besok agent lain yang membuka.
2. **Konteks ter-compact** — percakapan terlalu panjang, sebagian diringkas.
   Kamu masih berjalan, tapi detailnya kabur.
3. **Session terputus** — koneksi putus, aplikasi ditutup, listrik mati.

Dalam ketiganya, yang selamat hanyalah **apa yang sudah ditulis ke file**.
Ingatan tidak selamat. Percakapan tidak selamat.

## Aturan 1 — Perbarui status kerja secara berkala

`.agent/context/WORKING-STATE.md` adalah penyelamatmu. Perbarui **setiap kali
menyelesaikan satu langkah berarti** — bukan di akhir session.

Yang dihitung sebagai "langkah berarti":
- selesai satu file atau satu fungsi utuh
- menemukan akar masalah sebuah bug
- mengambil keputusan yang mengubah arah
- menjalankan test dan mendapat hasilnya
- menemui hambatan yang menghentikan langkah

Isinya harus cukup supaya **agent lain yang tidak tahu apa-apa** bisa
melanjutkan. Patokan sederhana: kalau kamu dimatikan tepat setelah menulisnya,
apakah penggantimu bisa lanjut tanpa bertanya?

Memperbarui file ini makan beberapa detik. Kehilangan satu jam kerja jauh lebih
mahal.

## Aturan 2 — Kenali tanda konteks menipis

Kalau kamu menyadari salah satu dari ini:
- percakapan sudah sangat panjang,
- kamu mulai tidak yakin apa yang sudah kamu kerjakan tadi,
- kamu baru saja menerima ringkasan percakapan sebelumnya,

maka **segera** perbarui `WORKING-STATE.md` sebelum melanjutkan. Jangan tunda.

## Aturan 3 — Setelah compact, muat ulang dari file

Kalau kamu mendapati dirimu melanjutkan percakapan yang sudah diringkas, atau
ragu soal apa yang sedang dikerjakan:

1. Baca `.agent/context/WORKING-STATE.md` — posisimu ada di situ.
2. Jalankan `git status` dan `git diff` — lihat perubahan nyata yang menggantung.
3. Kalau masih kurang, jalankan `bash .agent/scripts/muat-konteks.sh`.

**Jangan menebak** apa yang sedang kamu kerjakan dari sisa percakapan yang
kabur. Baca file. Percayai file, bukan ingatan yang sudah diringkas.

**Jangan mengulang pekerjaan** yang mungkin sudah selesai — periksa `git diff`
dulu. Mengerjakan ulang hal yang sudah jadi bisa merusak yang sudah benar.

## Aturan 4 — Commit lebih sering

Commit adalah bentuk penyimpanan konteks yang paling tahan banting. Pesan commit
yang jelas menyelamatkan pekerjaan meskipun semua file catatan hilang.

Commit setiap kali satu unit kerja utuh — jangan menunggu semuanya sempurna.
Kerja yang sudah ter-commit tidak bisa hilang karena konteks habis.

## Aturan 5 — Di awal session, selalu muat konteks

Sebelum menyentuh kode apa pun di session baru:

```bash
bash .agent/scripts/muat-konteks.sh
```

Atau jalankan skill `/lanjut` yang melakukan hal sama plus verifikasi.

Perhatikan urutan kepercayaan kalau ada pertentangan:

1. **Kondisi git** (`git status`, `git diff`) — paling dapat dipercaya
2. `WORKING-STATE.md` — kondisi terakhir yang tercatat
3. `JOURNAL.md` — riwayat session sebelumnya
4. `REPO-MAP.md` — bentuk projek, bisa agak basi

Kalau dokumen bertentangan dengan git, **percayai git** dan perbaiki dokumennya.

## Aturan 6 — Di akhir session, pindahkan ke jurnal

Jalankan `/handoff`. Isi `WORKING-STATE.md` dipindahkan jadi entri permanen di
`JOURNAL.md`, lalu status kerja dikosongkan untuk session berikutnya.

Kalau session berakhir mendadak dan `/handoff` tidak sempat jalan,
`WORKING-STATE.md` yang rajin diperbarui tetap menyelamatkan keadaan.

---

## Ringkasnya

| Kapan | Lakukan |
|---|---|
| Awal session | `bash .agent/scripts/muat-konteks.sh` atau `/lanjut` |
| Tiap langkah selesai | Perbarui `WORKING-STATE.md` |
| Konteks terasa menipis | Perbarui `WORKING-STATE.md` **sekarang** |
| Setelah compact | Baca `WORKING-STATE.md` + `git status`, jangan menebak |
| Unit kerja utuh | Commit |
| Akhir session | `/handoff` |
