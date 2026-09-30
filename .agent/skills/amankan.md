---
name: amankan
description: Gunakan ketika pemilik projek menyebut keamanan — "aman tidak", "ada celah", "audit", "hardening", "rentan", "diserang", atau minta kode diperiksa dari sisi keamanan. Menelusuri jalur dari masukan tak tepercaya sampai operasi berbahaya, mencari celah yang benar-benar bisa dieksploitasi.
---

# /amankan [area atau seluruh projek]

Audit keamanan yang buruk menghasilkan daftar panjang peringatan sepele yang
tidak ada yang membaca. Audit yang baik menemukan sedikit celah yang
**benar-benar bisa dieksploitasi** dan menjelaskan caranya.

Skill ini mengejar yang kedua. Setiap temuan harus disertai skenario serangan
yang konkret — kalau kamu tidak bisa menjelaskan bagaimana penyerang
memanfaatkannya, itu bukan temuan.

---

## Langkah 0 — Muat konteks

Baca `REPO-MAP.md` (terutama alur utama dan area rawan), `.env.example` (untuk
tahu kredensial apa yang ada), dan ADR terkait autentikasi/otorisasi.

Lalu tentukan **model ancamannya**, karena ini menentukan apa yang penting:

- Siapa penyerang yang masuk akal? (pengunjung anonim, pengguna terdaftar yang
  ingin naik hak akses, orang dalam, penyerang jaringan)
- Apa yang paling berharga di sistem ini? (data pengguna, uang, kredensial,
  ketersediaan layanan)
- Apa yang terbuka ke luar? (endpoint publik, unggahan file, webhook)

Aplikasi internal dengan lima pengguna tepercaya punya prioritas yang sangat
berbeda dari API publik. Tanyakan kalau tidak jelas.

## Langkah 1 — Petakan permukaan serangan

Temukan **semua titik masuk** data tak tepercaya:

```bash
# Endpoint HTTP
grep -rn -E "@(Get|Post|Put|Delete|Patch)|app\.(get|post|put|delete)|router\.(get|post)" \
  --include=*.{ts,js,py,go,java} . | grep -v node_modules

# Pembacaan input
grep -rn -E "req\.(body|query|params|headers|cookies)|request\.(form|args|json)" \
  --include=*.{ts,js,py} . | grep -v node_modules

# Unggahan file
grep -rn -E "multer|upload|FormData|request\.files" --include=*.{ts,js,py} . | grep -v node_modules
```

Catat tiap titik masuk: data apa yang diterima, siapa yang boleh memanggilnya.

## Langkah 2 — Telusuri dari masukan ke operasi berbahaya

Ini inti auditnya. Untuk tiap titik masuk, ikuti datanya sampai ia mencapai
**sink** — operasi yang berbahaya kalau menerima nilai yang dikuasai penyerang:

| Sink | Risiko kalau tak disaring |
|---|---|
| Query database yang dirangkai string | SQL injection |
| `exec`, `spawn`, `system`, `eval` | Eksekusi perintah |
| Operasi file dengan path dari input | Path traversal |
| Render HTML tanpa escape | XSS |
| Permintaan HTTP ke URL dari input | SSRF |
| Deserialisasi objek | Eksekusi kode |
| Redirect ke URL dari input | Open redirect |

Cari sink-nya:

```bash
grep -rn -E "exec\(|execSync|spawn\(|eval\(|os\.system|subprocess" --include=*.{ts,js,py} . | grep -v node_modules
grep -rn -E "innerHTML|dangerouslySetInnerHTML|v-html" --include=*.{ts,js,jsx,tsx,vue,html} . | grep -v node_modules
grep -rniE "(SELECT|INSERT|UPDATE|DELETE).*(\+|%s)" --include=*.{ts,js,py,go} . | grep -v node_modules
```

**Sebuah sink hanya jadi celah kalau jalurnya benar-benar tersambung ke masukan
tak tepercaya tanpa penyaringan di tengah.** Telusuri jalurnya, jangan hanya
mencocokkan pola. Pencocokan pola menghasilkan laporan palsu.

## Langkah 3 — Periksa otorisasi

Ini kategori celah yang paling sering terlewat dan paling sering dieksploitasi
di dunia nyata — dan tidak bisa ditemukan dengan `grep`.

Untuk **tiap** endpoint yang mengakses atau mengubah data:

- Apakah ada pemeriksaan **autentikasi**? (siapa kamu)
- Apakah ada pemeriksaan **otorisasi**? (kamu boleh menyentuh data *ini*?)

Perbedaan keduanya menentukan. Endpoint `GET /invoice/:id` yang hanya memeriksa
"pengguna sudah login" tapi tidak memeriksa "invoice ini miliknya" memungkinkan
pengguna mana pun membaca invoice orang lain hanya dengan mengubah angka di URL.
Ini disebut IDOR, dan ia ada di mana-mana.

Periksa juga:
- Endpoint admin — dilindungi pemeriksaan peran, atau cuma disembunyikan dari UI?
- Bisakah pengguna biasa menaikkan perannya sendiri lewat endpoint pembaruan profil?
- Apakah pemeriksaan otorisasi terjadi di server, atau hanya di antarmuka?

