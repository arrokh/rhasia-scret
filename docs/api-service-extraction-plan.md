# API service extraction and Cloudflare Workers migration plan

**Status:** Implementation complete — final verification and deployment-input gates remain
**Review state:** The service-owned backend layout and row-level route manifest are implemented. Final verification must still provide fresh evidence for every ownership, route, runtime, security, and deployment gate before release or merge.
**Proposed parent issue:** Extract the application API into a Hono Cloudflare Worker and remove Next.js API ownership
**Scope:** `apps/api`, `apps/web/src/app/api`, server-side application composition, Prisma persistence ownership, web/native API transport, and deployment configuration

## 1. Goal

Create a separately deployable `apps/api` service implemented with Hono and deployed to Cloudflare Workers at:

- Web: `https://rhasia-scret.nooroctavian.id/`
- API: `https://api.rhasia-scret.nooroctavian.id/`

Move the implementation of every current `apps/web/src/app/api/**/route.ts` endpoint into the Hono service. The API service owns the canonical versioned `/v1/**` routes with no `/api` prefix. Browser clients continue using thin same-origin `/api/v1/**` proxy URLs on the web origin; the proxy strips the web-only `/api` segment before forwarding to the API's `/v1/**` route. Native clients and web SSR call the API origin directly at `/v1/**`. There is no unversioned target alias.

After the migration, `apps/web` must have no Prisma dependency, database connection, or direct backend-module import. Web SSR/page composition will call API read endpoints through a small server-side API gateway. Hono routes, server domain/application logic, Prisma schema, generated client ownership, database factories, and repositories will be owned by `apps/api`, with Cloudflare and Bun runtime adapters sharing that service code. Web composition does not import those backend modules.

There is no dual-production implementation, backward-compatibility period, or gradual production cutover in the implementation plan. Cloudflare is the production runtime and Bun is the supported self-hosted runtime adapter; local verification must prove the complete web-proxy-to-Worker path before production deployment.

## 2. Source material reviewed

The Hono documentation requirements were reviewed and are treated as implementation constraints:

