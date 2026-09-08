# Dukungan project

## Pilih jalur yang tepat

- **Panduan dan self-hosting:** mulai dari [indeks dokumentasi](README.md) dan
  [panduan self-hosting](self-hosting.md). Operator self-hosted bertanggung
  jawab atas provider, deployment, database, backup, dan dukungan retensinya.
- **Bug yang dapat direproduksi:** gunakan [template laporan bug](../.github/ISSUE_TEMPLATE/bug_report.yml).
  Sertakan commit atau release, browser atau platform native, dan langkah
  reproduksi sintetis. Jangan sertakan konten Vault atau credential.
- **Permintaan fitur atau dokumentasi:** gunakan template publik yang sesuai.
  Fokuskan usulan pada perilaku produk, dokumentasi, atau pemeliharaan.
- **Kerentanan keamanan:** jangan membuka issue publik. Gunakan [formulir
  GitHub Security Advisory privat](https://github.com/arrokh/rhasia-scret/security/advisories/new)
  dan ikuti [`SECURITY.md`](../SECURITY.md).
- **Akun demo hosted atau permintaan penghapusan:** hubungi operator
  deployment. Maintainer repository tidak dapat memeriksa database operator
  self-hosted atau memulihkan konten Vault.

## Laporan dukungan yang aman

Laporan boleh berisi kode error yang direduksi, timestamp, nama route,
identifier release/commit, dan ID sintetis. Jangan pernah menyertakan password,
passphrase, OTP, secret TOTP, data QR, fragment Secure Share Link, cookie,
authorization header, token provider, URL database, kunci arsip, atau konten
Vault terdekripsi. Redaksi screenshot sebelum mengunggahnya.

## Triage dan eskalasi

Maintainer memberi label bug, fitur, dokumentasi, keamanan, atau pertanyaan;
mereproduksinya dengan data sintetis; dan menautkan ADR atau issue yang
relevan. Laporan keamanan mengikuti proses embargo dan pengungkapan dalam
[`SECURITY.md`](../SECURITY.md). Perubahan yang memblokir release dieskalasikan
ke maintainer sebelum deployment atau merge.

Companion bahasa Inggris adalah [`support.md`](support.md).
