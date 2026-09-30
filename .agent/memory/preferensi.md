---
name: preferensi-pemilik-projek
description: Cara kerja dan keputusan setup yang dipilih pemilik projek saat harness ini dibangun
type: user
---

# Preferensi Pemilik Projek

## Bahasa
Berkomunikasi dalam **Bahasa Indonesia**. Nama variabel, pesan commit, komentar
kode, dan dokumentasi teknis di dalam kode tetap **Bahasa Inggris**.

## Keputusan setup harness

**Portabilitas antar-agent.** Harness dirancang agar berjalan di AI agent mana
pun. `.agent/` adalah sumber kebenaran; `.claude/`, `.cursor/`, `.kilo/`,
`.github/` hanya adapter yang menunjuk ke sana.
**Kenapa:** pemilik projek berganti-ganti agent dan model, dan tidak mau
kehilangan konteks setiap kali pindah.

**Git otomatis.** Commit, branch, push, dan merge berjalan tanpa bertanya.
Operasi yang tidak bisa dibatalkan (`push --force`, `reset --hard`, hapus
branch) tetap butuh konfirmasi.
**Kenapa:** pemilik projek ingin alur kerja cepat tanpa interupsi. Batasan pada
operasi destruktif dipertahankan karena akibatnya permanen.

**Rahasia di `.env` dalam repo.** Nilai asli di `.env` (ter-gitignore), katalog
non-rahasia di `.env.example` (di-commit).
**Kenapa:** praktis, dan agent tetap paham akses apa yang tersedia lewat
katalog. Dilindungi hook `pre-commit`.
**Perhatian:** kalau repo jadi publik, pindahkan nilainya ke luar folder projek.

**Kontinuitas lewat tiga mekanisme:** peta repo (`REPO-MAP.md`), jurnal session
(`JOURNAL.md`), dan catatan keputusan (ADR).
**Kenapa:** agent tidak punya ingatan lintas-session. Ketiganya menjembatani
lewat file yang ikut repo.

## Cara bekerja

Pemilik projek menghargai agent yang **memahami alur sebelum mengubah kode** —
ini ditekankan secara eksplisit saat merancang skill `/perbaiki`. Jangan
langsung menambal; petakan dulu jalur kodenya dan cari tahu siapa saja yang
memanggilnya.
