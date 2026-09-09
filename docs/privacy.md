# Privacy and hosted-service disclosure

**Published:** 2026-09-08

This document describes the data boundary for rhasia-scret and the
responsibilities of the hosted-demo maintainer, self-hosting operators, and
external providers. It is a product disclosure, not a promise that a provider
retains no operational logs. Provider privacy policies and an operator's
deployment configuration control provider-side retention outside the
application.

## What the application handles

rhasia-scret supports two distinct paths:

- A Local Profile and Local Vault are browser-owned. Their encrypted data,
  account labels, TOTP configuration, secrets, and generated OTPs are not sent
  to the rhasia-scret server.
- Hosted Personal Vaults and Shared Vaults send encrypted payloads and the
  permitted metadata required for authorization, synchronization, lifecycle,
  audit, rate limiting, and operations. The authorized browser or native app
  decrypts Vault content and generates OTPs.

The application can handle account identity and operational data such as an
email address supplied by an authentication provider, an opaque Application
User identifier, opaque Vault/account identifiers, membership and invitation
relationships, revisions, protocol versions, deletion deadlines, redacted
audit actors, rate-limit state, request timing, and bounded ciphertext size.
The exact provider and deployment determine what additional network or
operational metadata is logged outside the application.

## What the server must not receive

The zero-knowledge contract excludes Vault Names, account issuer/name,
plaintext TOTP configuration, OTPs, raw QR data, Vault Encryption Keys, User
Root Keys, Vault Unlock Secrets, private encryption keys, archive keys, Secure
Share Link material, and decrypted Vault content from server persistence,
logs, analytics, and shared caches. Ciphertext size, timing, authorization,
and lifecycle metadata are not hidden by this model.

## Providers and their boundaries

| Provider or component                                      | Data it may handle                                                                                                                          | Responsibility boundary                                                                                                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase Auth or an OIDC Authentication Provider           | Email or provider subject, authentication events, session material, and provider metadata required to verify a principal                    | The provider authenticates the user. It does not receive Vault plaintext from this application. Configure its own retention, access control, and privacy notice.                                                      |
| Email delivery used by the authentication provider         | Recipient address, sign-in or verification link metadata, delivery and bounce data                                                          | The provider controls delivery logs and retention. The application does not receive the email secret.                                                                                                                 |
| Reference Vercel host, CDN, or a self-hosted reverse proxy | Requests, IP/network metadata, headers, timing, deployment and error logs, and encrypted API traffic                                        | The hosted-demo maintainer or self-host operator controls host configuration, log access, retention, TLS, and secret handling.                                                                                        |
| PostgreSQL provider                                        | Encrypted content, opaque identifiers, permitted metadata, and database connection/operational logs                                         | The database must remain behind server-side Prisma. Do not enable browser Supabase Data API/RLS access for this application. The operator owns backups, restore, purge scheduling, and database access.               |
| PostHog browser analytics (optional)                       | Allowlisted aggregate product events, redacted static route paths, bounded web vitals, and a browser identifier derived from a SHA-256 hash | Disabled unless both `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` are set. The sanitizer drops Vault content, labels, emails, URLs with queries/fragments, DOM text, and unapproved properties. |
| Cloudflare Web Analytics (optional)                        | Provider-defined web analytics beacon data for the configured deployment                                                                    | Disabled unless `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN` is set. The operator must review the provider configuration and its current terms before enabling it.                                                    |

The native client currently has no analytics integration. A self-hosting
operator must not add provider SDKs, server-side event forwarding, or custom
telemetry without a separate privacy and security review.

## Retention, deletion, and recovery limits

- A soft-deleted Authenticator Account is eligible for permanent purge after
  30 days.
- A deleted Shared Vault and its encrypted content are eligible for permanent
  purge after 30 days. Restoration is available only during that window.
- Redacted Vault Audit History is retained for one calendar year after Vault
  deletion. Restoring a Vault clears the pending audit purge; a later deletion
  starts a new period.
- The scheduled purge is bounded and idempotent. It never decrypts or logs
  encrypted content; see [`retention-purge-operations.md`](retention-purge-operations.md).
- A destructive Personal Vault Reset removes unusable ciphertext and key
  material when the user cannot unlock it. It is not recovery, and secrets or
  plaintext already obtained by another client cannot be erased remotely.
- Authentication providers, hosting/CDN services, email providers, analytics
  providers, operating systems, client backups, and self-hosted database
  backups can have separate retention controlled by their operator and terms.

## Analytics defaults and operator review

Analytics is default-off. When intentionally enabled, PostHog uses the
allowlisted contract in [`analytics-events.md`](analytics-events.md), and the
browser policy in [ADR-0044](adr/0044-privacy-safe-browser-analytics.md) is
defense in depth rather than a substitute for provider review. Operators must:

1. use separate staging and production projects where possible;
2. run a synthetic smoke flow without real Vault content, labels, addresses,
   secrets, QR data, or OTPs;
3. inspect the received payloads after deployment; and
4. disable the integration and update the sanitizer tests if an unexpected
   property appears.

## Hosted demo versus self-hosting

For the hosted demo, the organization operating the deployed web application
is responsible for the controller/operator decisions for its authentication,
hosting, database, email, analytics, support, and deletion processes. The
rhasia-scret repository documents the application boundary but does not turn
repository maintainers into the controller for an independently operated
deployment.

For a self-hosted deployment, the deploying operator is responsible for the
controller/operator role, provider contracts, user notices, TLS and callback
origins, access to logs and backups, deletion requests, purge scheduling,
incident response, and any enabled analytics. Follow the supported
[self-hosting guide](self-hosting.md) and do not treat repository tests as
production evidence.

## User requests and contact

Users should contact the operator of the deployment they use for account,
deletion, provider, or hosted-demo questions. Public project support,
documentation requests, and vulnerability reporting routes are listed in
[`support.md`](support.md), [`SECURITY.md`](../SECURITY.md), and the public
[support issue intake](https://github.com/arrokh/rhasia-scret/issues/new/choose).
Do not put Vault material, authentication links, cookies, tokens, or
provider secrets in a public issue.

The Indonesian companion is [`privacy.id.md`](privacy.id.md). Changes to
user-facing privacy copy must update both documents and the web message
catalogs together.
