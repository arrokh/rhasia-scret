# Shared Vault account-access audit

## Status

Accepted

## Context

Shared Vault owners need to know which authorized member opened or copied an Authenticator Account item. The server cannot inspect decrypted account content and must not receive account names, issuers, TOTP configuration, generated OTPs, or Vault keys.

## Decision

The client records an `ACCOUNT_ACCESSED` Vault Audit event after an explicit Shared Vault Authenticator Account press. The server accepts the event only when the authenticated user has an active Owner or Viewer membership and the opaque Authenticator Account identifier belongs to that active Shared Vault.

The event stores the Vault identifier, actor user identifier, event type, opaque Authenticator Account identifier, and timestamp. Owner-only audit responses may include the actor's application-account email so the owner can understand who performed the action. They do not include decrypted account labels, issuers, OTPs, secrets, or other encrypted content.

Account access and OTP copying remain client-first: an audit-request failure does not block local OTP use, but the client reports the audit failure without retrying through a persistent cache. Audit history remains owner-only and follows the existing retention policy.

## Consequences

The honest-but-curious server learns that a specific authorized user accessed a specific opaque account record at a time, but it does not learn what account or OTP that record represents. Owners gain an attributable access history. Viewer users do not gain access to audit history or membership details.
