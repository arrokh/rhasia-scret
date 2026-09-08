# Pengungkapan privasi dan layanan yang di-host

**Diterbitkan:** 2026-09-08

Dokumen ini menjelaskan batas data rhasia-scret serta tanggung jawab pengelola
demo hosted, operator self-hosting, dan penyedia eksternal. Ini adalah
pengungkapan produk, bukan janji bahwa penyedia tidak menyimpan log
operasional. Kebijakan privasi penyedia dan konfigurasi deployment operator
mengatur penyimpanan di luar aplikasi.

## Data yang ditangani aplikasi

rhasia-scret memiliki dua jalur yang berbeda:

- Local Profile dan Local Vault dimiliki oleh browser. Data terenkripsi, label
  akun, konfigurasi TOTP, rahasia, dan OTP tidak dikirim ke server
  rhasia-scret.
- Personal Vault dan Shared Vault hosted mengirim payload terenkripsi serta
  metadata yang diizinkan untuk otorisasi, sinkronisasi, siklus hidup, audit,
  pembatasan laju, dan operasi. Browser atau aplikasi native yang berwenang
  membuka konten Vault dan membuat OTP.

Aplikasi dapat menangani identitas akun dan data operasional seperti alamat
  email dari penyedia autentikasi, ID Application User yang buram, ID Vault
  dan akun buram, hubungan keanggotaan dan undangan, revisi, versi protokol,
  tenggat penghapusan, aktor audit yang direduksi, status pembatasan laju,
  waktu permintaan, dan ukuran ciphertext yang dibatasi. Provider dan
  deployment menentukan metadata jaringan atau operasi tambahan yang dicatat
  di luar aplikasi.

## Data yang tidak boleh diterima server

Kontrak zero-knowledge tidak mengizinkan Vault Name, issuer/nama akun,
konfigurasi TOTP plaintext, OTP, data QR mentah, Vault Encryption Key, User
Root Key, Vault Unlock Secret, kunci privat enkripsi, kunci arsip, materi
Secure Share Link, atau konten Vault terdekripsi disimpan di server, log,
analitik, atau cache bersama. Ukuran ciphertext, waktu, otorisasi, dan
metadata siklus hidup tidak disembunyikan oleh model ini.

## Provider dan batas tanggung jawab

| Provider atau komponen | Data yang mungkin ditangani | Batas tanggung jawab |
| --- | --- | --- |
| Supabase Auth atau provider autentikasi OIDC | Email atau subject provider, peristiwa autentikasi, materi sesi, dan metadata provider untuk memverifikasi principal | Provider mengautentikasi pengguna. Provider tidak menerima plaintext Vault dari aplikasi ini. Atur retensi, kontrol akses, dan pemberitahuan privasinya sendiri. |
| Pengiriman email provider autentikasi | Alamat penerima, metadata tautan masuk/verifikasi, serta data pengiriman dan bounce | Provider mengendalikan log dan retensi pengiriman. Aplikasi tidak menerima rahasia email. |
| Host Vercel referensi, CDN, atau reverse proxy self-hosted | Request, metadata IP/jaringan, header, waktu, log deployment dan error, serta trafik API terenkripsi | Pengelola demo hosted atau operator self-hosting mengendalikan konfigurasi host, akses dan retensi log, TLS, serta pengelolaan secret. |
| Provider PostgreSQL | Konten terenkripsi, ID buram, metadata yang diizinkan, serta log koneksi/operasi database | Database harus tetap diakses melalui Prisma di server. Jangan mengaktifkan akses Supabase Data API/RLS dari browser. Operator bertanggung jawab atas backup, restore, purge, dan akses database. |
| Analitik browser PostHog (opsional) | Event produk agregat yang diizinkan, path statis yang direduksi, web vitals terbatas, dan ID browser dari hash SHA-256 | Nonaktif kecuali `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` dan `NEXT_PUBLIC_POSTHOG_HOST` diisi. Sanitizer menghapus konten Vault, label, email, URL dengan query/fragment, teks DOM, dan properti yang tidak diizinkan. |
| Cloudflare Web Analytics (opsional) | Data beacon analitik web sesuai provider untuk deployment yang dikonfigurasi | Nonaktif kecuali `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN` diisi. Operator harus meninjau konfigurasi dan ketentuan provider sebelum mengaktifkannya. |

