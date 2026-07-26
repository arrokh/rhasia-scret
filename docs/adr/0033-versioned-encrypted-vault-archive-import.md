# Versioned encrypted Vault archive import

## Status

Accepted

## Context

An Encrypted Vault Archive must remain portable without giving the honest-but-curious server archive keys, Vault Encryption Keys, Vault Names, account labels, TOTP secrets/configuration, or raw authenticator URIs. Importing account-by-account would also make a failed operation appear successful while leaving only part of an archive in its destination.

## Decision

The supported archive format is version 1: an AES-256-GCM encrypted envelope containing a bounded JSON payload with `version`, one Vault Name, and at most 500 Base64-encoded normalized TOTP account payloads. The user explicitly supplies the separate 32-byte archive key as Base64. The browser authenticates, decrypts, strictly validates, previews, duplicate-checks, and re-encrypts every account under the selected destination Vault Encryption Key. Unsupported versions, malformed/corrupt content, authentication failures, unsupported TOTP settings, empty/oversized account payloads, and archives over 5 MiB fail before mutation.

The user may select their Personal Vault, an owned active Shared Vault, or create a new Shared Vault named from the archive preview. Viewer destinations are excluded. Duplicate detection uses plaintext only in client memory and requires an explicit cancel or add-anyway choice.

One authenticated import request carries only opaque destination identifiers, envelope versions, and re-encrypted ciphertext. Client-generated opaque Vault/account identifiers make an identical retry recognizable. The Prisma adapter authorizes ownership and writes the new Shared Vault, owner key envelope, all Authenticator Accounts, and redacted audit event—or all imported accounts in an existing Vault—in one database transaction. Invalid, conflicting, or incomplete requests write nothing. Offline mutation policy blocks the request and import is never queued.

Temporary archive bytes, archive keys, decrypted account copies, and newly generated Vault material are cleared or released after preview failure, cancellation, completion, lock, logout, or component teardown. Decrypted archive material never enters TanStack Query, browser persistence, request payloads, or logs. After success, a fresh ciphertext synchronization rebuilds the ordinary Unlocked Vault Session.

## Consequences

Version evolution requires an explicit new parser and migration decision rather than permissive fallback. The server cannot inspect semantic duplicates or imported TOTP validity; those remain client-only checks. A network interruption can make completion temporarily ambiguous, but stable opaque identifiers make retry non-duplicating and the atomic transaction prevents an incomplete import.
