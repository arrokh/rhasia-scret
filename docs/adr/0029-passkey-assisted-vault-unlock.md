# Passkey-assisted Vault unlock

## Status

Accepted

## Context

Passkey-Assisted Recovery already gives an enrolled WebAuthn PRF credential the cryptographic capability to recover the User Root Key in the browser. The recovery flow previously required the user to set a new Vault Unlock Secret and re-wrap that key before returning to the Vault. Users also need a convenient alternative to entering the Vault Unlock Secret during ordinary unlock.

Calling this a second factor would be inaccurate: the passkey is an alternative local unlock path after application authentication, not an additional factor combined with the Vault Unlock Secret.

## Decision

An enrolled user may start an Unlocked Vault Session with **Passkey-Assisted Unlock**. The browser requests server-generated authentication options, obtains and verifies a WebAuthn assertion, evaluates the PRF extension, opens the existing encrypted recovery package locally, and uses the recovered User Root Key to decrypt the Personal Vault Encryption Key and accessible Shared Vault keys.

Passkey-Assisted Unlock:

- is offered only when persisted enrollment state reports an enrolled recovery credential;
- requires an online, server-verified WebAuthn assertion and fails closed without PRF support;
- does not change, remove, or re-wrap the configured Vault Unlock Secret;
- does not create new server-side cryptographic material;
- keeps PRF output, User Root Key, Vault Encryption Keys, decrypted content, and OTPs in browser memory only;
- creates the same in-memory Unlocked Vault Session as a Vault Unlock Secret unlock;
- is described as an alternative unlock option, not multi-factor authentication or passwordless application login.

Passkey-Assisted Recovery continues to re-wrap the User Root Key only when the user explicitly completes the Vault Unlock Secret reset flow.

## Consequences

A passkey that was already capable of resetting the Vault Unlock Secret can now unlock the Vault directly with less friction. Losing or removing the enrolled passkey still leaves the Vault Unlock Secret as the primary unlock path. Because assertion verification and recovery-package retrieval are server-mediated, Passkey-Assisted Unlock is unavailable offline. No plaintext secret or usable key is added to server storage.
