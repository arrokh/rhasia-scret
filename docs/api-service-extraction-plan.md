# Standalone API service and deployment plan

## Objective

Run `apps/api` as a standalone Hono service with Bun as the primary runtime and Node.js compatibility for Vercel and other hosts. The implementation removes the Cloudflare Worker and Hyperdrive deployment path while preserving the `/v1/**` API contract, authentication behavior, encrypted-content boundary, shared SMTP delivery, and client-only invitation secrets.

## Current status — 2026-09-18

The repository implementation is complete and locally verified. Bun, generic Node.js, and Vercel adapters, environment isolation, deployment validation, PII controls, and the provider-neutral deployment smoke check are implemented. The passwordless migration verifier passes against the already-approved database state; no migration operation was run.

Live deployment, production-domain cutover, provider monitoring, and rollback evidence remain blocked until Vercel/provider access and deployment authority are supplied.

Production origins:

- Web: `https://rhasia-scret.nooroctavian.id`
- API: `https://api.rhasia-scret.nooroctavian.id`

Cloudflare Turnstile remains an API integration. It is not a runtime-hosting dependency.

## Runtime architecture

`apps/api/src/app.ts` remains the canonical Hono application. Runtime adapters compose the application with process configuration and a bounded Prisma client:

| Adapter        | Entry point                 | Role                                                                  |
| -------------- | --------------------------- | --------------------------------------------------------------------- |
| Bun            | `apps/api/src/bun.ts`       | Local development, Docker, and primary self-hosted/production runtime |
| Node.js        | `apps/api/src/node.ts`      | Generic Node.js host using `apps/api/dist/node.js`                    |
| Vercel Node.js | `apps/api/api/[...path].ts` | Separate API Vercel project                                           |

`apps/api/src/standalone.ts` creates the API bindings, SMTP senders, and one process-scoped Prisma client from `DATABASE_URL`. Request handling never reads `DIRECT_URL`, receives no Hyperdrive binding, and does not expose database connection strings in request context.

The Vercel adapter normalizes `/api/**` function paths back to canonical `/v1/**` paths, preserves request bodies and query strings, and uses the Hono Node listener so response headers and repeated `Set-Cookie` values are retained. `apps/api/vercel.json` defines the `/v1/**` rewrite, function timeout, and daily retention cron at `0 3 * * *`.

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

`pnpm --filter @rhasia-scret/api build` generates Prisma Client with the placeholder URL and builds `apps/api/dist/node.js`. The artifact runs with Node.js 24 and uses the same Hono application, SMTP composition, database pool, environment contract, and shutdown behavior as Bun.

### Vercel

The API is a separate Node.js Vercel project rooted at `apps/api`, configured by `apps/api/vercel.json`. Its build first validates the production `vercel` environment contract, then runs the package-owned build script; Prisma Client generation uses only the non-production placeholder URL from that script. The Web Vercel project remains rooted at the repository root and deploys only Web. API and Web secrets are configured in their respective projects; no API secret is placed in Web environment variables.

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

Repository tests do not prove a live deployment. No migration or production cutover has been performed. If approved database state, provider credentials, Vercel access, or deployment authority is unavailable, record the exact blocker and stop before claiming deployment completion.