- [Hono Stack](https://hono.dev/docs/concepts/stacks)
- [Hono best practices](https://hono.dev/docs/guides/best-practices)
- [Hono Cloudflare Workers getting started](https://hono.dev/docs/getting-started/cloudflare-workers)

Relevant repository architecture/security decisions were also reviewed:

- `CONTEXT.md`
- `docs/monorepo.md`
- `docs/shared-code-inventory.md`
- `docs/app-router-composition.md`
- `docs/self-hosting.md`
- `docs/retention-purge-operations.md`
- ADR-0004 honest-but-curious server threat model
- ADR-0023 server-only database access
- ADR-0039 provider-neutral identity
- ADR-0041 platform-neutral client ports
- ADR-0048 provider email delivery
- ADR-0049 self-managed passwordless authentication
- ADR-0050 installed-PWA passwordless handoff
- `docs/application-rate-limiting.md`
- `docs/authentication-configuration.md`
- `docs/sign-in-rate-limit-turnstile-plan.md`

Cloudflare/Prisma runtime feasibility was checked against the current Prisma and Cloudflare guidance:

- Prisma Cloudflare deployment guidance: <https://www.prisma.io/docs/orm/v7/prisma-client/deployment/edge/deploy-to-cloudflare>
- Cloudflare Hyperdrive + Prisma ORM: <https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/prisma-orm/>
- Hono Prisma examples: <https://hono.dev/examples/prisma>
- Hono Web Standards: <https://hono.dev/docs/concepts/web-standard>
- Cloudflare Workers testing: <https://developers.cloudflare.com/workers/testing/>
- Hyperdrive local development: <https://developers.cloudflare.com/hyperdrive/configuration/local-development/>

## 3. Hono rules this plan deliberately follows

### 3.1 Hono Stack

The API will use the documented Hono Stack:

- Hono for the HTTP route tree.
- Zod schemas for request and response boundary validation.
- `@hono/zod-validator` and `c.req.valid(...)` for JSON, path, query, and form validation, with a custom validation-error mapping that preserves the existing locale-independent error shape and never echoes secret/token fields.
- `apps/api` exports an inferred `AppType` from its declared route tree for API-internal tests. Initial web/native adapters use the client-safe `api-contract`/`api-client` packages; `hc` is deferred unless a separately generated, client-safe declaration can be checked against `AppType` without importing API runtime code.

The route type must be inferred from a declared app value. Route methods that participate in RPC inference will be chained rather than hidden behind an untyped controller registry.

### 3.2 Hono application structure

The API will be composed from route sub-applications with `app.route()`:

```text
apps/api/src/index.ts       Cloudflare Worker fetch/scheduled entry points
apps/api/src/bun.ts         supported self-hosted Bun adapter using the same route tree
apps/api/src/app.ts         Hono route tree and AppType export
apps/api/src/modules/*     Bounded domain modules and Hono routes
apps/api/src/middleware/* Typed transport/auth/error middleware
apps/api/src/platform/*    Cloudflare/Bun runtime composition
apps/api/src/persistence/* Prisma client/repository composition
packages/api-contract/src/* Client-safe schemas and generated/declared API types
packages/api-client/src/index.ts     Client-safe typed HTTP helpers
```

Route modules will define handlers directly after their path declarations. They will not introduce Rails-style controller classes or generic controller functions that lose path-parameter inference. If a reusable handler factory is genuinely necessary for dependency injection, it will use Hono's `createFactory().createHandlers()` pattern and retain the inferred route type.

The root Worker will use Module Worker mode:

```ts
export default {
  fetch: app.fetch,
  scheduled,
};
```

Cloudflare bindings will be typed through `wrangler types --env-interface CloudflareBindings` and accessed through `c.env`, not through `process.env` inside Worker request handling. The pinned `wrangler.jsonc` must explicitly declare the compatibility date, `compatibility_flags: ["nodejs_compat"]`, `HYPERDRIVE`, non-secret origin/config vars, and the cron trigger; secrets are provisioned separately with Wrangler and never committed.

### 3.3 Web Standards and HEAD behavior

API request and response handling will use standard `Request`, `Response`, `Headers`, `URL`, and `URLSearchParams` APIs. Node-only helpers currently used by the Next routes (`Buffer`, `node:crypto`, implicit global environment reads, and Next request/cookie APIs) must be replaced by Web Crypto/Web Platform adapters or isolated runtime adapters.

No dedicated `HEAD` handlers will be added. Hono automatically derives `HEAD` behavior from `GET`; reader and health routes will test both `GET` and `HEAD` where applicable.

## 4. Current-state assessment

The repository currently has:

- 43 Next route modules under `apps/web/src/app/api`, covering 59 existing path/method operations when methods and the shared-audit `GET` re-export are counted.
- All server application modules and Prisma repositories owned by `apps/web`.
- `apps/web/prisma/schema.prisma` and all migrations under the web app.
- A Node/Postgres Prisma client at `apps/web/src/shared/infrastructure/prisma-client.ts` using `@prisma/adapter-pg` and `process.env.DATABASE_URL`.
- A production-safe staged migration workflow: `pnpm prod:db:migrate` loads ignored `.env.prod`, requires interactive confirmation, builds the focused migration image, and runs it with `--no-deps`; development database startup, migration, and shutdown are separate confirmed commands.
- Browser clients using same-origin paths such as `/api/v1/vaults/...`.
- Native clients using `EXPO_PUBLIC_API_URL` and bearer-token transport, but still requesting the pre-versioned `/api/...` paths that must be updated to `/v1/...`.
- Browser and installed-PWA passwordless sign-in forms now render a localized Cloudflare Turnstile widget; the request route validates its one-time token before anonymous rate limiting and challenge creation. Native requests remain widget-free.
- Passwordless browser sessions represented by HttpOnly cookies and native sessions represented by bearer credentials in native secure storage.
- Shared Vault invitation and re-invitation creation now receives a client-side `SecureShareLinkDeliveryPort`; the browser opens a localized `mailto:` draft or offers a copy fallback while the Secure Share Link secret remains client-held and never reaches an application endpoint.
- The authentication-completion channel waits up to 15 seconds for a backgrounded browser tab to return the invitation secret, rather than assuming immediate cross-tab delivery.
- Web-only OIDC callback routes and page middleware outside `app/api`.
- Web SSR pages that still directly load database-backed page context and recovery eligibility.
- Nodemailer/SMTP email delivery in the Worker must be validated under the pinned `nodejs_compat` runtime rather than assumed from Node-based tests.
- A Vercel cron entry for the pre-versioned `/api/internal/retention-purge`, which becomes `/v1/internal/retention-purge` in the API service.

The migration therefore is not a mechanical conversion from `NextResponse` to `c.json()`. It requires explicit runtime ports for request context, cookies, authentication, database construction, email delivery, scheduling, and response-cookie forwarding.

## 5. Recommended target architecture

### 5.1 Workspace layout

The recommended ownership is:

```text
apps/
  api/                                  # Cloudflare Worker entry point and bindings
    src/
      index.ts                          # Cloudflare fetch and scheduled entry points
      bun.ts                            # self-hosted Bun HTTP adapter, no duplicate routes
      app.ts                            # Hono root and AppType
      modules/<context>/                # domain/application/transport/infrastructure
      middleware/                       # typed auth, CORS, error middleware
      platform/                         # Cloudflare/Bun bindings and adapters
      persistence/                      # Prisma client/repository composition
    wrangler.jsonc
    prisma.config.ts                   # API-owned schema, migrations, and DIRECT_URL config
    vitest.config.ts
    scripts/                            # migration/admin/test tooling; never Worker imports
    Dockerfile                         # pnpm-built, pinned Bun runtime and controlled migration targets
    package.json

  web/                                  # Next.js presentation + same-origin proxy
    src/app/api/[...path]/route.ts      # generic proxy only
    src/app/...                         # pages and non-API Next conventions
    ...

packages/
  api-contract/                         # client-safe schemas and API types
    src/index.ts

  api-client/                           # web/mobile HTTP adapters
    src/index.ts                         # no server runtime imports

  client-vault-core/                    # existing platform-neutral client workflows
```

`apps/api` owns the Hono route tree, server domain/application logic, Prisma persistence, migrations, runtime adapters, and deployment. Its modules must not import Next.js, React, Expo, browser APIs, or client-only crypto/TOTP code. The Worker and Bun entrypoints use the same bounded domain modules, with no duplicate endpoint implementations. The Worker entry must not statically import the Bun adapter or Bun/Node-only dependencies; migration SQL/assets must also stay out of the request bundle. Bundle inspection must prove both are excluded from the Worker artifact. `apps/web` owns Next.js composition, browser presentation, and the same-origin proxy; it does not connect to the database or import API internals.

Only genuinely cross-application client code is placed in `packages/`: `api-contract` contains client-safe schemas/types, `api-client` contains web/mobile HTTP adapters, and `client-vault-core` remains the platform-neutral client workflow package. Keep one root `pnpm-lock.yaml`, pin versions through the existing workspace policy, and add a build check that API persistence is absent from browser/native output. Web/mobile must not import `apps/api` source directly; workspace-package and backend-source visibility is enforced by dependency-cruiser/architecture tests and package exports.

#### 5.1.1 Self-hosted deployment adapter

The current main branch still supports Docker/Node self-hosting with a web-owned Prisma migration image. Its database safety contract is now explicit: `pnpm dev:db` only starts the local database, `pnpm dev:db:migrate` separately requires interactive confirmation, and `pnpm prod:db:migrate` loads ignored `.env.prod`, requires confirmation, uses the focused migration image, and runs with `--no-deps` so it cannot start the Compose-local database.

The target self-host runtime is Bun. Bun is a runtime choice here; the monorepo continues using mise-managed Node/pnpm and the single root `pnpm-lock.yaml` for development and dependency installation unless the owner explicitly changes that repository-wide policy. The supported self-hosted deployment must run the same Hono route tree in `apps/api` through `apps/api/src/bun.ts` using `Bun.serve({ fetch: app.fetch, ... })` (or Bun's documented default-export convention) behind the self-hosted web proxy, keep Postgres access through a Bun-compatible `apps/api` persistence factory, read Bun environment variables only at that adapter boundary, and keep the API port private to the Compose network unless native/external clients require a separately protected public API origin. The self-hosted API adapter is a runtime adapter, not a second business implementation. Its existing controlled retention scheduler container calls the bounded authenticated HTTP endpoint; Cloudflare production alone uses `scheduled()`. Removing this Bun deployment requires an explicit breaking-support decision before implementation.

Update Compose/Docker deployment order to start the API, run controlled persistence migrations separately, then start web with an internal `API_ORIGIN`. Move the current `migrate` stage to an API-owned migration image/target, use a pinned `oven/bun` image for the self-hosted API, install/build dependencies with pnpm in the build stage, and use Bun only to run the built service and its explicitly supported tooling. Remove `DATABASE_URL`, `DIRECT_URL`, SMTP, and email-provider secrets from the web service, give the Bun API its runtime database/email settings, point API health checks at the Bun service and web health checks through the proxy, and point `docker/retention-purge.mjs` at the API service rather than web. If self-hosting is intentionally removed instead, record that as an explicit breaking support decision and update the support matrix before implementation; it must not happen accidentally because web no longer has Prisma.

### 5.2 Persistence boundary

The API service owns persistence; no separate database HTTP service is introduced:

- Move the Prisma schema and migrations from `apps/web/prisma` and `apps/web/prisma.config.ts` to `apps/api/prisma` and `apps/api/prisma.config.ts` without changing migration contents or database history. Preserve the migration directory and checksums exactly.
- Move the Prisma client construction, generated output, `Prisma*Repository` implementations, and server integration tests under `apps/api/src/persistence` and the relevant domain modules. Select and pin one compatible generated-client strategy (`prisma-client` output or `prisma-client-js` with driver adapters/engine disabled as supported), update all imports, and prove it under the pinned Prisma/Wrangler/Bun versions.
- Move API-owned administration and database verification tooling out of `apps/web/scripts`, including `admin-prisma-client.ts`, `deploy-passwordless-migrations.ts`, migration preflight/seed/verification scripts, `verify-prisma-connections.ts`, and `verify-test-database.ts`. Rewire root/API package scripts and Docker migration commands to those new paths; preserve the current confirmed `dev:db:migrate` and `prod:db:migrate` entrypoint behavior, ignored `.env.prod` production inputs, focused migration image, and `--no-deps` production isolation. These tools may use `DIRECT_URL` only from controlled migration/admin/test processes. Remove direct Prisma, `@prisma/*`, `pg`, migration, and database-test dependencies/scripts from `apps/web/package.json` and add them only to `apps/api` where required.
- Inventory and relocate web Prisma test fixtures, mocks, architecture assertions, path aliases, generated-client references, and `apps/web/src/tests/browser/support/e2e-database.ts` so the web package/test graph is database-free. Browser setup may use API-owned persistence/test-admin tooling, but browser tests must exercise application data through the web/API path rather than a web-bundled database helper.
- Keep domain/application code in `apps/api/src/modules/<context>/{domain,application}` and transport/infrastructure in the same bounded context. Preserve transaction scopes, unique/conflict handling, cascade behavior, optimistic revision checks, and bounded batch semantics; add concurrency tests for mutations, membership/lifecycle changes, session rotation/revocation, and retention.
- Use Cloudflare Worker composition with a Hyperdrive connection string through `@prisma/adapter-pg`/`pg` and the current `nodejs_compat` compatibility flag syntax. A request dependency scope owns the Worker adapter/client, registers deterministic cleanup through the execution context, and never retains user/session state; the implementation must document the exact pool/client size and cleanup path. Bun owns one process-scoped compatible Postgres pool/client, closes it on graceful shutdown, and never shares it with the Worker bundle. Test connection reuse/leak behavior, concurrent requests, transaction read-your-writes, and stale-read behavior under the pinned runtimes. Configure the production Hyperdrive binding with query caching disabled by default for authentication/session/challenge, authorization, revision, and read-after-write data; only enable caching for explicitly safe data on a separately proven path.
- Keep Prisma CLI/migration administration outside the Worker request path and continue requiring `DIRECT_URL` for controlled migration/admin tooling. Preserve the current safety model when relocating it: production migration consumes ignored `.env.prod`, requires an interactive `yes`, builds the focused migration image, uses `--no-deps`, and does not start the Compose-local database; development startup, migration, and shutdown remain separate confirmed operations. The web image must not run migrations or need `DIRECT_URL` after extraction; remove its current Prisma build/migration stages and build-only database placeholders. Migration tooling runs from the API-owned persistence area under explicit human authority, and self-hosted retention tooling must call the bounded API operation rather than import web Prisma.

This makes the API the only request-time database owner while keeping all backend implementation inside the service boundary. It avoids adding a third network service and its own authentication/security surface.

Cloudflare/Prisma feasibility is a release gate, not an assumption. Prisma's current Cloudflare guidance documents `@prisma/adapter-pg` and `pg` for traditional PostgreSQL, while Cloudflare documents Hyperdrive and `nodejs_compat` for Worker database access. The plan must prove the exact current Prisma version, generated client configuration (`--no-engine`/driver-adapter output as appropriate), adapter, transaction behavior, bundle size, and Hyperdrive setup before production deployment. This source move alone must not run or generate a database migration.

### 5.3 API route composition

The API service uses the explicit `v1` segment at its origin, so the canonical API contract uses `/v1/**`:

```text
https://api.rhasia-scret.nooroctavian.id/v1/health
https://api.rhasia-scret.nooroctavian.id/v1/vaults/...
```

The web origin retains `/api/v1/**` only as its same-origin browser proxy boundary:

```text
https://rhasia-scret.nooroctavian.id/api/v1/health
  -> https://api.rhasia-scret.nooroctavian.id/v1/health
```

Suggested Hono route groups under the version root:

```text
/v1/auth
/v1/passkey-recovery
/v1/personal-vault
/v1/shared-vaults
/v1/vaults
/v1/secure-share-links
/v1/user-crypto-profile
/v1/user-encryption-identity
/v1/vault-imports
/v1/sync
/v1/me
/v1/health
/v1/time
/v1/internal
```

Each group is a Hono sub-app mounted with `app.route()`. Domain code stays grouped by bounded context inside `apps/api/src/modules`, for example:

```text
apps/api/src/modules/vault-membership/
├── domain/
├── application/
├── infrastructure/
└── transport/                 # Hono route handlers and validators
```

The `transport` layer maps HTTP to application use cases; it must not contain Prisma queries or domain policy. `infrastructure` owns repository implementations and adapters for that context. The route tree will retain existing HTTP methods, statuses, locale-independent error codes, body shapes, cache behavior, ETags, and encrypted payload encoding unless an explicit approved contract change is recorded; the canonical API path is `/v1/**`, while the web-only browser proxy path is `/api/v1/**`. One read operation is intentionally added to replace a web-only Prisma page read: `GET /v1/personal-vault/destructive-reset` returns the existing recovery eligibility shape (`passkeyRecoveryEnrolled`, `activeOwnedSharedVaults`, and `activeOwnedSharedVaultIds`) with permitted metadata only.

The public route tree is a declared `const app = createApiApp()` value in `apps/api/src/app.ts`, mounted under `/v1`, with a typed Hono environment/dependency context, so `AppType = typeof app` remains stable and RPC-inferable. Worker middleware constructs request-neutral use-case/repository dependencies from typed `c.env`/request context, including a request-scoped Hyperdrive Prisma client, and disposes the scope using the Worker execution context where required. The `scheduled()` entry point constructs the same dependency graph directly from `env`/execution context rather than requiring an HTTP loopback. Isolated Hono tests install a typed test dependency context. No route module may create a module-global Prisma client, read `process.env`, or retain user/session state across requests. The root app defines `onError`/`notFound` mappings to the existing locale-independent error contract, includes a request ID in safe responses/logs, and never serializes unknown exception messages or causes.

### 5.4 Typed API contract and client boundary

`apps/api/src/app.ts` exports the inferred `AppType` for API-internal tests and server entrypoints. Web and mobile must not import `apps/api` or its private source, because the repository forbids app-to-app dependencies. Instead:

- `packages/api-contract` owns client-safe request/response schemas and types. API routes import these schemas for `zValidator`/response mapping, and client code imports only this package.
- `packages/api-client` owns web/mobile adapters for the existing platform-neutral `AuthenticatedTransport`: web requests target same-origin `/api/v1/**` proxy paths with browser cookies, native requests target the API origin with bearer credentials and `/v1/**` paths, and server SSR uses a fixed-origin fetch adapter with the proxy marker and `/v1/**` paths.
- The initial implementation uses typed `api-contract` fetch helpers as the normative client boundary. `hc` is permitted only after a separate app-independent declaration is generated from `AppType`, checked against the route tree in CI, and proven not to import or bundle `apps/api`; it must not be an unresolved implementation choice.
- `api-contract` owns the request/response schemas, locale-independent error codes, status/body discriminants, and encrypted-byte encodings needed by clients. API handlers validate incoming requests with `zValidator` and construct only schema-conforming responses; contract tests parse every success/error response. `api-client` owns transport and response parsing; it must not retain credentials, decrypted content, or sensitive payloads in caches. New client calls must use this boundary rather than duplicating untyped path/response definitions.
- `api-contract` and `api-client` contain no server runtime imports, Prisma, bindings, secrets, or crypto implementation. Add compile-time and dependency-graph tests proving client packages cannot import `apps/api`, Prisma, `pg`, API persistence, or client-secret/crypto implementations.
- API code may use only explicitly approved, platform-neutral policy/type subpaths from `client-vault-core` (currently deterministic Shared Vault permission policy/types and encrypted offline-bundle contracts). It must not import the package root or any crypto, decryption, archive-opening, OTP, QR, or client-storage implementation; add package export and bundle tests for this rule.

This preserves Hono's inferred route type inside the API while maintaining a genuinely reusable, client-safe package boundary.

## 6. Authentication, cookies, CORS, and proxy design

### 6.1 API authentication must be request-based

The current auth implementation depends on Next cookie/request APIs (`next/headers`, `cookies()`, and Next request types). It must be refactored into request-neutral ports:

- Parse `Authorization` and `Cookie` from a standard `Request`/Hono context.
- Use Hono cookie helpers or a small Web Standards cookie adapter for read/set/delete behavior.
- Pass request context explicitly into session verification and session termination.
- Define one credential-selection rule: a valid bearer credential is used for native requests, browser cookie credentials are used only for authenticated proxy requests, and a request containing both credential forms is rejected when they resolve to different sessions. Any malformed supplied credential rejects the request instead of falling back to another credential. Never silently let one credential override a conflicting credential.
- Define body-credential rules per authentication operation: native refresh accepts `refreshToken` only with the validated `client: "mobile"` discriminator; browser refresh uses the proxied browser session and must reject an unexpected body refresh token; PWA publication accepts its transient refresh credential only on the publisher path. If a body credential and cookie/bearer credential coexist, reject mismatches and test the matching and conflicting cases.
- Keep provider-neutral `Verified Principal`, assurance levels, application admission, refresh rotation, replay detection, and rate-limit semantics unchanged.
- Store no raw tokens, secrets, Vault keys, OTPs, plaintext TOTP configuration, or decrypted content in logs or persistence.

Hono middleware should set typed context variables such as the verified principal and application user. Protected route handlers should use route-scoped auth middleware and direct handlers rather than repeating untyped authorization plumbing.

### 6.2 Passwordless and browser-cookie behavior

The API remains the owner of passwordless challenge/session persistence. Browser passwordless requests use the web's same-origin `/api/v1/**` URLs, which the web proxy maps to the API's `/v1/**` routes. Native and SSR requests use the API origin directly at `/v1/**`. The API's session-revoke handler must accept the existing native bearer credential or the forwarded browser access/assertion cookies according to the credential-selection rule above; revocation is idempotent so logout still succeeds when no current session can be verified. Tests must cover missing credentials, malformed credentials, both matching credentials, both conflicting credentials, expired credentials, and repeated revocation.

The proxy must forward the incoming browser `Cookie` and `Authorization` headers to the API and must replay every upstream `Set-Cookie` header onto the web response. This is required for:

- Magic-link redemption.
- Browser access/refresh/assertion cookies.
- Refresh rotation.
- PWA handoff polling and cookie issuance.
- Logout/revocation cleanup.
- OIDC session-cookie interoperability if the web callback remains web-owned.

Cookies must remain host-only unless an explicit security decision says otherwise. The API must not accidentally issue an API-host cookie that the browser cannot use on the web host. When a response passes through the web proxy, a host-only `Set-Cookie` from the proxied response is interpreted by the browser as a web-origin cookie. The implementation must test this with real browser requests rather than relying only on `Headers` unit tests.

The proxy must preserve cookie attributes (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and expiry/max-age). It must support multiple `Set-Cookie` values without comma-folding them into one invalid header.

### 6.2.1 Passwordless sign-in abuse controls

The current passwordless sign-in flow has two ordered abuse-control layers. The web and installed-PWA forms render a visible, localized Cloudflare Turnstile widget using the public `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; native clients do not render the widget or send a Turnstile token. The API validates browser/PWA tokens server-side against Cloudflare's `siteverify` endpoint before consuming an anonymous rate-limit bucket or creating a magic-link challenge. The token and provider response are transient and must never be persisted or logged.

After request-shape and origin validation, the API must preserve this order: Turnstile validation, PostgreSQL-backed anonymous rate-limit decision, then passwordless challenge creation/email delivery. Missing or malformed browser tokens and rejected tokens return generic no-store `403` errors (`turnstile_failed`); Turnstile transport/provider failures return no-store `503` with `turnstile_unavailable` and `Retry-After: 5`; limiter failures return `rate_limit_unavailable` with the same bounded retry response. Exhausted email/IP buckets continue to return generic no-store `429` responses. None of these responses may disclose account existence.

`TURNSTILE_SECRET_KEY` belongs only to the API Worker/Bun runtime and must never be exposed through browser or native configuration. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` belongs to the web presentation runtime. Production configuration must reject Cloudflare's always-pass testing keys; local verification may use the documented testing pair. The web CSP and `apps/web/src/proxy.ts` security policy must allow `https://challenges.cloudflare.com` in `script-src`, `script-src-elem`, `connect-src`, and `frame-src` without broadening other origins.

### 6.3 CSRF and trusted proxy transport

The API will not blindly trust arbitrary forwarded-origin headers. The transport design should be:

1. The web proxy validates same-origin requirements for browser state-changing requests before forwarding: accept only the configured web origin (and fail closed when a cookie-authenticated mutation has no verifiable same-origin signal), ignoring untrusted forwarded-host/proto metadata.
2. The proxy sends a private, authenticated service-to-service marker/header to the API.
3. The API accepts the original web origin only when the proxy marker is valid, and validates direct requests carrying an `Origin` against the configured allow-list. It must not accept an arbitrary `X-Forwarded-Origin` value merely because it is present.
4. Mobile bearer-token requests remain supported without requiring browser cookies.
5. The proxy marker is stored as a server secret and is never exposed to browser JavaScript or native clients.

Define a request-neutral client-IP port for rate limiting. Cloudflare direct traffic uses the platform-provided client IP; the web proxy strips client-supplied forwarding headers and sends a canonical client IP only when its trusted proxy marker is valid; the API never trusts arbitrary `X-Forwarded-For`/`X-Real-IP` values. Self-hosted Bun uses an explicitly configured trusted reverse proxy. Preserve the existing IP/email rate-limit semantics and test spoofed forwarding headers.

Use a high-entropy `X-Rhasia-Proxy-Secret` shared secret over TLS for the first implementation. The web proxy validates the incoming browser `Origin`/host and sends the marker; the API compares it with a Worker secret and strips/replaces any client-supplied copy before authorization. It must not be confused with a user credential, and it must not be logged. A signed assertion is unnecessary unless deployment topology later prevents secure secret distribution.

### 6.4 CORS

The API is a separate origin, so its CORS policy must be explicit:

- Allow only the configured web origin and explicitly approved development origins when direct browser access is intentionally exercised.
- Never use `Access-Control-Allow-Origin: *` with credentials.
- Set `Vary: Origin` when reflecting an allowed origin.
- Allow only required public headers (`content-type`, `authorization`, conditional headers, and request-id when needed). Generate/replace request IDs at a trusted boundary and bound their length; never treat a client-supplied ID as trusted. Never expose or allow the private proxy-secret header to browser JavaScript.
- Expose only required response headers such as `etag` and synchronization metadata.
- Do not enable credentials for native bearer requests; browser session cookies use the same-origin proxy, not cross-origin CORS.
- Test rejected origins, preflight requests, direct-cookie rejection, and response-cookie behavior. Run proxy-trust/origin classification before route authorization; CORS handles direct browser preflights, while authenticated proxy requests are service-to-service and do not rely on CORS for trust.

The browser application should use same-origin `/api/v1/**` calls through the proxy; it should not be changed to expose secrets or session cookies to cross-origin JavaScript merely to avoid the proxy. Validate `API_ORIGIN` as an absolute `https:` origin in production (only loopback `http:` in local development), with no path, query, fragment, userinfo, or attacker-controlled override.

### 6.5 OIDC and non-`app/api` auth routes

The requested migration names `apps/web/src/app/api`, but the repository also has Next routes under `apps/web/src/app/auth` and server-rendered auth/page composition:

- Keep the user-facing OIDC authorization/callback on the web origin for this migration. Keep OIDC client secrets server-only on web, issue the existing signed session cookie on the web origin, and make the API validate the same provider-neutral session contract using only the verifier configuration/signing secret it needs (never the OIDC client secret).
- Make `apps/web/src/app/auth/logout/route.ts` a thin web adapter: forward the request cookies and authenticated proxy marker to API session revocation, replay API cookie deletions, clear the web-owned OIDC cookie, and redirect. It must not construct a Prisma-backed terminator or contain revocation policy.
- Keep passwordless confirmation UI on the web, while challenge creation, redemption, session creation, rotation, revocation, and PWA handoff persistence run in the API. Preserve the current 15-second cross-tab BroadcastChannel verifier wait so a backgrounded invitation/sign-in tab can complete authentication without moving credentials through the channel.
- Ensure `PASSKEY_RP_ID` and `PASSKEY_ORIGIN` remain the web origin/RP values even though the HTTP implementation is hosted at the API origin.
- Remove all direct web database access, including SSR auth/page loaders; see section 11 for the explicit API bootstrap calls that replace it.

OIDC ownership is split deliberately: web retains `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, provider authorization/callback code, and the web-side `AUTH_BACKEND` selection. The API receives only the values needed to validate the signed web session and admission (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, optional `OIDC_AUDIENCE`, `OIDC_SESSION_SECRET`, and the admitted-principal policy); it never receives the OIDC client secret or performs the provider callback. Web and API must use the same session-secret value and issuer/audience contract, verified by a configuration test without logging either value. Split the web configuration reader so `apps/web/src/proxy.ts` can verify browser assertions with only its verifier settings; it must not require API-only challenge, database, passkey-verification, or email settings as a side effect of reading `AUTH_BACKEND`.

## 7. Cloudflare Worker runtime adaptations

The API migration must inventory and replace Node/Next assumptions before moving routes:

- Replace `process.env` reads in Worker code with typed `c.env` bindings/configuration passed into factories. The Worker must use a `HYPERDRIVE` binding for request-time Postgres access and must never receive `DIRECT_URL`.
- Replace Next `Request`/`NextRequest`/`NextResponse`/`cookies()`/`headers()` with Web Standards and Hono context.
- Replace `Buffer` conversions with a shared Web-compatible base64/byte adapter, or isolate the adapter behind a runtime-neutral port.
- Replace `node:crypto` operations with Web Crypto where possible: random values, HMAC/SHA-256, digest comparison, and token generation.
- Move the server-side Cloudflare Turnstile validator with the passwordless request route into the API. The Worker/Bun runtime receives only `TURNSTILE_SECRET_KEY`; the web retains the public site key for its localized browser/PWA widget. Keep the 5-second verification timeout, token-size/safety validation, fail-closed result classification, and validation-before-rate-limit ordering.
- Keep the web-owned OIDC authorization/callback dependency (`openid-client`, if retained) out of the Worker bundle; verify only Worker-imported crypto/WebAuthn modules such as `jose` and `@simplewebauthn/server` under the exact compatibility date. Do not rely on Node compatibility flags as proof that every Node package works.
- Use the same approved Nodemailer/SMTP email delivery adapter for Bun, self-hosted, and Cloudflare Worker runtimes. The Worker must use `nodejs_compat`, `no_throw_on_not_implemented_tls_options`, SMTP submission ports such as 465/587, and Worker-runtime integration evidence; port 25 remains unavailable and certificate validation remains enabled.
- Keep email action URLs anchored to the web origin, not the API origin.
- Ensure error and operational logging never includes request bodies, cookies, authorization headers, raw magic-link tokens, secure-share material, email action fragments, or ciphertext bytes.
- Check Worker bundle size and CPU/subrequest limits, especially with Prisma, WebAuthn verification, and all route modules bundled together.
- Configure `compatibility_flags: ["nodejs_compat"]` in `wrangler.jsonc` (or the exact equivalent emitted by the pinned Wrangler version), generate the driver-adapter Prisma client without a query engine where supported, and verify the resulting bundle rather than treating a legacy `node_compat` spelling as sufficient.
- Document local `wrangler dev` with `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (direct test DB; no Hyperdrive pooling) and a separately controlled `wrangler dev --remote` smoke test (real Hyperdrive; test DB only).

## 8. Email delivery decision

The current implementation creates Nodemailer SMTP transport in `apps/web`; the extraction moves that adapter into the API's shared SMTP composition without changing the SMTP contract for self-hosted/local development. The shared `MagicLinkEmailSender` port keeps challenge creation independent from delivery. Bun, self-hosted, and Cloudflare Worker compositions use the same Nodemailer adapter; Worker SMTP requires `nodejs_compat`, `no_throw_on_not_implemented_tls_options`, and a supported submission port without disabling certificate validation.

The API owns challenge creation and authorization. Every API runtime sends the already-validated action URL through `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, `AUTH_EMAIL_FROM`, and `AUTH_EMAIL_FROM_NAME` using the same Nodemailer implementation. SMTP responses and delivery diagnostics remain server-only and are redacted from logs. The adapter uses bounded delivery behavior and does not automatically retry unless the provider supports idempotency, so retries cannot silently send duplicate magic links. Existing bilingual templates remain under the API identity module and preserve web-origin action URLs; keep both English/Indonesian template variants and their parity tests, without placing secrets or user Vault data in templates/logs.

All API operators must provide the shared SMTP configuration; Worker deployments must use `nodejs_compat` and a supported SMTP submission port. Browser test composition supplies synthetic SMTP settings and never uses a real mail server. Update ADR-0048 and the authentication configuration documentation to record the shared SMTP contract and Worker-runtime verification. No SMTP package or SMTP secret remains in `apps/web`; the API Worker intentionally bundles the server-only SMTP adapter.

### 8.1 Secure Share Link delivery remains client-only

The latest Shared Vault invitation flow uses the platform-neutral `SecureShareLinkDeliveryPort`. The browser delivery adapter opens a localized `mailto:` draft containing the one-time link, while the UI also offers a client-side copy fallback. This delivery effect is separate from passwordless authentication email: it must not use the API's SMTP adapter, must not send the Secure Share Link secret to the API, and must not persist or log the secret. Re-invitation uses the same fresh-secret and client-delivery path after an expired Invitation; the API receives only the verifier and encrypted key-handoff package permitted by the existing contract.

The extraction must preserve the current invitation/re-invitation UX, Indonesian/English email subject/body catalogs, client-only secret lifetime, and failure handling. The browser-facing invitation link remains anchored at the web origin, and any authentication-completion announcement needed by an open invitation tab remains a client-only cross-tab signal.

## 9. Retention purge and scheduled work

The current Vercel cron invokes a Next route. The Worker target should use Cloudflare's Module Worker `scheduled` handler and a Wrangler cron trigger. The trigger schedule is UTC and is configured only in the Worker deployment:

- Move retention composition and purge repositories into `apps/api` retention/persistence modules.
- Keep the existing bounded purge behavior and redacted report semantics.
- Use a scheduled event for production execution.
- Keep an authenticated HTTP endpoint only if local/manual operations need it; it must not be the primary scheduler.
- Remove or update the Vercel cron entry so production does not accidentally run both schedulers.
- Test duplicate/concurrent invocation behavior, bounded batches, failure logging, and backlog reporting.
- Make the scheduled use case idempotent/lease-safe so a retry or overlapping invocation cannot double-apply destructive work; retain the existing bounded batch and audit semantics.
- Keep `GET /v1/internal/retention-purge` for authenticated/manual diagnostics only, with the same authorization and redaction rules; do not let a public request trigger an unbounded purge. The web-facing manual path, when used, is `/api/v1/internal/retention-purge` through the proxy.

No migration command or database operation is authorized by this plan. Any generated/applied Prisma migration still requires explicit human confirmation under repository policy.

## 10. Web proxy implementation

After API behavior is available, replace the 39 concrete Next API route implementations with one recognized App Router catch-all route, for example:

```text
apps/web/src/app/api/[...path]/route.ts
```

The catch-all route will:

- Forward only `/api/v1/**` paths (including the exact versioned operations in the parity manifest); return a safe 404/410 for `/api` and unversioned `/api/**` requests rather than creating a compatibility alias.
- Accept the supported methods, including `HEAD` as a transport dispatch to Hono's derived behavior and `OPTIONS` where the browser contract requires it; reject unsupported methods consistently. `HEAD` adds no separate API business handler.
- Validate the incoming host/origin against the configured web origin for state-changing browser requests before forwarding; fail closed for cookie-authenticated mutations with a missing/unverifiable origin signal.
- Build the upstream URL from a validated fixed `API_ORIGIN` and the original versioned path/query; map the web-only `/api/v1` prefix to API `/v1` exactly once (never `/v1/v1`, `/api/v1/api/v1`, or an unversioned alias), and reject any request header or query value that attempts to select the upstream host.
- Forward only an explicit allow-list of end-to-end headers, strip any client-supplied `X-Rhasia-Proxy-Secret`, and add the server-held marker.
- Forward request bodies as streams where supported; do not log or unnecessarily materialize sensitive bodies. Route-specific body/decoded-byte limits remain enforced by the API validator/use case, with proxy and Worker transport limits tested so the proxy does not silently truncate or impose an incompatible lower limit. If Node `fetch` requires it for a streamed request body, set `duplex: "half"` and test abort/backpressure behavior.
- Forward cookies, bearer credentials, content negotiation, ETags, cache validators, and request origin as required by the API contract.
- Preserve the Turnstile-enabled web security policy: `next.config.ts` and `apps/web/src/proxy.ts` must allow `https://challenges.cloudflare.com` only for the Turnstile script, frame, and verification connection directives required by the browser/PWA widget.
- Copy status, response body, and an explicit safe response-header allow-list including `Content-Type`, `Content-Disposition`, `Location`, `WWW-Authenticate`, `Retry-After`, cache headers, ETag, `Vary`, synchronization headers, and every `Set-Cookie` header without comma-folding. API redirects must be relative or explicitly rewritten from the API origin to the web origin; never leak an unintended cross-origin redirect. Strip hop-by-hop/upstream-host headers. Use the runtime's multi-value header API (`Headers.getSetCookie()`/equivalent); pin the route to the Next Node runtime if the deployed runtime lacks that API, and add regression tests for binary/download responses and two or more cookies.
- Return a generic 502/504 response for upstream transport failure without leaking upstream internals; preserve API application errors unchanged.
- Use bounded timeout and cancellation behavior.
- Contain no Prisma import, domain use case, authorization policy, request validation, or business error mapping.

The existing Next route files must be deleted rather than left as alternate implementations. Architecture tests must reject new route-local implementations and reject imports from `apps/api`, Prisma, `pg`, or API business modules in the proxy.

## 11. Web SSR and page composition boundary

`apps/web` will have no database connectivity after extraction. Server-rendered pages remain server-rendered, but their data access goes through a small server-only API gateway in web infrastructure:

- The gateway calls the fixed `API_ORIGIN` directly from the Next server using `/v1/**`, never through the web catch-all route (which would create a loop).
- It forwards the incoming `Cookie`, `Authorization`, locale-independent request headers, and cancellation signal; it sends the same server-held proxy marker and canonical web origin as the catch-all proxy; it uses `cache: "no-store"` for authenticated data and a bounded timeout.
- It maps API transport failures to the existing safe page fallback/redirect behavior, never exposing upstream URLs or exception text.
- It validates the API response against the shared client contract, maps only safe API error codes to page behavior, and never logs response bodies or credentials.
- It does not import `apps/api`, Prisma, `pg`, or route implementations.

The SSR gateway calls `/v1/me` first, then `/v1/personal-vault` only after admission succeeds. The second call preserves the current idempotent `ensurePersonalVault` behavior. The page loader memoizes these calls per request, treats any transport failure or non-admitted result as the existing safe sign-in redirect, and never renders a partially loaded authenticated page. If `/me` succeeds but the Personal Vault read fails, the page returns the safe fallback rather than retrying through the Next proxy; bounded retry behavior, if added, is limited to the gateway and cannot duplicate a mutation. SSR contract tests cover each partial-failure combination and verify that no credentials or response bodies are logged.

Update the current consumers as follows:

- `load-vault-page-context.ts` calls `GET /v1/me` and `GET /v1/personal-vault` through the direct API gateway. An authenticated `/me` response is the admission result; inactive/unauthenticated API errors preserve the existing redirect behavior.
- `apps/web/src/app/sign-in/page.tsx` uses the gateway/auth contract rather than provisioning or reading users with Prisma. `apps/web/src/app/layout.tsx` retains only configuration-based backend selection and browser refresh composition; it must not acquire a database dependency.
- `apps/web/src/app/vaults/recovery/page.tsx` calls `GET /v1/personal-vault/destructive-reset` (the existing route module gains a read operation) through the direct API gateway for passkey-recovery eligibility and active-owned-shared-vault blockers. The response contains only permitted identifiers/metadata, never vault content or keys.
- `apps/web/src/app/auth/logout/route.ts` calls API session revocation as described in section 6.5 and remains a thin cookie/redirect adapter.
- Delete the web Prisma client, Prisma repositories, and web server-composition imports after all consumers are migrated. The web package must no longer declare Prisma, `pg`, or migration dependencies.

This keeps SSR and auth redirects intact while making the API the only request-time server application and persistence owner. Add SSR contract tests for cookies, redirects, inactive users, upstream failures, and recovery eligibility.

## 11.1 End-to-end data flow, local verification, and release

### Request paths

- Browser API call: browser → Next `src/proxy.ts` security middleware (no database/auth-policy ownership and no API redirect) → `apps/web/src/app/api/[...path]/route.ts` catch-all proxy → `https://api.rhasia-scret.nooroctavian.id/v1/...` → Hono `/v1` route in `apps/api` → domain/application use case → persistence/Hyperdrive → Hono response → proxy with status/body/headers/cookies → browser.
- Web SSR read: Next page/server gateway → fixed API origin with the incoming web cookie and authenticated proxy marker → Hono route → persistence → response. It must not call the Next proxy or import API persistence. The web `src/proxy.ts` page-gating verifier remains limited to signed browser/session claims and must not perform database access or duplicate API authorization.
- Native call: mobile `EXPO_PUBLIC_API_URL` → API `/v1/...` with bearer authorization → Hono route → persistence. Native does not receive or use web cookies.
- Scheduled purge: Cloudflare `scheduled()` → bounded retention use case in `apps/api` → persistence/Hyperdrive; no HTTP loopback and no Next runtime. Self-hosting uses the same bounded use case through the authenticated internal HTTP endpoint from its controlled scheduler container.

### Local verification

Use a disposable approved Postgres database. `wrangler dev` uses `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` for direct local connectivity; this does not exercise Hyperdrive pooling. Run a separate `wrangler dev --remote` smoke test only against a disposable remote test database. Also run the supported self-hosted Bun adapter through Docker/Bun against the same API contract and internal proxy path. Start the API Worker or Bun adapter and web dev server with local `API_ORIGIN`, `WEB_ORIGIN`, proxy-secret, and Turnstile values; use Cloudflare's documented always-pass testing pair only for local verification and confirm production rejects it. Run browser tests against the web origin, including the widget/token request path and invitation `mailto:`/copy effects. Run native integration tests against the same local API origin and verify native requests omit Turnstile tokens. No test may use production credentials or a production database.

The end-to-end matrix must cover health/time, passwordless request/redeem/refresh/revoke, Turnstile validation and failure ordering, PWA handoff, OIDC if enabled, passkey recovery, browser-cookie proxying, native bearer auth, personal/shared vault authorization, encrypted account payloads, audit redaction, ETags, offline bundle, import/export size limits, client-side Secure Share Link email/copy delivery, and scheduled/manual retention.

### Production cutover and rollback

1. Validate the Worker bundle, bindings, Hyperdrive test path, email adapter, cron configuration, required self-hosted Bun adapter, and API smoke tests.
2. Provision API secrets before traffic cutover, using the exact existing session/magic-link/OIDC signing values where continuity is required; do not rotate secrets as an incidental part of extraction, and never print them. Provision the real `TURNSTILE_SECRET_KEY` to the API and the matching public `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to the web; reject the local testing pair in production. Verify web/API secret agreement without exposing values.
3. Deploy the Worker/custom API domain and run unauthenticated and authenticated smoke tests using a disposable/test account.
4. Deploy web with the fixed API origin and proxy secret, then run browser proxy/auth smoke tests.
5. Update the mobile production API origin configuration and run the required native verification before release.
6. Inventory every supported/distributed mobile build's embedded `EXPO_PUBLIC_API_URL`. Because Expo embeds this value at build time, changing configuration does not update installed builds. If any supported build still targets the web origin, block the hard cutover until the owner explicitly approves that build's support removal and publishes the minimum supported version/forced-update communication; this plan does not add a compatibility proxy or dual production implementation.
7. Remove the old Vercel API route implementations and cron as part of the same change; there is no dual production implementation.

Because this extraction makes no schema change, rollback is an artifact/config rollback: restore the previous web/Worker artifacts and bindings, not a database rollback. If implementation discovers a required schema change, stop and obtain separate migration approval; do not hide it in this issue.

## 11.2 Documentation and configuration impact

Update the ownership and operational documents in the same implementation: `CONTEXT.md` if domain language changes; `docs/monorepo.md`; `docs/shared-code-inventory.md`; `docs/self-hosting.md`; `docs/retention-purge-operations.md`; `docs/application-rate-limiting.md`; `docs/authentication-configuration.md`; `docs/sign-in-rate-limit-turnstile-plan.md`; the authentication/SMTP ADRs and relevant auth configuration docs; `docs/app-router-composition.md` if proxy composition changes; `README.md`; `.env.example`; `docker-compose.yml`; `apps/web/Dockerfile`; `docker/retention-purge.mjs`; `vercel.json`; `pnpm-workspace.yaml` overrides (remove the unused `@hono/node-server` override; Bun uses `Bun.serve`); affected `tools/verify-*`/release scripts; CI/deployment workflows; and package READMEs. The docs must state that API persistence is Worker-owned, web SSR uses the API gateway, local Hyperdrive uses a direct disposable connection, production uses the API cron, the confirmed/focused migration workflow is preserved outside request handling, Turnstile protects browser/PWA sign-in before anonymous limiting, and no migration is part of this extraction.

The environment contract must name ownership explicitly and must be implemented as a checked configuration matrix:

- **Web runtime:** `AUTH_BACKEND`, the exact web-origin values needed by page composition, `API_ORIGIN`, `API_PROXY_SECRET`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, and the verifier settings required by `apps/web/src/proxy.ts` and the web-owned OIDC callback. For passwordless page gating this includes the browser-assertion verification secret `AUTH_SESSION_SECRET`; for OIDC this includes `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_SESSION_SECRET`. These verification secrets are intentionally shared with the API and must be tested for equality without logging them. Web retains `OIDC_CLIENT_SECRET` and `OIDC_REDIRECT_URI` exclusively for the provider callback. Web does not receive `DATABASE_URL`, `DIRECT_URL`, `HYPERDRIVE`, API persistence, passwordless challenge-creation/email settings, `TURNSTILE_SECRET_KEY`, or SMTP/email-provider credentials.
- **Cloudflare Worker:** `WEB_ORIGIN`, `PROXY_SECRET`, `AUTH_BACKEND`, `AUTH_APP_ORIGIN`, `AUTH_MOBILE_REDIRECT_URL`, `AUTH_MAGIC_LINK_SECRET`, `AUTH_SESSION_SECRET`, `TURNSTILE_SECRET_KEY`, passwordless TTLs, passkey settings, the OIDC verification subset (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, optional `OIDC_AUDIENCE`, `OIDC_SESSION_SECRET`, and admission policy), `HYPERDRIVE`, `CRON_SECRET`, and the shared SMTP settings. The Worker never receives `OIDC_CLIENT_SECRET` or performs the OIDC callback.
- **Self-hosted Bun API:** the same API authentication, origin, and SMTP contract as the Worker, including `TURNSTILE_SECRET_KEY`, `DATABASE_URL`, and the shared SMTP settings. Bun must never read web-only OIDC client credentials unless the explicit callback ownership changes through a new decision.
- **Migration/admin/test tooling:** the ignored `.env.prod` pooled `DATABASE_URL` and direct `DIRECT_URL`, plus any explicitly required verification URL; this tooling is not imported by either runtime request bundle.
- **Native:** `EXPO_PUBLIC_API_URL` and other public origin/callback values only; no server secret or credential.

Remove SMTP variables from web runtime/build configuration, retain them only in the explicit API runtime contract, keep secrets out of `NEXT_PUBLIC_*`/Expo public variables, validate production origins and SMTP settings, and add a configuration test that rejects missing, cross-assigned, or unexpectedly exposed variables. Preserve existing auth variable names only where they remain semantically correct, documenting the mapping during the one-time extraction.

## 11.3 Observability and troubleshooting

Worker logs use a request ID and bounded structured fields only: route group, method, status, duration, auth outcome code, dependency outcome code, and retention batch counters. Never include user identifiers, email addresses, cookies, authorization values, request/response bodies, Turnstile tokens, token fragments, Secure Share Link material, ciphertext, or provider payloads. Add counters/timers for 4xx/5xx by route group, upstream proxy failures, database/Hyperdrive latency and failures, email-provider and Turnstile latency/failures, auth rejection/replay, Worker CPU/subrequest limits, and retention backlog/failure.

Document alert thresholds and the owner/runbook for API availability, elevated auth failures, database failures, email delivery failures, and retention backlog. Include troubleshooting for: proxy 502/504 (origin/DNS/secret/timeout), rejected origin (configured web origin), missing cookies (Set-Cookie replay/host-only attributes), local database errors (Hyperdrive local-connection variable), remote Hyperdrive safety (disposable test DB), Worker bundle/runtime limits, and OIDC/passkey origin mismatch. Diagnostics must be safe to share and must not require dumping secrets or payloads.

## 12. Endpoint migration inventory

All 43 current route modules and their 59 current path/method operations must be represented in the Hono route contract and tested through the web proxy. The target adds the recovery-eligibility read (`GET /v1/personal-vault/destructive-reset`) and OIDC deletion-completion operation (`POST /v1/me/deletion/oidc/complete`), for 61 target business operations. Hono's implicit `HEAD` behavior is framework-derived and not included in that count; parity tests must record its expected status separately.

For each operation, maintain a parity row in the implementation/test inventory containing: source route, Hono path/method, input location/schema and size limit, auth assurance/admission/rate-limit policy, use case, repository/transaction boundary, response status/body/encoding, error codes, cache/ETag behavior, audit behavior, and browser/native/SSR transport coverage. The normative operation-level manifest is [`docs/api-service-extraction-route-parity.md`](api-service-extraction-route-parity.md); it must be completed with exact source/test references and contract values before child issues are created. A route is not considered migrated until its row and both relevant transport tests are complete. Mutation tests must include the response and a follow-up read where the existing contract permits it; import tests cover upload/decoded-byte limits and client-side consumption, while archive-export tests preserve the 204 audit side effect; update/delete tests verify revision/conflict behavior and affected cascades; one-time links verify consumption/replay; retention verifies bounded deletion and remaining backlog.

### Auth and system

```text
POST /v1/auth/magic-link/request
POST /v1/auth/magic-link/redeem
POST /v1/auth/pwa/session
POST /v1/auth/session/refresh
POST /v1/auth/session/revoke
GET  /v1/health
GET  /v1/time
GET  /v1/internal/retention-purge
GET  /v1/me
```

### Passkey recovery

```text
POST   /v1/passkey-recovery/registration/options
POST   /v1/passkey-recovery/registration/verify
POST   /v1/passkey-recovery/authentication/options
POST   /v1/passkey-recovery/authentication/verify
GET    /v1/passkey-recovery/status
DELETE /v1/passkey-recovery
```

### Personal vault, crypto profile, and imports

```text
GET    /v1/personal-vault
POST   /v1/personal-vault/initialize
GET    /v1/personal-vault/destructive-reset
POST   /v1/personal-vault/destructive-reset
GET    /v1/user-crypto-profile
POST   /v1/user-crypto-profile/rewrap
PUT    /v1/user-encryption-identity
POST   /v1/vault-imports
```

### Shared vaults, membership, accounts, and share links

```text
GET    /v1/shared-vaults
POST   /v1/shared-vaults
GET    /v1/shared-vaults/:vaultId
PATCH  /v1/shared-vaults/:vaultId
POST   /v1/shared-vaults/:vaultId/accounts
PATCH  /v1/shared-vaults/:vaultId/accounts
DELETE /v1/shared-vaults/:vaultId/accounts
PUT    /v1/shared-vaults/:vaultId/accounts
GET    /v1/shared-vaults/:vaultId/audit-events
POST   /v1/shared-vaults/:vaultId/audit-events
POST   /v1/shared-vaults/:vaultId/leave
DELETE /v1/shared-vaults/:vaultId/lifecycle
POST   /v1/shared-vaults/:vaultId/lifecycle
GET    /v1/shared-vaults/:vaultId/member-permissions
PATCH  /v1/shared-vaults/:vaultId/member-permissions
PATCH  /v1/shared-vaults/:vaultId/members/:userId
DELETE /v1/shared-vaults/:vaultId/members/:userId
GET    /v1/shared-vaults/:vaultId/participants
PATCH  /v1/shared-vaults/:vaultId/rotation
POST   /v1/shared-vaults/:vaultId/share-links
DELETE /v1/shared-vaults/:vaultId/share-links/:invitationId
GET    /v1/secure-share-links
POST   /v1/secure-share-links
```

### Personal vault accounts, audit, and sync

```text
GET    /v1/vaults/:vaultId/accounts
POST   /v1/vaults/:vaultId/accounts
PATCH  /v1/vaults/:vaultId/accounts
DELETE /v1/vaults/:vaultId/accounts
PUT    /v1/vaults/:vaultId/accounts
POST   /v1/vaults/:vaultId/archive-exports
GET    /v1/vaults/:vaultId/audit-events
POST   /v1/vaults/:vaultId/audit-events
GET    /v1/sync/offline-bundle
```

The inventory deliberately includes the current shared-vault audit alias and the separate personal-vault audit routes. Their existing authorization and audit redaction semantics must remain distinct.

## 13. Proposed implementation phases / future child issues

These are candidate child issues for the parent issue after plan approval. They are implementation phases, not a gradual production rollout:

1. **Lock architecture and runtime decisions**
   - Record the `apps/api` domain/persistence boundary, zero-web-database rule, versioned `/v1` API path plus the web-only `/api/v1` proxy path, `api-contract`/`api-client` client boundary, proxy-only browser policy, host-only cookies, OIDC web callback, Turnstile ownership, client-only Secure Share Link delivery, Hyperdrive local strategy, and Worker cron in ADRs.
   - Record the email runtime contract: Bun, self-hosted, and Cloudflare Worker API runtimes use the same Nodemailer/SMTP adapter; capture only SMTP host, port, sender, and credential values as deployment inputs, and verify Worker SMTP under `nodejs_compat`.

2. **Extract API domain and Prisma persistence**
   - Move schema/migrations into `apps/api` and generate the Prisma client there; compare migration files before/after and run validation/generation only, never a migration command.
   - Move Prisma repositories and integration tests.
   - Remove web-global Prisma singleton imports from repository implementations.
   - Add the Worker Hyperdrive database factory and separate Bun-compatible self-host runtime plus controlled migration/admin factory; web gets neither.
   - Preserve migration/admin safeguards and `DIRECT_URL` behavior.

3. **Create the Hono Worker shell**
   - Add `apps/api` package, Wrangler config, typed bindings, local dev scripts, Worker test setup, and health/time routes; do not add `@hono/node-server` because self-hosting uses `Bun.serve` directly.
   - Add `apps/api/src/app.ts` Hono route composition with `.route()`, chained RPC-inferable route definitions, `AppType`, and no explicit HEAD handlers.
   - Add `packages/api-contract` client-safe schemas/types and `packages/api-client` typed HTTP helpers as the initial client boundary; defer `hc` until an app-independent generated contract and CI drift check are proven, with compile-time import-boundary tests.
   - Add typed error, CORS, request-id, and sensitive-data-safe logging middleware.

4. **Port runtime-neutral identity and authentication adapters**
   - Refactor session/auth ports to standard Request/Hono context and split web verifier configuration from API passwordless/persistence configuration.
   - Port passwordless, bearer, cookie, PWA handoff, admission, Turnstile validation, rate limits, passkey recovery, OIDC session validation, and cookie issuance; make session revocation accept browser cookies as well as bearer tokens.
   - Move the Nodemailer SMTP adapter into shared API composition and use it in both Bun and Worker runtimes; both continue to implement the same server-only email port.
   - Prove auth and cookie contracts with Worker tests.

5. **Migrate vault and data routes**
   - Port personal/shared vault, membership, encrypted account, audit, sync, archive import/export, crypto-profile, and recovery routes; move their route/unit/integration tests under `apps/api` domain modules.
   - Use `zValidator` for every request boundary.
   - Preserve status/error/body/ETag/cache and zero-knowledge rules.
   - Use route-scoped typed middleware and direct Hono handlers.

6. **Replace web API routes with the proxy**
   - Add the generic Next catch-all proxy and explicitly update `apps/web/src/proxy.ts` matcher/security-header/page-gating behavior so `/api/v1/**` is not redirected or database-backed; the catch-all rejects unversioned `/api/**` requests rather than forwarding an alias.
   - Delete all 39 concrete API route modules.
   - Implement header/body/status/stream/cookie forwarding and upstream failure handling.
   - Preserve the Turnstile CSP directives and public-site-key configuration, and update security headers, local configuration, proxy architecture tests, and browser support fixtures so web tests no longer import route implementations or Prisma.

7. **Update web/native composition and auth boundaries**
   - Point native `EXPO_PUBLIC_API_URL` to the API origin and update every native client operation to the `/v1` paths; retain `/api/v1` only for browser proxy calls.
   - Update web server auth/logout/SSR composition to use the API gateway and thin logout adapter; no web Prisma or `apps/api` backend runtime imports remain.
   - Keep client-only crypto/TOTP/secret boundaries unchanged, including browser/PWA Turnstile token handling and client-side Secure Share Link `mailto:`/copy delivery.
   - Update API contract/client types without putting credentials or decrypted content in caches.

8. **Local end-to-end verification and Cloudflare deployment configuration**
   - Preserve and verify the confirmed development/production migration workflow separately from request handling, including the focused migration image, ignored `.env.prod`, and production `--no-deps` isolation.
   - Run the API Worker, required self-hosted Bun adapter, web dev server, and approved Postgres/Hyperdrive test target locally.
   - Exercise browser proxy, passwordless, PWA handoff, OIDC if enabled, passkey recovery, native bearer auth, vault mutations, audit, offline bundle, imports, and retention.
   - Configure Worker secrets/bindings, Hyperdrive, custom domain, cron trigger, shared SMTP/TLS settings, and web proxy variables.
   - Remove the old Vercel API cron path and update self-hosting/retention/auth/monorepo documentation.

9. **Final repository quality gate**
   - Update root `lint`, `typecheck`, `test`, and `test:full` composition so `apps/api` and the client packages are actually covered, then run the required root checks after the final change, including `pnpm run test:full`.
   - Run API-specific typecheck/lint/unit/Worker tests using the Cloudflare Workers Vitest integration (or the pinned supported equivalent), plus Wrangler deployment/bundle checks; include these in the root build/CI composition rather than validating only the web build.
   - Run browser tests through the web proxy and native JS verification.
   - Run the required mobile native build evidence because the mobile API-origin configuration is part of this extraction: `mise exec -- pnpm --dir apps/mobile run build:android-native` and `mise exec -- pnpm --dir apps/mobile run build:ios-simulator`.
   - Do not claim production readiness if any environment-blocked phase is unresolved.

## 14. Testing and acceptance criteria

### Architecture

- `apps/api` is a Cloudflare Worker Hono app and can run with `wrangler dev`; its supported self-hosted Bun adapter runs without being bundled into the Worker.
- The API route tree uses Hono sub-apps and `app.route()`.
- Request validation uses Zod and `@hono/zod-validator`.
- RPC inference is preserved for the declared public app/type boundary.
- No Rails-style controllers or explicit HEAD handlers are introduced.
- `apps/web/src/app/api` contains only the generic proxy route and recognized Next conventions.
- No API business logic or Prisma import remains in the web proxy.
- `apps/web` has no Prisma, `pg`, database URL, or `apps/api` backend runtime dependency; SSR uses the fixed-origin API gateway.
- No browser/native package contains `apps/api` backend modules, Prisma, secrets, or decrypted content.

### Contract and behavior

- All 59 existing path/method operations from the 43 source route modules are implemented in the Hono app under `apps/api`, including account deletion and the shared-vault audit `GET` re-export, plus the documented recovery-eligibility `GET` and OIDC deletion-completion `POST` operations; each API target path is `/v1/<source-path>`, with browser access through `/api/v1/<source-path>` on the web origin.
- The passwordless request contract requires a safe one-time Turnstile token for web/PWA clients, rejects a token for mobile, validates Turnstile before anonymous limiting/challenge creation, and preserves generic status/error/cache contracts.
- Existing success/error bodies, status codes, error codes, cache headers, ETags, and encrypted byte encodings remain compatible.
- Auth assurance levels, application admission, mutation rate limits, authorization, revision checks, audit redaction, one-time links, and retention semantics are unchanged.
- Destructive Personal Vault Reset atomically removes the specified unusable Personal Vault ciphertext and cryptographic material, preserves Viewer memberships, returns the Personal Vault to `UNINITIALIZED`, and rejects recovery-enrolled users and users who own an active Shared Vault.
- Browser requests through the web proxy and native bearer requests directly to the API both pass the same contract tests; web `/api/v1/**` to API `/v1/**` forwarding is covered, and unversioned API `/v1`-less requests are rejected without an alias.
- Web SSR gateway calls preserve auth cookies and page redirect behavior without importing web Prisma; `/me` admission failure, Personal Vault failure, and transport failure all fail closed without rendering partial authenticated content.
- Multiple `Set-Cookie` headers survive the proxy correctly.
- PWA handoff and browser refresh rotation work through the proxy in a real browser, including the 15-second background-tab verifier wait.
- Shared Vault invitation and re-invitation delivery remains client-only: browser `mailto:` drafts and copy fallback never send the Secure Share Link secret to the API, and the localized email/copy failure states remain complete in both catalogs.

### Security

- API CORS is exact-origin and does not use wildcard credentials; the private proxy marker is never a browser-allowed or browser-exposed header. CORS, proxy, SSR, and direct-client tests use API `/v1/**` and web proxy `/api/v1/**`, and verify that an unversioned path cannot bypass the version boundary.
- Proxy-origin trust is authenticated and configuration-driven.
- No sensitive request/response body, cookie, token, secure-share value, key, OTP, or ciphertext is logged.
- API origin and proxy configuration cannot be attacker-controlled URL redirects.
- Worker secrets are supplied by bindings/secrets, never checked into source or exposed to clients; `OIDC_CLIENT_SECRET` remains web-only and is absent from Worker/Bun API runtime configuration.
- `TURNSTILE_SECRET_KEY` is API-only, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is web-public, production rejects the always-pass testing pair, and no Turnstile token or response is persisted or logged.
- Web/API shared verification secrets are intentionally equal where required and are validated without being logged.
- Plaintext TOTP secrets and decrypted Vault content remain client-only.
- Browser direct requests carrying API cookies are not an alternate supported path; cookie auth is exercised through the web proxy.

### Runtime and deployment

- Prisma access works against the approved Cloudflare database path using the exact dependency versions, with Hyperdrive caching/read-after-write behavior explicitly verified for auth, authorization, revisions, and mutations.
- Worker dependency scopes clean up their database resources, Bun reuses and closes its process-scoped database resources, and concurrency tests show no connection leak or cross-request state.
- Worker bundle size and runtime limits are acceptable.
- `wrangler types` output is current and checked as required by project convention.
- Local `.dev.vars` and production Wrangler secrets are documented and validated.
- The confirmed development and production migration commands remain separate from request handling; production uses ignored `.env.prod`, interactive confirmation, the focused migration image, and `--no-deps` without starting the local Compose database.
- `GET /v1/health` remains a non-sensitive liveness check and does not expose database/provider details; dependency failures are represented in safe metrics/alerts.
- Cloudflare scheduled retention runs once per configured schedule and reports bounded progress.
- Vercel no longer owns or schedules the API implementation.
- A fresh final `pnpm run test:full` passes after the final code/configuration change, with any environment-blocked evidence reported explicitly.

## 15. Resolved architecture decisions and owner inputs

The following concerns are resolved in this draft rather than left as implementation ambiguity:

- Persistence and server business logic are owned by `apps/api`, not a third database HTTP service; only client-safe API contracts are shared under `packages/`.
- `apps/web` has zero database connectivity. SSR uses the fixed-origin API gateway, and recovery eligibility is an API read operation.
- OIDC authorization/callback remains web-owned; the API validates the shared provider-neutral session contract. Web logout is a thin API-revocation/cookie adapter.
- The API service exposes a fixed `/v1` version segment at its own origin and exports `AppType` from `apps/api/src/app.ts`; the web origin's `/api/v1` path is only the same-origin browser proxy boundary. The version is code/configuration, not a caller-controlled or deployment-specific path. Initial clients use typed `packages/api-contract`/`packages/api-client` helpers without importing API runtime code. `hc` requires a separately generated, CI-checked client-safe declaration and is not required for the initial extraction.
- Existing 59 route operations retain their contract; the documented recovery-eligibility `GET` and OIDC deletion-completion `POST` are added, making 61 target business operations, with implicit Hono `HEAD` behavior tested separately. Status/error/body/cache/ETag/encrypted-payload changes require explicit approval.
- Existing PostgreSQL remains the database. Production Worker access uses Hyperdrive; local `wrangler dev` uses a disposable direct connection and `wrangler dev --remote` is an optional disposable-remote smoke test.
- Browser traffic is proxy-only and same-origin. Native calls the API directly with bearer credentials. Cookies are host-only and replayed through the proxy. Requests containing conflicting bearer and cookie credentials fail closed; matching credentials must resolve deterministically.
- The proxy uses `X-Rhasia-Proxy-Secret` over TLS; it is not a user credential and is not allowed/exposed by CORS.
- Passwordless browser/PWA abuse protection remains layered: server-validated Turnstile precedes the shared PostgreSQL anonymous email/IP limits, while native requests remain widget-free but rate-limited.
- Retention uses one Cloudflare Cron Trigger/`scheduled()` path. The authenticated HTTP endpoint remains for bounded manual/local diagnostics.
- Cloudflare, Bun, and self-hosted deployments use the same server-only SMTP/Nodemailer adapter. Worker SMTP depends on `nodejs_compat` and a supported submission port; port 25 is not used.
- No database schema change, migration generation, or migration application is part of this extraction.
- Documented Docker self-hosting is preserved through the same Hono route tree and the required supported Bun adapter; it is not a duplicate API implementation. Cloudflare production uses the Worker adapter and scheduled handler. The Docker build uses pnpm; Bun is the runtime only. The current confirmed migration workflow is relocated without weakening its interactive confirmation or production `--no-deps` isolation.
- Web retains the public Turnstile site key and verifier/OIDC-callback configuration, while the Worker/Bun API owns passwordless challenge/session persistence, Turnstile verification, passkey verification, database, and email configuration. `AUTH_SESSION_SECRET` and `OIDC_SESSION_SECRET` are shared deliberately where both sides verify the same signed session contract; `OIDC_CLIENT_SECRET` remains web-only.
- Authentication email remains server-delivered through the selected API adapter, but Shared Vault invitation/re-invitation email remains a client-side localized `mailto:`/copy effect; Secure Share Link secrets never enter the API.
- SSR performs admission first, then the idempotent Personal Vault read, and fails closed rather than rendering a partially loaded page. Destructive reset preserves Viewer memberships, returns the Personal Vault to `UNINITIALIZED`, and atomically removes the specified unusable Personal Vault material.

The route parity manifest and environment ownership matrix must be completed with exact source/test references before issue creation. Only the following deployment-specific inputs remain:

1. Shared SMTP host, sender identity, credentials, TLS settings, and secret provisioning method for Bun, self-hosted, and Worker deployments.
2. Cloudflare account/Worker name, Hyperdrive ID, cron expression, custom-domain/DNS ownership, and deployment workflow.
3. Disposable local/remote Postgres test targets and the exact pinned Prisma/Wrangler/Bun versions to validate.
4. Production OIDC enablement and exact redirect values; passkey values remain the web origin/RP ID.
5. Local and production `WEB_ORIGIN`, `API_ORIGIN`, allowed development origins, and mobile API configuration.
6. Monitoring/alert destination and operational owner for API, database, email, auth, and retention signals.
7. Supported mobile build inventory, minimum supported version, and explicit approval for any legacy build that cannot be updated before the hard cutover.
8. Owner approval of the zero-web-database boundary, proxy-only browser policy, shared SMTP/Nodemailer transport across API runtimes, supported Bun self-hosting, and frozen-contract/no-migration scope.

These inputs are configuration/approval gates, not alternate architecture branches. If any selected provider or runtime fails the Worker proof, stop and revise the plan before deployment rather than adding a dual implementation.

## 16. GitHub issue handoff

After approval, create:

- One parent issue using the goal and acceptance criteria in this document.
- Child issues for the implementation phases in section 13.
- Explicit configuration/approval blockers for the email provider, Cloudflare/Hyperdrive identifiers, OIDC production values, deployment workflow, and monitoring ownership if the owner inputs in section 15 remain unanswered. The SSR boundary, persistence ownership, proxy policy, and RPC boundary are already resolved in this plan.

Do not create or apply a Prisma migration as part of issue creation. Do not open or merge a pull request until the repository's required final `pnpm run test:full` gate has passed after the final change.
