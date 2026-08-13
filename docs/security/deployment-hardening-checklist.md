# Production browser, session, and supply-chain hardening checklist

Use this checklist for every production release. A checked repository item is not a substitute for operator evidence.

## Browser delivery

- [ ] HTTPS is forced and HSTS is present with the production preload policy.
- [ ] Dynamic HTML/API responses contain a nonce-based CSP; static assets contain the restrictive fallback policy. Confirm `script-src` has no production `unsafe-inline` or `unsafe-eval`; the only WebAssembly exception is the narrow `wasm-unsafe-eval` needed by the Argon2id browser implementation.
- [ ] `frame-ancestors`, `X-Frame-Options`, `base-uri`, `form-action`, `object-src`, `Permissions-Policy`, `Referrer-Policy`, COOP, CORP, and `nosniff` are present on pages, APIs, manifest, service worker, and static assets.
- [ ] `Cache-Control: no-store, private` is present on API/auth responses. No user-specific HTML, source maps, API responses, cookies, or auth responses are in Cache Storage.
- [ ] The service worker only caches the public offline shell, manifest, same-origin static assets, and approved PWA assets; `.map`, cross-origin, `/api`, and `/auth` paths are excluded.
- [ ] A stale client receives the tested update/lock behavior before it can display a server-derived workspace.
- [ ] QR/image/archive inputs, Vault/account labels, error text, URLs, and imported data are rendered through safe typed paths with no executable HTML/navigation.

## Authentication and sessions

Review the current provider documentation and changelog before each release. For Supabase, review [server-side auth](https://supabase.com/docs/guides/auth/server-side/nextjs), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [user sessions and refresh-token reuse](https://supabase.com/docs/guides/auth/sessions), and [access-token claims](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook). For OIDC, retain the issuer discovery document, client registration, PKCE, session, and logout/revocation evidence. Record the review date and exact dependency versions.

- [ ] `AUTH_BACKEND` is explicitly set to `none`, `supabase`, or `oidc`; invalid or incomplete configuration fails closed.
- [ ] Supabase PKCE/cookie configuration, access/refresh lifetime and reuse, invited-user verification, session revocation, logout scope, and user switching are verified against the current provider documentation.
- [ ] OIDC discovery issuer, audience, redirect URI, state, nonce, PKCE, ID-token expiry/signature, verified-email admission, and callback error handling are verified.
- [ ] Publishable keys are the only browser-visible keys. Service-role keys, database URLs, tokens, cookies, authorization headers, and provider secrets are absent from bundles, logs, telemetry, and caches.
- [ ] Sensitive online mutations require a current authorized identity and configured freshness/revocation assurance. Offline Local Vault use does not depend on Supabase.
- [ ] Logout clears unlocked server workspaces, server-derived snapshots, and Remembered Browser material according to their ADRs while preserving independent encrypted Local Profile data.

## Supply chain and CI

- [ ] `pnpm install --frozen-lockfile` succeeds and the lockfile is reviewed as the source of exact resolution.
- [ ] `pnpm audit --prod --audit-level=high`, secret scanning, license/provenance review, and generated Prisma/schema validation pass; exceptions are documented with expiry and owner in `docs/security/dependency-audit-exceptions.md`.
- [ ] Security-critical GitHub Actions are pinned to commit SHAs and repository/workflow permissions remain least privilege.
- [ ] Dependency update cadence, emergency patch path, artifact provenance, cache isolation, retention, and rollback are recorded for the release.
- [ ] CI fixtures contain no real Vault data, keys, OTPs, QR data, cookies, or provider tokens.

## Provider, database, and platform evidence

- [ ] Supabase Security Advisor, RLS/Data API exposure, replication/publications, admin MFA, auth settings, and current changelog review are attached.
- [ ] PostgreSQL roles, pooled/direct URL use, TLS, migrations, backups/PITR, restore drill, purge jobs, audit retention, and monitoring evidence are attached.
- [ ] Vercel environment scopes, deployment protection, headers, source-map policy, CDN/cache behavior, forced update path, and release provenance are attached.

## Release decision

A missing operator artifact is **Not Verifiable**, not Pass. Critical/High repository findings in #75–#77 block release. Preserve the completed checklist, command logs, commit SHA, reviewer identity, and incident-response exercise evidence with the release.
