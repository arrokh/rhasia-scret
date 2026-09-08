# Context-bound encrypted envelopes

- **Status:** Accepted
- **Date:** 2026-07-29
- **Related:** ADR-0004, ADR-0005, ADR-0006, ADR-0010, ADR-0019, ADR-0020, ADR-0022, ADR-0024, ADR-0033, ADR-0037
- **Remediation:** GitHub issue #75; audit finding AUD-001 in `docs/audits/2026-07-29-security-privacy-quality-operational-readiness.md`

## Decision

Persisted encrypted payloads use envelope version 2. AES-256-GCM authenticates a canonical, secret-free **Crypto Envelope Context** as Additional Authenticated Data (AAD). A valid ciphertext therefore cannot be transplanted between different semantic records, Vaults, accounts, recipients, profiles, archive types, or protocol versions when the client supplies the intended context.

Envelope v2 keeps the existing compact binary shape so database columns and API contracts remain opaque blobs:

```text
1 byte version (0x02) || 12 byte random nonce || AES-GCM ciphertext || 16 byte tag
```

The context is not a user label and is not a server-readable plaintext field. It is reconstructed by the owning client use case from stable protocol constants and opaque identifiers. Canonical serialization uses a fixed-key JSON object with protocol version, purpose, payload type, optional opaque Vault/account/recipient/profile identifiers, key version, and archive version. Purposes and identifiers are strictly bounded; arbitrary labels, email addresses, secrets, QR data, OTPs, and decrypted content are rejected. Context serialization is deterministic and capped at 1024 bytes.

Context mismatch, unknown envelope version, malformed nonce/tag/encoding, truncation, wrong key, and malformed plaintext all fail closed before the plaintext is parsed or used. No implementation may silently retry v2 with context-free decryption.

## Payload inventory

| Persisted payload | Context binding | Notes |
| --- | --- | --- |
| Authenticator Account payload | `authenticator-account`, `totp-configuration`, owning Vault identifier where available, account identifier when client-generated, encryption version | Server-created account IDs are not known before the first write; Vault identity and protocol/key version are bound. Local account IDs are bound before first write. |
| Personal/Shared/Local Vault Name | `vault-name`, `vault-name`, owning opaque Vault/Profile identifier when known, key version | User-visible names remain ciphertext; no label is put in AAD or metadata. |
| User Root Key wrapping | `user-root-key-wrap`, `user-root-key`, key version | Separate from the Vault Unlock Secret and provider identity. |
| Vault Encryption Key wrapping | `vault-key-wrap`, `vault-encryption-key`, recipient/profile/Vault identifier when available, key version | ECDH/HKDF info also includes the canonical context for domain separation. |
| Secure Share Link package | `secure-share-link`, `vault-encryption-key`, intended Vault identifier when available, key version | The link secret remains only in browser memory/out-of-band delivery. |
| Passkey recovery package | `passkey-recovery-wrap` and `passkey-recovery-root`, payload types, key versions | PRF output and User Root Key remain client-only. |
| User Encryption Key Pair private key | `user-encryption-private-key`, payload type, key version | Private JWK is encrypted before any permitted server persistence. |
| Local Profile/Local Vault records | local root/key/name/account purposes plus opaque Local Profile/account identifiers | New local writes use v2 from first write. Local records are never server-linked. |
| Local Vault Snapshot | the ordinary contained profile/name/key/account contexts | Snapshot remains an encrypted, read-only server-derived copy. Native storage adds a separate outer `native-offline-snapshot` context-authenticated envelope; its random storage key remains in secure native storage and is not the Vault key. |
| Encrypted Vault Archive | `encrypted-archive`, `vault-archive`, archive format version | The separate archive key is user-held and never persisted by the service. |
| Recovery, invitation, audit, and lifecycle metadata | Intentionally exempt from encrypted payload context where they are permitted opaque authorization/lifecycle metadata | These records must not gain plaintext content merely to support context binding. |

