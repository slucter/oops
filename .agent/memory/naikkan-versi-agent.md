# Naikkan versi agent sendiri, tanpa diminta

**Diberikan:** 2026-09-30
**Konteks:** setelah menambah fitur update agent + multi-runtime

## Arahan

Setiap kali menyentuh berkas di `agent/`, **naikkan `AGENT_VERSION` sebagai
bagian dari perubahan itu** — jangan menunggu diminta, dan jangan menyerahkan
keputusannya ke pemilik projek.

Dua tempat, harus sama:
- `agent/version.js`  → dipakai agent Node dan dibaca server
- `agent/agent.py`    → konstanta terpisah, agent Python tidak bisa membaca `.js`

## Kenapa

Versi bukan catatan administratif di projek ini — versi **adalah** mekanisme
update. Server membandingkan versi yang ia sajikan dengan versi yang dilaporkan
tiap client untuk memutuskan siapa yang perlu di-update.

Kalau kode agent berubah tapi versinya tidak, dashboard akan bilang semua client
sudah terbaru padahal mereka menjalankan kode lama. Tombol Update tidak pernah
muncul, dan **tidak ada error apa pun** yang memberi tahu. Perbaikan yang sudah
dikerjakan diam-diam tidak pernah sampai ke server mana pun.

Kegagalan diam seperti ini yang paling mahal: tidak ada yang tahu sampai ada
insiden yang seharusnya sudah tertangani.

## Cara menerapkan

Aturan kenaikan:
- **PATCH** (1.1.0 → 1.1.1): perbaikan bug, tanpa perubahan perilaku
- **MINOR** (1.1.0 → 1.2.0): metrik/kemampuan baru, tetap kompatibel
- **MAJOR** (1.1.0 → 2.0.0): protokol berubah sehingga server lama tidak lagi
  memahami agent baru (atau sebaliknya)

Dua penjaga sudah terpasang, tapi keduanya hanya jaring — bukan pengganti
kebiasaan menaikkan versi sejak awal:
- `npm test` menolak kalau kedua berkas tidak sepakat
- pre-commit hook menolak commit yang mengubah `agent/` tanpa versi naik

Kalau perubahannya benar-benar tidak memengaruhi client (mis. hanya komentar),
katakan alasannya saat melewati penjaga itu — jangan lewati diam-diam.

Terkait: [[preferensi]]
