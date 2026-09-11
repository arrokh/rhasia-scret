# Mobile release configuration

The Expo SDK 57 React Native client uses the stable identifiers `com.arrokh.rhasiascret` on iOS and Android. Its HTTPS web-link host is configured through `EXPO_PUBLIC_WEB_ORIGIN` and must match the deployed web origin. The release target covers hosted Personal Vault use, partial Shared Vault access/invitation implementations, and read-only encrypted offline snapshots. Full native Shared Vault management and the remaining native Authenticator Account lifecycle/TOTP UX are tracked in [#183](https://github.com/arrokh/rhasia-scret/issues/183) and [#184](https://github.com/arrokh/rhasia-scret/issues/184); browser Local Profile/Local Vault and native WebAuthn PRF-equivalent recovery are outside this target.

## Verified links

Configure these server environment values before validating a signed release:

- `MOBILE_APPLE_TEAM_ID`: the 10-character Apple Developer Team ID used to sign the iOS app.
- `MOBILE_ANDROID_CERT_SHA256`: one or more uppercase colon-delimited SHA-256 fingerprints for the Android App Signing certificates, comma-separated during certificate rotation.

The server then publishes:

- `/.well-known/apple-app-site-association`
- `/.well-known/assetlinks.json`

Both endpoints fail with `503 mobile_app_links_not_configured` rather than publishing placeholder trust data. Client intent filters are limited to `/auth/mobile` and `/vaults/invitations/redeem`.

Add `${EXPO_PUBLIC_WEB_ORIGIN}/auth/mobile` to the Supabase Auth redirect allowlist. Development builds may additionally allow `rhasia-scret://auth/callback`; do not use the custom scheme as production proof of verified links. Mobile sign-in requests surface a localized failure after 15 seconds rather than leaving the form indefinitely busy when native connectivity or TLS is stalled.

## Native cryptography validation build

Set `EXPO_PUBLIC_NATIVE_CRYPTO_VALIDATION=1` only for a locally installed validation build. That build replaces product presentation with a bilingual diagnostic that executes the shared synthetic 64 MiB Argon2id vector and platform secure-random check through the real Expo native module. It contains no production secret and performs no API request. Omit the value or set it to `0` for every distributed product build. Record a passing screen on iOS. On Android, `pnpm --dir apps/mobile run test:android-native` executes the same shared vector directly through JNI on a connected emulator/device and verifies platform secure randomness. Rebuild the normal product artifacts after validation.

## Required release evidence

Before device-link validation, run the repository mobile verification plus native compilation from the mise-managed toolchain:

```bash
pnpm --dir apps/mobile run verify
mise exec -- pnpm --dir apps/mobile run build:android-native
mise exec -- pnpm --dir apps/mobile run build:ios-simulator
```

The Android instrumentation test is additional native-module evidence, not part of `pnpm run test:full`:

```bash
mise exec -- pnpm --dir apps/mobile run test:android-native
```

1. Install an iOS build signed by the configured Apple team and an Android build signed through the configured Play App Signing certificate.
2. Verify each association endpoint over HTTPS without redirects and with the matching application identifier/certificate.
3. Open a real authentication link and Secure Share Link on each device from outside the application; verify the OS opens rhasia-scret directly without a chooser or browser fallback.
4. Confirm a malformed host, HTTP URL, unapproved path, and wrong signing certificate do not open the app.
5. Record no token, code, Secure Share Link fragment, Vault material, OTP, or decrypted content in device or server logs.

Apple Team ID, production Android certificate fingerprint, Supabase redirect-allowlist access, and signed-device validation are release credentials/evidence and are not committed to the repository.
