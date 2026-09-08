# Mobile / Expo agent guide

## Platform and documentation

- This directory is the Expo SDK 57 React Native application for iOS and Android. Read the exact versioned Expo documentation at <https://docs.expo.dev/versions/v57.0.0/> before changing mobile code or native configuration.
- Keep native composition, React Native presentation, Expo modules, native adapters, and mobile-only tests under `apps/mobile`. Do not import `apps/web`, Next.js, DOM APIs, browser storage, service workers, or web-only WebAuthn assumptions.
- Platform-neutral client workflows and protocol contracts belong in `packages/client-vault-core` and are consumed through its public entry point. Do not reach into package internals or duplicate shared authorization, ciphertext, Secure Share Link, archive, or workspace-lifecycle semantics in the mobile app.

## Security boundaries

- The mobile client supports hosted Personal and Shared Vault workflows plus read-only encrypted offline snapshots. It does not implement the browser-only Local Profile/Local Vault.
- Keep plaintext TOTP configuration, raw QR data, generated OTPs, Vault keys, Vault Passphrases, archive keys, Secure Share Link material, private keys, and decrypted content in client memory only. Never place them in Expo public configuration, logs, analytics, TanStack Query, or persisted application state. A Secure Share Link fragment is a transient delivery input only; consume it in memory and never persist or log it.
- Persist Supabase sessions only through `expo-secure-store`. Add bearer credentials only in the native authenticated transport; presentation and application workflows must not handle access tokens.
- Store native offline snapshots as authenticated encrypted data. Keep the random storage key in Keychain/Android Keystore through `expo-secure-store`, and atomically replace the encrypted document through `expo-file-system`. Offline workspaces are read-only: no mutation queue, replay, merge, upload, or deletion propagation.
- Native device-bound Passkey-Assisted Recovery and Remembered Browser equivalence are unsupported until real-device capability is validated and a separate design is approved. Do not imply that Expo biometric or generic native authentication is WebAuthn PRF.

## Application and presentation

- Use TanStack Form for interactive native forms, including field validation, submission state, and accessible error associations. Keep unlock, decryption, OTP generation, archive opening, and Secure Share Link workflows outside server-state caches.
- Keep application API calls and secure-storage access in mobile infrastructure adapters. The composition/session adapter may coordinate the Supabase Auth SDK and native lifecycle; presentation screens must not call `fetch` or provider SDKs directly.
- Request camera permission only after an explicit QR-scan action. Parse and encrypt `otpauth://totp` input on-device before transport. Native clipboard and share/document-picker effects remain platform adapters.
- AppState transitions must use the shared `WorkspaceLifecycle` policy. Leaving the active state locks the workspace and clears key material; do not add a second presentation-owned lifecycle policy.
- Keep Indonesian (`id`) and English (`en`) message keys exactly aligned in `src/localization.ts`; Indonesian is the deterministic initial locale. Never put user-provided Vault/account labels or secrets in the catalog.

## Validation

- Use the mise-managed Node.js 24.19.0 and pnpm 11.17.0 toolchain. `pnpm run verify` runs lint, strict TypeScript, Jest, Expo Doctor, and iOS/Android JavaScript exports.
- `pnpm run test:full` includes the mobile `verify` path but does not compile native release projects or prove physical-device behavior. For release evidence, run `mise exec -- pnpm --dir apps/mobile run build:android-native`, `mise exec -- pnpm --dir apps/mobile run build:ios-simulator`, and the Android native instrumentation test when available.
- Keep native cryptography licenses beside `modules/native-argon2id`, retain the SDK patch only while required, and never enable `EXPO_PUBLIC_NATIVE_CRYPTO_VALIDATION=1` in a distributed product build.