## Langkah 4 — Periksa autentikasi & sesi

- Password di-hash dengan bcrypt/argon2/scrypt? (bukan MD5, SHA-1, atau polos)
- Token sesi: acak secara kriptografis, punya masa berlaku?
- Sesi dibatalkan saat logout dan saat ganti password?
- Cookie: `HttpOnly`, `Secure`, `SameSite`?
- Ada pembatasan laju di endpoint login? (tanpa ini, tebak-sandi massal bebas)
- Alur reset password: token sekali pakai, kedaluwarsa, tidak bocor lewat
  referrer?

## Langkah 5 — Periksa kredensial & konfigurasi

```bash
# Rahasia yang ter-hardcode
grep -rnE "(api[_-]?key|secret|password|token|passwd)[[:space:]]*[:=]" \
  --include=*.{ts,js,py,go,java,json,yml,yaml} . \
  | grep -v -E "node_modules|\.example|process\.env|os\.environ"

# Rahasia yang pernah masuk riwayat git
git log --all --full-history -- .env 2>/dev/null | head
```

Periksa juga:
- `.env` benar-benar ter-gitignore? (`git check-ignore -v .env`)
- Mode debug mati di produksi?
- Pesan error ke pengguna bocor *stack trace*, versi, atau struktur database?
- CORS: wildcard pada endpoint yang butuh kredensial adalah celah
- Dependensi punya kerentanan? (`npm audit`, `pip-audit`, `govulncheck`)

## Langkah 6 — Periksa penanganan data

- Data sensitif ter-log? (password, token, nomor kartu, data pribadi)
- Data sensitif terkirim ke layanan pihak ketiga?
- Enkripsi saat transit dan saat disimpan, kalau memang perlu?
- Penghapusan data benar-benar menghapus?

## Langkah 7 — Susun temuan berdasarkan dampak

Peringkat tiap temuan dengan **dua sumbu**: seberapa buruk akibatnya, dan
seberapa mudah dilakukan.

| Tingkat | Arti |
|---|---|
| **Kritis** | Dapat diakses tanpa autentikasi, berakibat pengambilalihan sistem atau kebocoran data massal |
| **Tinggi** | Butuh akun biasa, berakibat akses data pengguna lain atau naik hak akses |
| **Sedang** | Butuh kondisi tertentu, atau dampaknya terbatas |
| **Rendah** | Pengerasan mendalam; belum tentu bisa dieksploitasi sekarang |

Format tiap temuan:

```markdown
### [TINGKAT] <judul singkat>

**Lokasi:** `path/file.ts:42`

**Celah:** <apa yang salah>

**Skenario serangan:** <langkah konkret. Contoh: "Penyerang mengirim POST ke
/api/user/update dengan body berisi field role — kolom role tidak masuk daftar
putih, sehingga langsung tersimpan dan dia jadi admin.">

**Dampak:** <apa yang bisa dilakukan penyerang setelah berhasil>

**Perbaikan:** <cara menutup, konkret>
```

**Kalau kamu tidak bisa menulis bagian "skenario serangan" dengan meyakinkan,
buang temuan itu.** Daftar panjang berisi kemungkinan teoretis justru membuat
temuan yang nyata tenggelam.

## Langkah 8 — Perbaiki

Tanyakan dulu ke pemilik projek mana yang mau ditutup sekarang — jangan
langsung memperbaiki semuanya, karena sebagian perbaikan keamanan mengubah
perilaku dan bisa merusak pemakaian yang sah.

Saat memperbaiki:
- Dahulukan Kritis dan Tinggi.
- **Perbaiki di lapisan yang benar.** Validasi masukan di server, tidak pernah
  hanya di antarmuka.
- Pakai pustaka standar, jangan membuat sendiri: query berparameter untuk SQL,
  pustaka escape untuk HTML, pustaka hash mapan untuk password.
- Gunakan **daftar putih**, bukan daftar hitam. Daftar hitam selalu bocor.
- Satu commit per celah, supaya bisa ditinjau dan di-*revert* terpisah.
- Setelah tiap perbaikan, **uji ulang** skenario serangannya. Harus gagal.
- Jalankan test suite — perbaikan keamanan sering merusak jalur yang sah.

Pesan commit: jelaskan kelas kerentanannya tanpa memberi resep eksploitasi,
terutama kalau repo-nya publik.

```
fix(auth): enforce ownership check on invoice endpoints
```

## Langkah 9 — Catat

- Tulis ADR untuk keputusan keamanan yang penting (`/keputusan`).
- Catat di jurnal: apa yang diaudit, apa yang ditutup, apa yang **sengaja
  ditunda** beserta alasannya.
- Temuan yang belum ditutup harus tercatat, jangan hilang begitu saja.

---

## Batasan yang harus disampaikan jujur

Audit ini adalah pembacaan kode, bukan uji penetrasi. Yang **tidak** tercakup:
kerentanan pada infrastruktur, konfigurasi server, celah rantai pasok yang lebih
dalam, dan apa pun yang hanya muncul saat aplikasi benar-benar berjalan.

Sampaikan ini ke pemilik projek. "Sudah diaudit" tidak sama dengan "sudah aman".
