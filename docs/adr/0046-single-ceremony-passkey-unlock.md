# Single-ceremony Passkey-Assisted Unlock

- **Status:** Accepted
- **Related:** ADR-0024, ADR-0029

## Context

Unlock currently requests a server-verifiable assertion and then a separate PRF assertion. This causes two biometric prompts. The PRF salt is public metadata inside the existing opaque encrypted recovery package, but is needed before asking the authenticator to sign.

## Decision

The authenticated, rate-limited authentication-options endpoint returns the enrolled opaque encrypted recovery package alongside the one-time server challenge. The browser parses its public salt and requests PRF evaluation in the same user-verification-required assertion. Only the standard assertion fields, never PRF extension results, are sent for server verification. The client opens the package only after successful online verification and checks that the verified package matches the initial package. PRF bytes are zeroed on success and failure.

This supersedes the package-delivery timing in ADR-0024: ciphertext is available to the authenticated user before assertion verification, but no usable key is released by the application before verification. The honest-but-curious server already holds this ciphertext and cannot derive PRF output. No new database fields, secret disclosure, authentication bypass, or fallback to assertion-only decryption is introduced. Responses remain non-cacheable.

Enrollment may still require a creation and PRF evaluation ceremony. Browser/authenticator-controlled account selection and system UI are outside the application's control. This change reduces ordinary unlock and recovery to one application-issued assertion; it does not turn Vault unlock into account sign-in.
