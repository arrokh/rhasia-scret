# Platform-neutral client ports

- **Status:** Accepted
- **Date:** 2026-08-11
- **Related:** ADR-0016, ADR-0018, ADR-0023, ADR-0024, ADR-0028, ADR-0033, ADR-0037, ADR-0038, ADR-0039
- **Issue:** #95

## Decision

Client application workflows use typed platform ports. Browser APIs remain in explicit web adapters selected by the Next.js composition layer; a future React Native composition may supply native adapters without importing browser APIs into shared workflows.

Ports are owned by the bounded context that owns the capability:

- shared platform ports define authenticated HTTP transport, cancellation, network status, lifecycle visibility, clipboard, download, and file input contracts;
- Identity and shared transport composition retain authorization semantics while allowing a bearer-token transport adapter;
- Crypto defines primitive encryption, HMAC, ECDH, HKDF-SHA-256, Argon2id derivation, and device-bound capability contracts;
- Sync and Local Vault define encrypted snapshot, Remembered Browser, Local Profile, and lock storage contracts;
- Authenticator Account defines encrypted account payload and QR import contracts;
- Vault Archive defines archive preparation and download contracts;
- OTP Runtime defines server-time access.

Application workflows must not import Next.js, React presentation code, browser globals, IndexedDB, DOM download APIs, Service Workers, Web Workers, or Web Crypto. They receive ports for all platform effects. Existing web entry points retain their public behavior by constructing adapters around the existing browser implementations.

## Authentication and transport

The current web adapter continues to use the existing same-origin cookie session. `AuthenticatedTransport` is intentionally credential-neutral. `BearerTokenTransport` adds a future native bearer token only at the transport boundary. Tokens are never passed into workflows as query data, persisted client state, logs, encrypted content, or server data beyond the provider's request.

Authorization checks, revision checks, one-time Secure Share Link semantics, mutation rate limits, audit redaction, and server/client zero-knowledge boundaries are unchanged.

## Cryptography and protocol compatibility

The port boundary does not change protocol constants, envelope versions, context binding, KDF parameters, key-wrap formats, archive formats, Secure Share Link packages, or TOTP behavior. Browser Web Crypto, Argon2id, HMAC, HKDF-SHA-256, and Worker execution are adapters. Synthetic cross-platform vectors cover Argon2id, RFC 6238 TOTP, context-bound encryption, context-bound key wraps, archives, and Secure Share Link material; no vector contains production secrets.

WebAuthn PRF Remembered Browser and Passkey-Assisted Recovery expose the explicit `browser-webauthn-prf` capability. Unsupported platforms report unsupported; native passkey support is not treated as WebAuthn PRF compatibility and no native-equivalence claim is made.

## Storage, lifecycle, and sensitive data

Encrypted Local Vault records, Local Vault Snapshots, and Remembered Browser packages remain encrypted and client-owned. Ports do not permit plaintext TOTP configuration, OTPs, keys, passphrases, raw QR data, or decrypted content to enter TanStack Query, logs, server persistence, URLs, or service-worker caches. Lock, logout, failed operations, and component teardown retain the existing key-clearing behavior.

The server remains an honest-but-curious authorization and ciphertext store. This decision is an internal portability boundary, not a change to the security model or a promise to protect opened secrets from a malicious hosted client.
