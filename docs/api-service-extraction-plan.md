# Standalone API service and deployment plan

## Objective

Run `apps/api` as a standalone Hono service with Bun as the primary runtime and Node.js compatibility for Vercel and other hosts. The implementation removes the Cloudflare Worker and Hyperdrive deployment path while preserving the `/v1/**` API contract, authentication behavior, encrypted-content boundary, shared SMTP delivery, and client-only invitation secrets.

## Current status — 2026-09-20

The repository implementation is complete and locally verified. Bun, generic Node.js, and Vercel adapters, environment isolation, deployment validation, PII controls, provider-neutral deployment smoke checks, bounded request/ciphertext validation, proxy-origin and anonymous-rate-limit hardening, passwordless/PWA handoff fixes, invitation onboarding, account deletion, and offline sign-in navigation are implemented. The browser gate now allocates a collision-free port block by default. The passwordless migration verifier passes against the already-approved database state; no production or persistent database migration was run.

A previous `mise exec -- pnpm run test:full` passed after the extraction implementation, and PR #205 checks passed for commit `eb4b2dc`. The latest Vercel latency-hardening pass has fresh API unit, route-parity, architecture, lint, typecheck, build, bundle-artifact, and local dedicated-handler evidence. A fresh `pnpm run test:full` also passed, including the disposable PostgreSQL test-container migration workflow; no production or persistent database migration was performed. The latest release-readiness record is [`release-readiness/2026-09-20.md`](release-readiness/2026-09-20.md).

Live deployment, production-domain cutover, provider monitoring, and rollback evidence remain blocked until Vercel/provider access and deployment authority are supplied.

Production origins:

- Web: `https://rhasia-scret.nooroctavian.id`
- API: `https://api.rhasia-scret.nooroctavian.id`

Cloudflare Turnstile remains an API integration. It is not a runtime-hosting dependency.

## Runtime architecture

`apps/api/src/app.ts` remains the canonical Hono application. Runtime adapters compose the application with process configuration and a bounded Prisma client:

| Adapter        | Entry point                                                               | Role                                                                  |
| -------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Bun            | `apps/api/src/bun.ts`                                                     | Local development, Docker, and primary self-hosted/production runtime |
| Node.js        | `apps/api/src/node.ts`                                                    | Generic Node.js host using `apps/api/dist/node.js` and sibling chunks |
| Vercel Node.js | `apps/api/api/index.ts`, `apps/api/api/health.ts`, `apps/api/api/time.ts` | Separate API Vercel project                                           |

`apps/api/src/standalone.ts` creates the API bindings, SMTP senders, and one process-scoped Prisma client from `DATABASE_URL`. Request handling never reads `DIRECT_URL`, receives no Hyperdrive binding, and does not expose database connection strings in request context.

The Vercel adapter loads the standalone `dist/vercel.js` bundle produced by the Vercel-specific API build target, rather than asking Vercel's source transpiler to resolve the internal `@api/*` TypeScript aliases. The Vercel build embeds ESM-compatible direct dependencies into generated chunks and statically anchors the Node packages whose CommonJS dynamic requires must remain external (`@prisma/client`, `@prisma/adapter-pg`, `pg`, `nodemailer`, and `dotenv`); the bundle verifier checks both unresolved imports and external-package resolution. `/v1/health` and `/v1/time` use separate lightweight bundles and functions, so liveness and clock checks do not initialize Prisma, SMTP, authentication, or API route modules. The general API bundle normalizes `/api/**` function paths back to canonical `/v1/**` paths, and its route handlers are emitted as lazy route-level chunks. All system and API handlers preserve request bodies, query strings, no-store/request-ID/CORS/proxy behavior, and repeated `Set-Cookie` values through the Hono Node listener. The process-scoped standalone composition creates one Prisma client and one identity/application runtime per warm function instance. Production database configuration identifies Supabase `ap-southeast-1` (Singapore), so `apps/api/vercel.json` pins the API to Vercel `sin1`; external project settings still require deployment verification. The configuration defines the exact system-route rewrites, function timeout, bundle inclusion, and daily retention cron at `0 3 * * *`.

The implemented composition and lifecycle deepening seams are documented in [`api-architecture-deepening.md`](api-architecture-deepening.md).

## Environment boundaries

API runtime configuration is server-only:

- `DATABASE_URL`: pooled PostgreSQL URL used by runtime traffic;
- `DIRECT_URL`: controlled Prisma migration/admin URL only;
- `PROXY_SECRET`, authentication secrets, `TURNSTILE_SECRET_KEY`, SMTP values, and `CRON_SECRET`: API-only secrets;
- `WEB_ORIGIN` and `AUTH_APP_ORIGIN`: exact configured origins;
- `SMTP_PORT`: only 465 or 587; port 25 is prohibited.

Web receives only `API_ORIGIN`, `API_PROXY_SECRET`, browser configuration, and the verification subset it already requires. Web and native bundles never receive database URLs, SMTP credentials, authentication secrets, ciphertext, Vault keys, TOTP material, generated OTPs, or private keys.

Prisma generation uses a non-production placeholder `DIRECT_URL`; it never needs a live database. Migration generation/application/deployment, reset, resolve, and administrative operations remain separate and require explicit human approval for the target environment.

## Security and PII controls

