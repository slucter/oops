# Instruksi Projek

@AGENTS.md

---

## Catatan khusus Claude Code

Skill di `.agent/skills/` juga terpasang sebagai skill Claude Code di
`.claude/skills/`, jadi `/projek-baru`, `/perbaiki`, `/amankan`, `/handoff`, dan
lainnya bisa dipanggil langsung sebagai slash command.

Keduanya menunjuk ke isi yang sama — `.agent/` tetap sumber kebenaran. Kalau
kamu mengubah prosedur, ubah di `.agent/skills/`, lalu salin ke
`.claude/skills/<nama>/SKILL.md`.

Di awal session, jalankan `/lanjut` sebelum mengerjakan apa pun.
