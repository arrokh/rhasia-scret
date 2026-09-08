# Local Profile and Local Vault semantics

- **Status:** Accepted
- **Date:** 2026-07-29
- **Related:** ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0012, ADR-0016, ADR-0018, ADR-0020, ADR-0021, ADR-0022, ADR-0025, ADR-0033, ADR-0035

## Decision

A browser installation may own at most one client-only **Local Profile**. A Local Profile owns exactly one writable **Local Vault**. Neither record requires a Supabase session, an Application User, an API request, or a network connection. The Local Profile and Local Vault are independent from every server Personal Vault, Shared Vault, Application User, Local Vault Snapshot, and Remembered Browser. This ADR defines the web-only writable local capability; the native client currently uses hosted Vaults and read-only encrypted Local Vault Snapshots instead.

The browser installation is the security and lifecycle scope. The application does not identify a Local Profile by email, Supabase subject, Application User identifier, device account, or any server-provided value. It may store an opaque random profile identifier only to address its own encrypted records. An Expo installation is not a second implementation of this writable Local Profile contract.

A Local Vault is a writable client-owned source of Authenticator Accounts. A Local Vault Snapshot remains the existing read-only encrypted copy of a previously synchronized server Vault described by ADR-0016; the two types must never share an identity, write path, synchronization state, or deletion operation.

## Local key hierarchy and encrypted storage

Local creation generates all secret material with browser Web Crypto. The approved hierarchy is:

1. The user chooses or the browser generates a **Local Vault Passphrase**. It is separate from authentication and from the server-backed Vault Unlock Secret. The passphrase is never sent to a server, written to a URL, logged, placed in a cache, or stored in Query state.
2. The browser generates a random 32-byte Local Root Key and a random per-profile KDF salt. Argon2id derives a non-extractable Local Unlock Key from the passphrase and salt using the calibrated parameters in ADR-0006. A generated passphrase is recommended; a custom passphrase follows the current minimum and acknowledgement rules for client-only vault passphrases.
3. The Local Unlock Key encrypts a versioned Local Root Key envelope. The Local Root Key protects a random 32-byte Local Vault Encryption Key in a second versioned envelope. Account payloads and the normalized encrypted Local Vault record are encrypted under the Local Vault Encryption Key. Key material is never reused as an account secret, archive key, or server Vault Encryption Key.
4. The persisted record contains only a schema/envelope version, opaque profile identifier, KDF parameters and salt, authenticated ciphertext/envelopes, bounded lifecycle timestamps, and other explicitly permitted non-secret local lifecycle metadata. It contains no Vault Name, account label or issuer, TOTP configuration, secret, raw QR data, OTP, passphrase, plaintext key, secret fingerprint, or server identity.

AES-256-GCM uses fresh random 12-byte nonces for every envelope and authenticated encryption. Envelope parsing is strict and versioned. The context-binding migration in ADR-0038 will introduce the next authenticated envelope version; this ADR does not permit silently falling back to unauthenticated or context-free decryption.

The local archive path uses the versioned Encrypted Vault Archive contract in ADR-0033. Export creates a separate random archive key in browser memory and releases it only as an explicit user download. Import requires user-supplied archive key material, validates and previews content entirely in browser memory, and atomically writes newly encrypted Local Vault records. Plaintext backup and server-mediated local backup are not supported. Archive compatibility is format compatibility, not identity or synchronization: an archive never links a Local Profile to a server Vault.

## Lifecycle and capability boundaries

- **Create:** An unauthenticated person may create the one Local Profile and Local Vault offline. Creation fails if one already exists; the second profile requires explicit, confirmed destruction of the existing profile first.
- **Discover:** Public and authenticated screens may reveal only that this browser has a Local Profile/Local Vault and may show generic locked wording. Encrypted labels and account existence details are not rendered before local unlock.
- **Unlock and use:** The user explicitly unlocks the Local Vault with the Local Vault Passphrase. Only after successful local decryption may the client show the decrypted Local Vault Name and account list, generate OTPs, copy OTPs, import supported QR/manual TOTP data, edit accounts, or delete accounts. HOTP and unsupported proprietary formats remain rejected under the existing TOTP Configuration contract.
- **Transfer:** Local/server movement is explicit copying only. There is no automatic synchronization, account linking, background upload, merge, deletion propagation, or shared identity. Signing in may make an explicit copy action available, but cannot inspect, unlock, upload, replace, or delete local content silently. Shared Vault copying is separately governed by issue #72 and is not enabled by this decision.
- **Lock:** Explicit lock, logout cleanup, component teardown, failed unlock, and destructive reset release decrypted account data and clearable key/secret buffers as far as JavaScript permits. Lock does not delete encrypted local records.
- **Logout:** Server logout clears server session material, unlocked server workspaces, server-derived Local Vault Snapshots, and Remembered Browser/session material according to their existing ADRs. It preserves the independent encrypted Local Profile unless the user separately chooses to clear it.
- **Server-profile clearing:** Clearing or resetting a server Application User or Personal Vault never mutates the Local Profile or Local Vault. Local Profile clearing never mutates a server Vault, membership, audit history, or server account.
- **Clear:** Local Profile destruction is immediate, irreversible, separately scoped, and explicitly confirmed. It atomically removes the Local Vault ciphertext, local unlock packages, encrypted archive-related local metadata, and application-owned local records. It does not claim to erase plaintext already learned by another browser, an extension, a backup, or a person. There is no recovery window because the local key path is destroyed.
- **Storage/device loss:** Browser storage eviction, profile deletion, private-mode teardown, device loss, or full device clearing destroys the only persisted local key path and makes the Local Vault unrecoverable unless the user previously exported a valid encrypted archive and retained its separate key. The application must fail closed and must not recreate or overwrite a missing profile automatically.

