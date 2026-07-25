# Passkey-assisted recovery protocol

Passkey recovery is an optional second browser-held recovery path for the User Root Key. It is not a server recovery key and does not replace the Vault Unlock Secret.

At enrollment, the browser creates a random Recovery Wrapping Key, encrypts the User Root Key under it, and encrypts that Recovery Wrapping Key under a WebAuthn PRF output. The service stores only the passkey credential public metadata and the resulting encrypted recovery package. It cannot derive the PRF output, Recovery Wrapping Key, User Root Key, Vault Encryption Key, private key, account data, or OTP.

The relying-party identifier and origin are explicit deployment configuration. Enrollment and recovery fail closed if they are missing or the browser lacks the WebAuthn PRF extension. The server must generate one-time challenges, verify WebAuthn registration/assertion responses, enforce monotonic counters where applicable, and delete recovery material when a credential is removed. There is no browser-only mock/fallback for passkey recovery.

After a verified assertion, the browser evaluates its PRF extension, opens the encrypted recovery package locally, and re-wraps the recovered User Root Key under a new Vault Unlock Secret. The server sees only assertion data and opaque encrypted recovery material.
