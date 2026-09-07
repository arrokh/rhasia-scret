# Issue #96 final validation evidence

Captured 2026-08-12 on branch `mobile/feature/native-foundation`.

## Quality gates

- `pnpm run test:full`: PASS — 149 test files / 465 tests; 90 browser smoke, 13 real-stack tests passed (2 skipped), 5 PWA tests passed (4 skipped).
- Mobile verification: PASS — 21 Jest suites / 70 tests, strict TypeScript, lint, Expo Doctor 20/20, iOS and Android release JS bundles, dependency architecture (557 modules / 1,869 dependencies).
- Final product native builds: PASS — Android release APK 96,938,698 bytes; iOS Release-simulator executable 3,392,312 bytes.
- Android 16 KiB compatibility: PASS — `zipalign -c -P 16 -v 4` reports `Verification successful`.

## Native and emulator evidence

- Android ARM64 emulator: APK installed/launched; custom scheme and app-link intent filters inspected; Indonesian and English sign-in screenshots captured.
- Android native Argon2id instrumentation: PASS — shared protocol vector and secure-random checks execute through JNI on the emulator.
- iOS simulator: Release product installed/launched; Indonesian sign-in rendered; custom scheme configuration inspected.
- iOS native validation build: PASS — opt-in diagnostic rendered `LULUS / PASSED` after executing the shared 64 MiB Argon2id vector and native secure-random check.
- Lifecycle locking: automated mobile test verifies backgrounding clears key material and returns to the lock ceremony.

## Acceptance-criterion mapping

1. Maintained strict-TypeScript React Native app, Indonesian/English copy, secure storage boundaries: implemented; mobile tests, architecture checks, and screenshots above.
2. Auth/session/bearer/deep links: implemented and emulator/simulator custom-link evidence captured. Production verified-link deployment remains external.
3. Personal Vault, encrypted persistence, accounts, offline TOTP/copy: implemented with mobile unit/presentation coverage.
4. Native crypto interoperability: shared protocol vectors plus Android JNI and iOS simulator validation passed.
5. Read-only offline snapshots/no queued mutation: implemented and covered by mobile/browser tests.
6. QR, clipboard, archives, native sharing: implemented and covered by mobile tests and browser protocol tests.
7. Shared Vault permissions, invitations, Secure Share Links, audits, archive, recovery boundaries: implemented and covered by mobile/browser tests.
8. Device-bound unlock/recovery: intentionally not declared shipped; requires real iOS and Android hardware validation and an approved native design if PRF parity differs.
9. Automated unit/integration/device-or-emulator coverage: unit, integration/browser, Android emulator, and iOS simulator evidence present; physical devices unavailable.
10. Existing web gate and mobile release gate: both pass as recorded above.

## External blockers

- `adb devices` currently reports no physical Android device.
- `xcrun xctrace list devices` reports only the host Mac and iOS simulators; no physical iOS device.
- Production `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association` returned HTTP 404 when captured; the raw command output is intentionally not retained in source control.
- Therefore issue #96 must remain open/incomplete: hardware-gated device-bound recovery and production verified-link deployment are not evidenced.