A Local Vault is writable while offline and never displays synchronization progress. A Local Vault Snapshot is read-only, cannot queue or replay mutations, and is only replaced after a server authorization check, response validation, client decryption, and atomic persistence all succeed. A Local Profile may coexist with a signed-in server profile, but no provider or server identifier is persisted with it.

## Browser failure behavior

The local implementation requires IndexedDB, secure-context Web Crypto, authenticated encryption, and the supported browser capabilities in ADR-0018. If IndexedDB is unavailable or blocked, a schema upgrade is blocked, quota is exhausted, storage is evicted, cryptography is unavailable, ciphertext is malformed, or a write is interrupted, the client fails closed. It retains the last valid record where possible, never replaces it with a partial record, does not expose a decrypted fallback, and presents an actionable localized error. A new profile is not created as a recovery shortcut.

## Threat analysis

- **XSS and malicious extensions:** A Local Vault protects persisted records at rest, but code running in the origin or a privileged extension can observe passphrases, plaintext, OTPs, or keys while they are in use. CSP, escaping, dependency controls, and redacted telemetry reduce exposure but do not change this limitation.
- **Shared OS/browser profiles:** Anyone who can use the same browser profile may discover the local record and attempt the passphrase; the product must warn that a Local Profile is scoped to the browser profile, not a person, and must not associate it with whichever server user is signed in.
- **Stolen devices:** At-rest encryption protects records without the passphrase, subject to offline guessing resistance and device/extension compromise. A user must clear the Local Profile and rotate affected service credentials when compromise is suspected.
- **IndexedDB rollback and replay:** Records carry strict versions and monotonic lifecycle metadata where applicable. Rollback can restore an older encrypted state but cannot authenticate it as newer; the client must reject malformed or incompatible records and never treat rollback as server synchronization.
- **Storage eviction and backup leakage:** Browser eviction is unrecoverable without a user-held encrypted archive. Operating-system/browser backups may copy ciphertext and permitted metadata; archive keys and passphrases remain the user's responsibility. Plaintext is never intentionally placed in backup-eligible browser stores.
- **Hosted-client limitation:** Zero-knowledge protections cover stored ciphertext, ordinary server access, logs, backups, and infrastructure operators. A hosted web application cannot protect opened secrets from an actively malicious host that serves altered JavaScript. Stronger delivery integrity requires a separately approved signed-client architecture.

## Product terminology

Use these exact concepts before implementing user-facing behavior:

| Concept | English | Indonesian |
| --- | --- | --- |
| Device-scoped client-owned container | Local Profile | Profil Lokal |
| Writable device-only encrypted source | Local Vault | Brankas Lokal |
| Client-only unlock secret | Local Vault Passphrase | Passphrase Brankas Lokal |
| Previously synchronized read-only copy | Local Vault Snapshot | Snapshot Brankas Lokal |
| Destructive local lifecycle action | Clear Local Profile | Hapus Profil Lokal |

“Local Vault” must not be translated as Personal Vault, Shared Vault, or a server-derived snapshot. “Local Vault Passphrase” must not be called a PIN, authentication credential, Vault Unlock Secret, or recovery secret.

## Consequences

The product has an explicit local-only data boundary and can support offline creation and use without weakening server authorization or zero-knowledge assumptions. Local data is intentionally not recoverable through logout, sign-in, the server, or provider migration. Issue #71 may implement the writable path against this contract; issue #72 may add explicit copy workflows; issue #73 may expose the capability and synchronization distinctions without converting local data into synchronized data.