- API responses default to `Cache-Control: no-store`.
- Request logs contain only an opaque request ID, method, route path without query string, status, duration, and sanitized error/event types.
- Bodies, cookies, authorization headers, query values, email addresses, SMTP/database credentials, raw tokens, Secure Share material, ciphertext, and provider payloads are never logged.
- Browser `Referer` is not forwarded by the Web proxy.
- Secure Share Link secrets remain in client memory and are not sent in authentication requests, email URLs, server persistence, logs, analytics, or caches.
- The existing verifier query contract is preserved; infrastructure access logs must redact query strings.
- Runtime connection pools are capped at five connections per process/function instance.
- Provider retention for Vercel, Supabase, SMTP, backups, and monitoring is an operator responsibility and must be documented before production cutover.
- Retention responses expose only bounded counts, opaque job IDs, and backlog flags.

## Deployment targets

### Bun and self-hosting

The Docker runtime uses the pinned Bun image and `apps/api/src/bun.ts`. The migration image remains separate and uses `DIRECT_URL`; the API container receives only runtime configuration and `DATABASE_URL`. Compose starts Web only after the API health check. `docker/retention-purge.mjs` calls the authenticated API purge endpoint rather than importing Prisma.

### Node.js

`pnpm --filter @rhasia-scret/api build` generates Prisma Client with the placeholder URL and builds `apps/api/dist/node.js` plus its route/chunk files. Deploy the complete `apps/api/dist/` directory; copying only `node.js` omits required dynamic imports. The artifact runs with Node.js 24 and uses the same Hono application, SMTP composition, database pool, environment contract, and shutdown behavior as Bun.

### Vercel

The API is a separate Node.js Vercel project rooted at `apps/api`, configured by `apps/api/vercel.json`. Automatic Git deployments are enabled only for `main`; non-main branches do not create Vercel deployments. Its `ignoreCommand` compares the previous and current commits and skips `api-rhasia-scret` unless `apps/api` or a workspace package in the API dependency graph changed. Its build first validates the production `vercel` environment contract, then runs the package-owned Vercel build target; Prisma Client generation uses only the non-production placeholder URL from that target. The API is pinned to `sin1` to align with the production Supabase region recorded in the ignored production environment file; the provider dashboard and a temporary deployment remain required evidence. Exact `/v1/health` and `/v1/time` rewrites target their dedicated functions before the catch-all `/v1/**` rewrite. The Web Vercel project remains rooted at the repository root, enables the same `main`-only policy, and skips `rhasia-scret` unless `apps/web` or a workspace package in the Web dependency graph changed. Install metadata and deployment-filter configuration changes rebuild the affected service. API and Web secrets are configured in their respective projects; no API secret is placed in Web environment variables.

The API project must be validated on a temporary deployment before attaching `api.rhasia-scret.nooroctavian.id`. Vercel Cron calls `/v1/internal/retention-purge` at 03:00 UTC with `CRON_SECRET` authentication. An external or self-hosted scheduler may call the same endpoint.

## Rollout and rollback

1. Confirm the passwordless migration/schema verification remains valid; the current read-only verifier passes.
2. Run local adapter, build, environment, security, route-parity, and API/Web tests.
3. Build a synthetic-data deployment on a temporary API hostname.
4. Smoke-test health, time, database-backed routes, passwordless email/session flows, cookies, native bearer sessions, encrypted Vault workflows, Secure Share, retention authorization, cache headers, and log redaction.
5. Attach the production API domain and update Web/mobile API origins.
6. Monitor 5xx rate, latency, SMTP failures, database pool exhaustion, authentication failures, and purge backlog.
7. Preserve the previous API deployment until the stabilization period ends.
8. Roll back by restoring the previous deployment/origin if required. This hosting change adds no schema migration, so rollback does not require schema reversal.
9. Retire any remaining legacy Worker/Hyperdrive resources only after successful cutover and rollback validation.

## Verification contract

The repository implementation is considered locally verified only when all of the following have fresh evidence:

```bash
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run test:architecture
pnpm run build
pnpm run test:full
```

Additional evidence must cover:

- `SMOKE_API_ORIGIN=https://api.rhasia-scret.nooroctavian.id pnpm --filter @rhasia-scret/api smoke:deployment`, which verifies health, time, no-store headers, and unauthenticated retention rejection without sending a purge credential;
- Bun startup/shutdown and `/v1/health`;
- Node production artifact startup and `/v1/health`;
- Vercel path normalization, streaming, repeated cookies, and public `/v1/**` routing;
- API/Web environment isolation and deployment validation;
- SMTP TLS behavior on ports 465/587;
- no-store responses and sensitive-log redaction;
- retention authorization and scheduler failure behavior;
- route parity and encrypted-content/client-only invitation boundaries;
- temporary-host deployment and Chromium/browser, mobile API, and proxy smoke tests when provider access is available.

The latest repository evidence includes a passing `mise exec -- pnpm run test:full` gate, Chromium smoke/encrypted/PWA coverage, mobile JavaScript and Expo Doctor verification, and the adapter, proxy, route-parity, validation, security, and logging checks listed above. Repository tests do not prove a live deployment. No migration or production cutover has been performed. If approved database state, provider credentials, Vercel access, or deployment authority is unavailable, record the exact blocker and stop before claiming deployment completion.
