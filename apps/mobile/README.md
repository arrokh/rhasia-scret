# rhasia-scret mobile

Expo/React Native client for iOS and Android. This project is the native composition layer for the platform-neutral application ports introduced by issue #95.

## Configure

Copy `.env.example` to `.env.local` and set only public client values. Never add a Supabase service-role key, OIDC client secret, Vault material, OTP, archive key, or Secure Share Link fragment to Expo environment variables.

Production authentication callbacks use the verified universal/app link `${EXPO_PUBLIC_WEB_ORIGIN}/auth/mobile`, where `EXPO_PUBLIC_WEB_ORIGIN` is the deployed HTTPS web origin. Development builds may use `rhasia-scret://auth/callback`. Configure the same redirect in Supabase Auth. The iOS Associated Domain and Android verified App Link also accept `/vaults/invitations/redeem`; the fragment remains client-only.

## Run and verify

```bash
pnpm --dir apps/mobile ios
pnpm --dir apps/mobile android
pnpm --dir apps/mobile verify
mise exec -- pnpm --dir apps/mobile run build:android-native
mise exec -- pnpm --dir apps/mobile run build:ios-simulator
```

`verify` runs lint, strict TypeScript, Jest, Expo Doctor, and production JavaScript exports for iOS and Android. The native build commands regenerate ignored native projects and compile Android Release and iOS Release-simulator artifacts; Android uses the mise-managed Java 21 toolchain. Native store/archive/camera/crypto flows are added as issue #96 vertical slices; do not substitute browser IndexedDB, cookies, service workers, DOM APIs, or web-only WebAuthn assumptions.

## Security boundary

- Supabase refresh/access sessions are persisted only through `expo-secure-store` (iOS Keychain or Android Keystore-backed encrypted storage).
- Authenticated application requests add the access token only in the transport adapter. Tokens never enter TanStack Query, logs, analytics, URLs created by the app, or application workflow state.
- Incoming links are accepted only from the registered custom scheme or verified production host and recognized paths.
- Plaintext TOTP configuration, OTPs, Vault keys/passphrases, raw QR data, archive keys, Secure Share Link material, private keys, and decrypted Vault content remain client-only.
- AES-GCM, HMAC, and P-256 operations use pinned Noble primitives against shared web/native vectors. The owned Expo module in `modules/native-argon2id` runs Argon2id off the JavaScript thread and supplies platform secure randomness; its upstream wrapper and Argon2 licenses are retained with the source.
- Authorized encrypted Vault snapshots receive a second context-authenticated encryption layer in `expo-file-system`; its random key remains in Keychain/Android Keystore through `expo-secure-store`. Offline snapshots expose local TOTP generation and explicit `expo-clipboard` copy but no mutations, queue, replay, merge, upload, or deletion propagation.
- Authenticator Account URI import parses and encrypts on-device, sends only the existing encrypted payload contract, and refreshes the encrypted snapshot after confirmed server persistence.
- App lifecycle changes stop background token refresh. Later unlocked-Vault slices must additionally clear in-memory key material whenever the app leaves the active state.