The server does not interpret or verify semantic AAD. It stores opaque ciphertext and permitted identifiers/versions, while the browser constructs the expected context and performs authentication.

## Legacy migration

Envelope v1 is a context-free compatibility format and is not an accepted current write format. The only allowed v1 read is through an explicit migration path that:

1. identifies the record and expected legacy payload type from the owning use case;
2. strictly parses the v1 envelope and decrypts it with the legacy primitive in a migration-only function;
3. validates the complete plaintext against the current typed contract;
4. derives the exact v2 context from the record's opaque identifiers and protocol state;
5. re-encrypts in browser memory with a fresh nonce and v2 AAD;
6. submits only the new opaque ciphertext, version, and expected Account Revision/key version;
7. atomically commits the replacement or leaves the previous ciphertext untouched.

Migration is resumable and idempotent. A stable client-generated migration operation/account identifier makes retries recognizable. The server/application transaction rejects stale revisions, stale key versions, duplicate operations, unauthorized Vaults, and mixed or incomplete batches. A client records progress only as permitted opaque lifecycle metadata; it never stores plaintext or declares a batch complete before every replacement succeeds. A failure or interruption preserves the last valid server ciphertext and Local Vault Snapshot. Rollback means retaining/reinstating the last valid ciphertext and rerunning the explicit migration, not retrying an unauthenticated decrypt.

A legacy record that cannot be associated with an unambiguous context is not migrated automatically. It is reported as unavailable and requires the documented recovery path rather than a compatibility shim.

## Key and protocol separation

For AES-GCM payloads, AAD context is copied before Web Crypto invocation and is never reused as key material. For P-256 ECDH key wraps, the shared secret is fed to HKDF-SHA-256 with an info value containing `rhasia-scret:key-wrap:v2:` and the canonical context. The old v1 HKDF label remains available only for explicit legacy migration/fixtures. Fresh key-wrap writes use v2 context-bound packages.

The protocol version is part of the authenticated context. Key rotation writes a fresh v2 envelope under the new key; it cannot convert a wrong-context or stale-key payload by parsing plaintext first. Passkey PRF, Remembered Browser, archive, Local Vault, and server Vault flows remain separate protocols even when they use the same AES-GCM primitive.

## Zero-knowledge guarantees and permitted metadata

The implementation guarantees, subject to the honest-but-curious server and hosted-client limitation:

- the server cannot decrypt stored Vault names, account configurations, TOTP secrets, generated OTPs, keys, archive contents, recovery key material, or Local Vault content;
- ciphertext authenticated for one semantic context cannot be accepted as another semantic context by the client;
- transport, Prisma persistence, logs, metrics, traces, audit history, Query state, URLs, Cache Storage, and service-worker caches contain no prohibited plaintext or key material during ordinary operation or migration;
- permitted server-visible metadata is limited to opaque user/Vault/account/recipient identifiers, ciphertext bytes, protocol/encryption/key versions, revisions, lifecycle/deletion deadlines, authorization relationships, permitted invited email metadata, redacted audit actor/account IDs, and bounded imported-record counts as already documented by the relevant ADRs.

Zero knowledge does not hide the existence/size/timing of permitted records, authorization/lifecycle metadata, or network activity. It does not protect opened secrets from an actively malicious hosted client that serves altered JavaScript. A signed-client/delivery-integrity architecture would be a separate ADR and is not implied by this decision.

## Consequences and review gate

Every current production crypto call site must use a purpose-specific v2 API. The context-free APIs remain visibly deprecated for migration and legacy fixtures only. Unit tests cover known-answer behavior, tampering, truncation, unknown versions, wrong contexts, cross-account/Vault/recipient substitution, replay, malformed keys, and migration interruption. Integration/browser tests prove Personal, Shared, recovery, invitation, archive, offline, and Local Vault journeys preserve ciphertext-only server behavior.

Before v1 writes are retired, an independent cryptographic/security reviewer must inspect this ADR, the call-site inventory, migration transaction/revision protocol, and test evidence. Unresolved Critical/High findings block production rollout.
