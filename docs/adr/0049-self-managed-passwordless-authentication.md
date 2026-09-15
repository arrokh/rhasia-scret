# ADR-0049: Self-managed passwordless authentication persistence

- Status: Accepted
- Date: 2026-09-14
- Supersedes: ADR-0043 and ADR-0048 for hosted authentication delivery

## Context

The application must authenticate hosted users without delegating identity or session state to a provider. Existing `ApplicationUser` identifiers, `ExternalIdentity` bindings, Vault relationships, encrypted material, recovery data, and audit history must remain unchanged. The server may persist authentication metadata and opaque credential digests, but never a magic-link secret, access token, refresh token, Vault key, or decrypted Vault content.

## Decision

`ExternalIdentity` remains the provider-neutral binding keyed by `(issuer, subject)`. The local passwordless adapter uses issuer `rhasia:passwordless` and a random subject. `PasswordlessIdentity` adds only local-email identity data: a normalized-email uniqueness constraint and its one-to-one binding to `ExternalIdentity`. It does not duplicate verification state; `ExternalIdentity.emailVerifiedAt` is authoritative.

`MagicLinkChallenge` stores an HMAC digest of a one-time token, normalized delivery email, client audience, bounded continuation path, purpose, expiry, consumption time, and creation time. The client and purpose columns remain database strings to follow the repository's enum policy; application code validates their finite unions. The email action fragment may echo the bounded continuation path as a non-sensitive client hint, but the Secure Share Link secret is never added to the magic-link request or email URL. No raw link token or request IP is persisted.

`AuthSession` is provider-neutral and application-user-owned. It stores independent HMAC digests for the current opaque access and refresh credentials, a refresh family, independent access/refresh expiry, revocation and rotation/reuse timestamps, a redacted revocation reason, and last-use timing. It intentionally excludes user agents, IP addresses, token plaintext, and device fingerprints. Native refresh rotation atomically replaces the refresh digest; reuse revokes the session and emits a redacted `IdentitySecurityEvent`. Browser keepalive validates the signed browser assertion without consuming or rotating the refresh digest, preventing React Strict Mode and concurrent browser loads from being misclassified as credential reuse.

`AnonymousAuthRateLimitWindow` stores only a keyed bucket digest, operation class, fixed window, expiry, and bounded count. This supports email/IP abuse controls without persisting email addresses or IP addresses. The retention purge removes expired challenges, sessions, and anonymous windows while preserving redacted security events.

## Migration and rollback safety

The migration is split into two Prisma-generated migrations:

1. create the new authentication tables and security-event session reference while retaining the legacy provider-subject column;
2. the cleanup migration verifies one correctly mapped local identity per Application User inside the database transaction, then removes the legacy column. If the seed has not run, the cleanup migration fails closed; operators run the seed and retry deployment.

The seed creates exactly one local identity for each existing `ApplicationUser` by its existing user ID. It rejects normalized-email collisions and never matches or merges users through email. Existing `ExternalIdentity` rows and all user-owned records remain untouched. `verify:passwordless-migration` checks one local identity and binding per user and confirms the legacy column is absent. The historical `supabase_user_id` name remains only in immutable migration SQL and guarded migration verification; it is not a runtime field, configuration value, dependency, or authentication authority.

If preflight, seeding, or staged verification fails, the destructive migration is not applied. The deployment runner invokes Prisma Migrate against a temporary directory containing only migrations through the additive migration, then runs the checks and invokes the full migration directory only after they pass. It is safe to rerun after interruption; if the cleanup migration has already been applied, the runner skips staging and deploys any remaining migrations. If the cleanup migration has been applied, rollback means restoring the database backup and deploying the previous application; the application never falls back to provider sessions or a dual-auth path.

## Consequences

The schema supports browser, installed PWA, and native clients, multiple concurrent sessions, future local email-link purposes, and future external providers without adding provider columns to `ApplicationUser`. Adding another provider creates another `ExternalIdentity`; matching by email remains an explicit, reauthenticated identity-linking operation. New token purposes or continuation paths require application-level validation and tests rather than schema rewrites. When a passwordless sign-in began from an Invitation, the confirmation page announces completion to the still-open invitation tab and navigates its authenticated tab to the invitation route; the one-time Secure Share Link secret remains client-only. An installed PWA uses the separate, transient browser-to-PWA session handoff in ADR-0050 when its cookie jar is not shared with the link-opening browser.