Aplikasi native saat ini tidak memiliki integrasi analitik. Operator self-hosting
tidak boleh menambahkan SDK provider, penerusan event server, atau telemetri
khusus tanpa tinjauan privasi dan keamanan terpisah.

## Retensi, penghapusan, dan batas pemulihan

- Authenticator Account yang dihapus sementara dapat dihapus permanen setelah
  30 hari.
- Shared Vault yang dihapus dan konten terenkripsinya dapat dihapus permanen
  setelah 30 hari. Pemulihan hanya tersedia selama periode tersebut.
- Vault Audit History yang direduksi disimpan selama satu tahun kalender
  setelah Vault dihapus. Pemulihan menghapus jadwal purge audit; penghapusan
  berikutnya memulai periode baru.
- Purge terjadwal dibatasi dan idempoten. Purge tidak membuka atau mencatat
  konten terenkripsi; lihat [`retention-purge-operations.md`](retention-purge-operations.md).
- Destructive Personal Vault Reset menghapus ciphertext dan materi kunci yang
  tidak dapat digunakan ketika pengguna tidak dapat membukanya. Ini bukan
  pemulihan, dan rahasia atau plaintext yang sudah diperoleh client lain tidak
  dapat dihapus dari jarak jauh.
- Provider autentikasi, host/CDN, provider email, provider analitik, sistem
  operasi, backup client, dan backup database self-hosted dapat memiliki
  retensi terpisah sesuai operator dan ketentuannya.

## Default analitik dan tinjauan operator

Analitik default-nya nonaktif. Jika diaktifkan dengan sengaja, PostHog
menggunakan kontrak yang diizinkan dalam [`analytics-events.md`](analytics-events.md),
dan kebijakan browser dalam [ADR-0044](adr/0044-privacy-safe-browser-analytics.md)
adalah pertahanan tambahan, bukan pengganti tinjauan provider. Operator harus:

1. menggunakan project staging dan production yang terpisah jika memungkinkan;
2. menjalankan smoke flow sintetis tanpa konten Vault, label, alamat, rahasia,
   data QR, atau OTP nyata;
3. memeriksa payload setelah deployment; dan
4. menonaktifkan integrasi serta memperbarui tes sanitizer jika muncul properti
   yang tidak diharapkan.

## Demo hosted versus self-hosting

Untuk demo hosted, organisasi yang mengoperasikan web application bertanggung
jawab atas keputusan controller/operator untuk autentikasi, hosting, database,
email, analitik, dukungan, dan penghapusan. Repository rhasia-scret
mendokumentasikan batas aplikasi, tetapi tidak menjadikan maintainer repository
sebagai controller untuk deployment yang dioperasikan secara mandiri.

Untuk deployment self-hosted, operator deployment bertanggung jawab sebagai
controller/operator, kontrak provider, pemberitahuan pengguna, origin TLS dan
callback, akses ke log dan backup, permintaan penghapusan, penjadwalan purge,
respons insiden, dan analitik yang diaktifkan. Ikuti
[panduan self-hosting](self-hosting.md) dan jangan menganggap tes repository
sebagai bukti production.

## Permintaan pengguna dan kontak

Pengguna harus menghubungi operator deployment yang digunakan untuk pertanyaan
akun, penghapusan, provider, atau demo hosted. Jalur dukungan project,
permintaan dokumentasi, dan pelaporan kerentanan tercantum dalam
[`support.md`](support.md), [`SECURITY.md`](../SECURITY.md), dan [intake issue
publik](https://github.com/arrokh/rhasia-scret/issues/new/choose). Jangan
menaruh materi Vault, tautan autentikasi, cookie, token, atau
secret provider di issue publik.

Dokumen bahasa Inggris adalah [`privacy.md`](privacy.md). Perubahan pada copy
privasi yang terlihat pengguna harus memperbarui kedua dokumen dan katalog
pesan web secara bersamaan.
