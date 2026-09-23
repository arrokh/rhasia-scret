# Production browser, session, and supply-chain hardening checklist

Use this checklist for every production release. A checked repository item is not a substitute for operator evidence.

## Browser delivery

- [ ] HTTPS is forced and HSTS is present with the production preload policy.
- [ ] Dynamic HTML/API responses contain a nonce-based CSP; static assets contain the restrictive fallback policy. Confirm production script policy has no `unsafe-inline` or `unsafe-eval`; allow only the documented Argon2id WebAssembly exception.
- [ ] `frame-ancestors`, `X-Frame-Options`, `base-uri`, `form-action`, `object-src`, `Permissions-Policy`, `Referrer-Policy`, COOP, CORP, and `nosniff` are present on pages, APIs, manifest, service worker, and static assets.
- [ ] `Cache-Control: no-store, private` is present on API/auth responses. No user-specific HTML, source maps, API responses, cookies, or auth responses are in Cache Storage.
- [ ] API request logs contain only opaque request IDs, route/method/status/duration, and sanitized event types; bodies, query values, cookies, authorization headers, ciphertext, PII, and provider payloads are redacted.
- [ ] The service worker caches only the public offline shell, manifest, same-origin static assets, and approved PWA assets; `.map`, cross-origin, `/api`, and `/auth` paths are excluded. The workspace-bundle response is `no-store` and never enters Cache Storage.
- [ ] A stale client receives the tested update/lock behavior before it can display a server-derived workspace.
- [ ] QR/image/archive inputs, Vault/account labels, error text, URLs, and imported data use safe typed rendering and navigation paths.

## Authentication and sessions

Review the passwordless implementation, SMTP provider, and OIDC issuer documentation/changelog before each release. Record the review date, exact dependency versions, callback configuration, and session/revocation evidence.

- [ ] `AUTH_BACKEND` is explicitly set to `none`, `passwordless`, or `oidc`; invalid or incomplete configuration fails closed in both deployment validation and runtime composition, while non-production passwordless defaulting remains intentional.
- [ ] Invalid web authentication configuration redirects protected pages to the localized `configuration_error` state and never becomes `none` or ordinary `required` authentication.
- [ ] Invalid serverless/lazy API authentication composition returns only `authentication_misconfigured` with HTTP 503, `Cache-Control: no-store`, and an opaque request ID; standalone startup exits before listener creation.
- [ ] Configuration diagnostics contain only the fixed category, bounded field name, and correlation context; no raw configuration values, secrets, cookies, tokens, provider payloads, or exception text are logged or returned.
- [ ] Passwordless link token format, fragment-only delivery, fragment clearing, one-time consumption, expiry, generic responses, SMTP TLS, request limits, session lifetimes, refresh rotation/reuse detection, cookie flags, native secure storage, and revocation/logout scope are verified.
- [ ] OIDC discovery issuer, audience, redirect URI, state, nonce, PKCE, ID-token expiry/signature, verified-email admission, and callback error handling are verified when enabled.
- [ ] Browser-visible configuration contains public values only. Database URLs, tokens, cookies, authorization headers, SMTP/OIDC secrets, and session credentials are absent from bundles, logs, telemetry, and caches.
- [ ] Sensitive online mutations require a current authorized identity and configured freshness/revocation assurance. Offline Local Vault use does not depend on hosted authentication.
- [ ] Logout clears unlocked server workspaces, Personal-only server-derived snapshots, and Remembered Browser material according to their ADRs while preserving independent encrypted Local Profile data.
- [ ] Synthetic browser/native storage inspection proves hosted snapshots contain Personal Vault data only, legacy Shared-containing snapshots are cleaned up, and Shared Vault access remains online-only.

## Supply chain and CI

- [ ] `pnpm install --frozen-lockfile` succeeds and the lockfile is reviewed as the source of exact resolution.
- [ ] `pnpm audit --prod --audit-level=high`, secret scanning, license/provenance review, and generated Prisma/schema validation pass; exceptions are documented with expiry and owner in `docs/security/dependency-audit-exceptions.md`.
- [ ] Security-critical GitHub Actions are pinned to commit SHAs and repository/workflow permissions remain least privilege.
- [ ] Dependency update cadence, emergency patch path, artifact provenance, cache isolation, retention, and rollback are recorded for the release.
- [ ] CI and release-check fixtures use synthetic, non-PII values and contain no real or user-provided Vault/account data, labels, issuer names, keys, OTPs, QR data, cookies, credentials, or authentication tokens.

## Provider, database, and platform evidence

- [ ] Passwordless SMTP/account settings, secret rotation, session-revocation checks, OIDC settings when enabled, and authentication changelog reviews are attached.
- [ ] PostgreSQL roles, pooled/direct URL use, TLS, migrations, passwordless identity seed verification, backups/PITR, restore drill, purge jobs, audit retention, and monitoring evidence are attached.
- [ ] Vercel or equivalent host environment scopes, deployment protection, headers, source-map policy, CDN/cache behavior, forced update path, and release provenance are attached.
- [ ] The API is deployed as a separate Node/Bun service/project; Web has no API secrets, database URLs, SMTP credentials, or migration URL, and API provider log/retention settings are documented.
- [ ] The 03:00 UTC retention scheduler authenticates with `CRON_SECRET`, fails closed on invalid credentials, exposes bounded counts only, and has failure/backlog monitoring.

## Release decision

A missing operator artifact is **Not Verifiable**, not Pass. Preserve the completed checklist, command logs, commit SHA, reviewer identity, and incident-response exercise evidence with the release.
