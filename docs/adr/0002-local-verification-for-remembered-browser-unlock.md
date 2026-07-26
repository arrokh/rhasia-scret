# Local verification for remembered-browser unlock

## Status

Accepted

## Context

A Remembered Browser must unlock a Local Vault Snapshot without sending the Vault Unlock Secret or User Root Key to the server. A successful generic WebAuthn assertion plus a stored credential identifier is not a cryptographic key-release mechanism: an independently usable local key behind that UI gate would remain recoverable without WebAuthn.

Passkey-Assisted Recovery and Passkey-Assisted Unlock are separate, server-mediated protocols. They verify an assertion on the server and retrieve an opaque recovery package, and therefore do not work offline.

The supported browser baseline includes current and previous Chrome, Edge, Firefox, and Safari releases, but WebAuthn PRF support varies by browser, platform, authenticator, and credential synchronization provider.

## Decision

Remembered Browser enrollment is explicit and is offered only from an authenticated, online Unlocked Vault Session. The browser creates a dedicated WebAuthn credential with required user verification and evaluates the WebAuthn PRF extension with a random 32-byte salt. It uses the PRF output only as key material to encrypt a copy of the in-memory User Root Key. Generic assertion success never releases a key.

The browser stores one versioned local envelope per opaque application profile in application-owned IndexedDB:

- envelope version;
- opaque profile identifier;
- RP ID and exact origin used at enrollment;
- WebAuthn credential identifier;
- PRF salt inside the encrypted key package;
- an authenticated-encryption package containing the User Root Key, wrapped by key material derived from the PRF output; and
- non-sensitive enrollment timestamp.

The package contains no plaintext identity, User Root Key, Vault Encryption Key, Vault Unlock Secret, private encryption key, Vault/account label, TOTP configuration, or OTP. It remains separate from Local Vault Snapshot records and from server-held Passkey-Assisted Recovery metadata.

Offline unlock validates the envelope version, profile binding, exact origin, and RP ID, then asks the stored credential to evaluate the stored PRF salt with required user verification. Only the resulting PRF output can authenticate and decrypt the User Root Key package. The browser then opens the validated Local Vault Snapshot in memory. Temporary PRF output, wrapping keys, and replaceable package buffers are cleared after use where JavaScript permits.

Enrollment replacement writes a complete new envelope atomically for that profile. Removal deletes the profile's local envelope and credential metadata; WebAuthn does not provide a portable API to delete the authenticator's credential itself. Successful logout, destructive reset, explicit device-data removal, and full offline-data cleanup delete all application-owned Remembered Browser envelopes and Local Vault Snapshots.

The exact origin and RP ID are enforced by both the stored envelope validation and the browser's WebAuthn origin/RP policy. Private browsing and embedded webviews remain unsupported. No local package is uploaded, and no server endpoint participates in offline Local Verification.

If WebAuthn, user verification, PRF evaluation, IndexedDB, origin validation, envelope authentication, or credential access is absent or fails, unlock fails closed and the UI falls back to the Vault Unlock Secret. Firefox, Safari, or any authenticator without usable PRF remains supported through that fallback; the application must not claim Remembered Browser capability from generic WebAuthn support alone.

## Consequences

An attacker who copies IndexedDB ciphertext cannot recover the User Root Key without the enrolled credential's PRF output and user verification. The browser profile can still be removed locally, and losing the dedicated credential does not change or remove the Vault Unlock Secret. Offline Remembered Browser support is capability-dependent while read-only offline access through the Vault Unlock Secret remains the cross-browser baseline.
