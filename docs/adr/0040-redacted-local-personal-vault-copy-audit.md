# Redacted Local and Personal Vault copy audit

- **Status:** Accepted
- **Date:** 2026-07-30
- **Related:** ADR-0030, ADR-0033, ADR-0037

## Context

Users can explicitly copy Authenticator Accounts between the device-only Local Vault and their server-backed Personal Vault. Personal Vault owners need these copy activities in Vault Audit History, but the honest-but-curious server must not receive a Local Profile identifier, Local Vault identifier or name, Local account identifier, decrypted account label, issuer, TOTP configuration, secret, raw QR data, OTP, Local Vault key, or Local Vault Passphrase.

A Local-to-Personal copy creates a new Personal Vault Authenticator Account through the server. A Personal-to-Local copy writes only to browser storage, so recording its activity is a separate server request and cannot be transactionally coupled to the local write.

## Decision

Personal Vault Audit History adds two stable event types:

- `ACCOUNT_COPIED_FROM_LOCAL`: recorded atomically with creation of the new Personal Vault Authenticator Account. Its `targetId` is the newly created opaque Personal Vault account identifier.
- `ACCOUNT_COPIED_TO_LOCAL`: recorded after one or more successful local writes. Each event's `targetId` is the existing opaque source Personal Vault account identifier.

The server re-authenticates the Application User, requires an active owned Personal Vault, and verifies every `ACCOUNT_COPIED_TO_LOCAL` target is an active account in that Personal Vault. The request is bounded, rejects duplicate or foreign identifiers, and contains no Local Vault or decrypted account data. The Local-to-Personal account-creation request carries only an enum-like copy source marker in addition to the existing ciphertext contract; the repository writes account creation and its audit event in one database transaction.

Copy remains client-first. Failure to create a Personal Vault account also prevents its `ACCOUNT_COPIED_FROM_LOCAL` event. A Personal-to-Local account is retained when the later audit request fails; the UI warns that the copy succeeded but activity recording failed. The client does not persist or retry the audit request through TanStack Query, service workers, or an offline mutation queue.

These events use the existing one-year Vault Audit History retention, owner-only visibility, actor identity, and redaction rules. The server learns copy direction, actor, opaque Personal Vault/account identifiers, count through event cardinality, and operational timing. It does not learn which Local Profile or Local account participated.

## Consequences

Personal Vault owners can distinguish direct account creation from a copy originating in Local Vault and can see when a Personal Vault account was copied to device-only storage. Cross-device copy correlation is intentionally impossible because no Local identifier is persisted. A successful Personal-to-Local copy can temporarily lack its audit event during a server or network failure; preserving the completed local write avoids pretending a server audit is an authorization gate or synchronization transaction.
