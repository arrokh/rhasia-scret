# Offline PWA verification

This checklist covers the web PWA only. Native offline snapshot storage and AppState lock behavior are verified through `apps/mobile` tests and the release checks in [`mobile-release-configuration.md`](mobile-release-configuration.md).

## Automated baseline

Run the production service-worker suite and all supported Playwright engines with:

```sh
pnpm run test:browser
```

The PWA suite builds and starts the production application separately from the development browser tests. It verifies the configured manifest, public-shell navigation fallback, static-cache allowlist, API/auth cache denial, offline reload, and preservation of IndexedDB during service-worker activation.

## Real-device WebAuthn checks

WebAuthn PRF availability depends on the browser, OS, authenticator, and credential provider. Before a production release, repeat this checklist on current and previous Chrome, Edge, Firefox, and Safari releases, including Safari on a physical supported Apple device:

1. Sign in online, unlock with the Vault Unlock Secret, and complete one full synchronization.
2. Enroll **Browser yang Diingat** and complete Local Verification.
3. Disable all network access, open `/offline`, select the anonymous local profile, and unlock with Local Verification.
4. Confirm Personal, Owner Shared, and Viewer Shared OTP generation and copying remain usable.
5. Lock explicitly and confirm OTPs disappear; unlock again with the Vault Unlock Secret.
6. Remove Browser yang Diingat and confirm Local Verification no longer unlocks the snapshot.
7. When PRF is unavailable or fails, confirm the UI fails closed and offers the Vault Unlock Secret without storing an assertion-only key package.
8. Log out or remove device data and confirm application-owned snapshot and Remembered Browser IndexedDB records are gone.

Firefox or Safari without usable PRF is conformant when the Vault Unlock Secret path works and the Remembered Browser path fails closed. A generic successful WebAuthn assertion is never sufficient.

## Storage inspection

Use deterministic non-production fixtures. Inspect Cache Storage and the `rhasia-scret-offline-vault` IndexedDB database and confirm they contain no plaintext Vault/account names, TOTP secrets, OTP values, raw QR or `otpauth` data, User Root Keys, Vault Encryption Keys, Vault Unlock Secrets, or decrypted private keys. Cache Storage may contain only `/offline`, manifest/icon resources, and same-origin versioned `/_next/static/` resources.

Revocation cannot erase ciphertext or secrets already obtained while a member was offline. A revoked or deleted Vault is removed locally only after the next successful authenticated complete synchronization; authentication, network, or validation failure retains the last valid stale read-only bundle.
