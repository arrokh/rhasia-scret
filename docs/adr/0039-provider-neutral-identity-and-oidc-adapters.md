# Provider-neutral identity with passwordless and OIDC adapters

- Status: Accepted
- Date: 2026-07-29 (updated 2026-09-14)
- Deciders: rhasia-scret maintainers
- Related: ADR-0011, ADR-0023, ADR-0031, ADR-0049

## Decision

Identity is a provider-neutral application boundary. The Identity bounded context exposes a normalized **Verified Principal** containing immutable issuer, subject, verified email/contact metadata when available, and provider-independent session assurance. Concrete protocol/session types remain in Identity infrastructure and the server-only composition root.

Supported deployment modes are selected by validated server-only `AUTH_BACKEND` configuration:

- `none`: Local Profile and Local Vault only. Remote authentication, synchronization, membership, server recovery, audit, and hosted Vault APIs fail closed.
- `passwordless`: self-managed email-link authentication. One-time link challenges, local sessions, native/PWA refresh rotation, browser assertion keepalive, revocation, and anonymous abuse limits are persisted through the application database; Bun, self-hosted Node.js, and Vercel API deployments deliver email through the same server-only Nodemailer/SMTP adapter using SMTP port 465 or 587; port 25 remains prohibited.
- `oidc`: Authorization Code with PKCE against one configured OIDC issuer, using discovery metadata and maintained protocol libraries; tokens and client secrets remain server-only.

OIDC remains the interoperability contract for future external providers. Auth.js/NextAuth is not installed as a transparent proxy because it would introduce a second identity and persistence authority. A future managed-auth framework may be added only as an adapter behind this boundary after separate release and security review.

Authentication and Application Admission are separate. Passwordless verification admits the user according to the configured deployment policy and provisions an Application User idempotently; OIDC remains governed by configured admission. Verified email can satisfy a Shared Vault invitation match but never links two identities or merges Application Users.

An External Identity is unique by `(issuer, subject)` and belongs to exactly one Application User. Email is contact/admission metadata only. The Application User identifier, Vault ownership/membership, audit history, rate-limit identity, crypto profile, passkey-recovery enrollment, and encrypted content survive authentication-provider changes unchanged.

## Session assurance

Identity adapters provide explicit assurance levels:

- `verified-claims`: signed/current claims or a valid local browser assertion for normal page gating;
- `fresh-provider-user`: a current adapter-backed identity check for online application mutations;
- `active-session`: an active database session check with revocation and rotation evidence where immediate revocation guarantees are required.

An adapter that cannot satisfy a requested assurance fails closed. Offline Local Vault and Local Vault Snapshot unlock never require remote authentication.

## Linking and migration

There is no automatic email-based linking. Explicit linking requires reauthentication of both existing and proposed identities in one server-owned ceremony, verifies issuer/subject and admission policy, writes a redacted security event, and does not touch Vault key material. Authentication migration first creates and validates the new External Identity, preserves the Application User ID, and only then retires the old identity through an auditable rollback-safe operation. A partially completed migration leaves the original identity active.

The staged Prisma-generated migration creates local passwordless identity/challenge/session state while temporarily retaining the legacy provider-subject column. The preflight rejects invalid or colliding normalized emails. The seed creates exactly one local identity for each existing Application User by existing user ID; it never matches or merges by email. After verification, the cleanup migration removes the legacy column. Existing External Identity rows and all Vault foreign keys remain intact.

## Implementation status

Passwordless web and native flows, provider-neutral identity persistence, OIDC composition, migration preflight/seed/verification, and local session lifecycle are shipped. A future external provider may be added through the same adapter contract; automatic linking remains prohibited.

## Failure behavior

Missing/invalid backend configuration, discovery failure, issuer/audience/nonce/state/PKCE mismatch, expired/revoked sessions, unverified email, missing admission, duplicate identity, ambiguous link, invalid/consumed challenge, malformed credential, or email delivery failure fails closed with a locale-independent error code. Tokens, authorization codes, client secrets, cookies, session credentials, and provider error payloads never enter Vault storage, Query caches, service-worker caches, or logs. Raw authentication tokens are limited to transient URL fragments for their client-side redemption; the installed-PWA handoff keeps its refresh credential transient in callback memory and a same-origin publisher request, while its verifier-backed server row stores only keyed digests; invitation Secure Share Link secrets never enter authentication requests or server-generated magic-link URLs.

The provider-neutral contract is tested against deterministic passwordless and OIDC adapters. Tests use synthetic, non-PII identities and SMTP seams; they do not claim production provider settings or availability.
