# Provider-neutral identity with OIDC adapters

- Status: Accepted
- Date: 2026-07-29
- Deciders: rhasia-scret maintainers
- Related: ADR-0011, ADR-0023, ADR-0031, ADR-0035, issues #74, #76, #77

## Decision

Identity is a provider-neutral application boundary. The Identity bounded context exposes a normalized **Verified Principal** containing an immutable issuer, subject, verified email/contact metadata when available, and provider-independent session assurance. Concrete authentication SDKs and protocol/session types remain in Identity infrastructure and its server-only composition root.

Supported deployment modes are selected by validated server-only `AUTH_BACKEND` configuration:

- `none`: Local Profile and Local Vault only. Remote authentication, synchronization, membership, server recovery, audit, and Vault APIs fail closed.
- `supabase`: the existing invited email-link behavior through the Supabase adapter.
- `oidc`: Authorization Code with PKCE against one configured OIDC issuer, using discovery metadata and maintained protocol libraries; tokens and client secrets remain server-only.

OIDC is the preferred interoperability contract because it standardizes issuer/subject identity, discovery, authorization-code PKCE, state, nonce, redirect, audience, and expiry validation across maintained providers. Auth.js/NextAuth is not installed as a mandatory transparent proxy: it creates its own persistence/linking/session model and would become a second identity authority. A future managed-auth framework may be added only as an adapter behind this boundary after separate release/security review.

Authentication and Application Admission are separate. A valid principal does not silently create access unless the configured admission policy permits it. The initial policy remains invite-only/pre-registered. Verified email can satisfy an invitation match but never links two identities or merges Application Users.

An External Identity is unique by `(issuer, subject)` and belongs to exactly one Application User. Email is contact/admission metadata only. The Application User identifier, Vault ownership/membership, audit history, rate-limit identity, crypto profile, passkey-recovery enrollment, and all encrypted content survive provider migration unchanged.

## Session assurance

Identity adapters provide explicit assurance levels:

- `verified-claims`: the provider verified the signed/current claims for normal page gating;
- `fresh-provider-user`: the adapter made a provider-backed current-user verification for online application mutations;
- `active-session`: the adapter additionally validated active session evidence (including `session_id` where the provider supplies it) for operations that require immediate revocation guarantees.

An adapter that cannot satisfy a requested assurance fails closed. Offline Local Vault and Local Vault Snapshot unlock never require a remote provider.

## Linking and migration

There is no automatic email-based linking. Explicit linking requires reauthentication of both existing and proposed identities in one server-owned ceremony, verifies issuer/subject and admission policy, writes a redacted security event, and does not touch Vault key material. Provider migration first creates/validates the new External Identity, preserves the Application User ID, and only then retires the old identity through an auditable rollback-safe operation. A partially completed migration leaves the original identity active.

The Prisma CLI-generated migration adds External Identity and makes the legacy `application_users.supabase_user_id` column nullable without changing Application User IDs. Deployment immediately runs the Prisma-backed `prisma:backfill-external-identities` step, which copies every existing legacy subject into an External Identity with the canonical Supabase issuer and verifies that no legacy user is missing a mapping. The legacy column is a migration ledger and is not read for new provider identities; a later reviewed cleanup migration may remove it after operator evidence confirms the backfill. Existing Vault foreign keys continue to reference the unchanged Application User ID.

## Failure behavior

Missing/invalid backend configuration, discovery failure, issuer/audience/nonce/state/PKCE mismatch, expired/revoked sessions, unverified email, missing admission, duplicate identity, ambiguous link, or provider outage fails closed with a locale-independent error code. Tokens, authorization codes, client secrets, cookies, and provider error payloads never enter Vault storage, Query caches, URLs, service-worker caches, logs, or client bundles.

The provider-neutral contract is tested against Supabase and deterministic OIDC adapters. OIDC integration tests use synthetic issuer metadata and authorization responses; they do not claim production provider settings or availability.
