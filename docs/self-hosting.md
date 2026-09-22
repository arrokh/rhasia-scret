# Supported self-hosting

This guide describes the supported deployment contract for rhasia-scret. The web application is a Node.js Next.js presentation server and same-origin API proxy. The Hono API service owns PostgreSQL and Prisma; web is not a database client. The server may handle encrypted content and permitted authorization/lifecycle metadata, but must never receive or log Vault Names, authenticator labels, TOTP configuration, OTPs, QR data, Vault keys, passphrases, private keys, or decrypted content.

## Supported deployment matrix

| Layer                 | Reference                                         | Supported alternatives                                                        | Unsupported                                                                              |
| --------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Web host              | Vercel with Node.js 24.x                          | Checked-in Docker Compose or another Node.js host behind HTTPS                | Static export                                                                            |
| API host              | Bun service / standalone Node.js service          | Vercel Node.js function or another Node/Bun host behind HTTPS                 | Next.js API routes                                                                       |
| Database              | PostgreSQL 16 compatibility target                | Managed/operator-run PostgreSQL with TLS and separate pooled/direct endpoints | SQLite, MySQL, browser database access                                                   |
| Web authentication    | `passwordless` (default), or optional `oidc`      | `none` for local-only browser work                                            | Password-based app auth, email-based account merging, second identity authority          |
| Native authentication | Self-managed passwordless links from the web host | Development `rhasia-scret://` link scheme                                     | Production custom-scheme-only links, native Local Vault, native WebAuthn PRF assumptions |

All providers must satisfy PostgreSQL compatibility, TLS, backup/PITR, restore, retention scheduling, least-privilege access, and pooled/direct connection requirements. CI PostgreSQL proves application compatibility; it is not production infrastructure.

## Prerequisites and boundaries

Use mise-managed Node.js `24.19.0` and pnpm `11.17.0`, PostgreSQL 16 or compatible, Docker Compose when containerized, Playwright browsers for browser checks, and Java/native tooling only for Expo release builds. Keep Prisma, authentication, retention, and API routes server-only. Never add browser database access or a client-side database API.

The Compose reference provisions PostgreSQL 16, keeps the API-owned migration service behind the explicit `migration` profile, starts web only after the API health check, publishes only the web port, and schedules the bounded retention purge daily through the API. Operators apply migrations separately before starting application traffic and still own HTTPS termination, secret management, backups, monitoring, host hardening, and restore drills. The shared API Prisma factory sets `max: 5` for the `pg` pool. Bun and Node create one process-scoped client and disconnect it on shutdown; Vercel reuses one client per warm function instance. Scheduled purges call the bounded API operation and do not create a second application database client.

## Environment contract

Copy the single root `.env.example` to `.env`. It separates API persistence values, web proxy/SSR values, browser-visible `NEXT_PUBLIC_*` values, native-visible `EXPO_PUBLIC_*` values, and Docker Compose bootstrap values. `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` values must contain public values only. Never create app-local `.env` files or commit a credential-bearing URL, SMTP password, authentication secret, database password, session credential, cron secret, token, or key.

### Web and server variables

| Variable                                                                                                                             | Required when                                               | Notes                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_BACKEND`                                                                                                                       | Every deployment; explicit in production                    | `none`, `passwordless`, or `oidc`; defaults to `passwordless` outside explicit production configuration.                                                                                          |
| `AUTH_APP_ORIGIN`                                                                                                                    | `passwordless`                                              | Exact origin without path/query/fragment/credentials. HTTPS is required except for localhost HTTP self-hosting.                                                                                   |
| `AUTH_TRUST_PROXY_HEADERS`                                                                                                           | Optional web proxy setting                                  | `false` by default. Set `true` only when a trusted HTTPS proxy strips/replaces forwarded host/protocol metadata. API rate limiting uses the authenticated proxy marker instead.                   |
| `AUTH_MOBILE_REDIRECT_URL`                                                                                                           | Optional                                                    | Exact `/auth/mobile` callback, or development-only `rhasia-scret://auth/magic-link`.                                                                                                              |
| `AUTH_SESSION_SECRET`                                                                                                                | `passwordless`                                              | Shared verification secret, at least 32 characters; signs browser assertions.                                                                                                                     |
| `AUTH_MAGIC_LINK_SECRET`, passwordless TTLs                                                                                          | API passwordless runtime                                    | API-only challenge/session settings; never pass to web or native clients.                                                                                                                         |
| `TURNSTILE_SECRET_KEY`                                                                                                               | API passwordless runtime                                    | Server-only Turnstile verification secret; never expose it to Web or native clients.                                                                                                              |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_FROM_NAME` | Bun, Node/Vercel, and self-hosted API passwordless runtimes | Server-only Nodemailer SMTP settings shared by every API runtime.                                                                                                                                 |
| `WEB_ORIGIN`, `PROXY_SECRET`                                                                                                         | API runtime                                                 | Exact web origin and private proxy marker; production values use HTTPS and at least 32 random secret characters.                                                                                  |
| `API_ORIGIN`, `API_PROXY_SECRET`                                                                                                     | Web proxy and SSR gateway                                   | Fixed API origin and private proxy marker; web calls `/v1/**` directly for SSR. Compose may use the private `http://api:8787` service name; public/non-Compose production origins must use HTTPS. |
| `DATABASE_URL`                                                                                                                       | Every API runtime                                           | Pooled runtime Prisma URL; use TLS in production.                                                                                                                                                 |
| `DIRECT_URL`                                                                                                                         | API Prisma CLI                                              | Direct migration/admin URL; production pooled and direct endpoints must be distinct.                                                                                                              |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_SESSION_SECRET`                                    | `oidc`                                                      | Existing server-only OIDC adapter settings; HTTPS is required except for localhost HTTP self-hosting callbacks.                                                                                   |
| `OIDC_AUDIENCE`, `AUTH_ADMITTED_EMAILS`                                                                                              | Optional OIDC policy                                        | Audience and verified-email admission policy; not a membership list.                                                                                                                              |
| `PASSKEY_RP_ID`, `PASSKEY_ORIGIN`                                                                                                    | Passkey recovery/unlock                                     | Server-only WebAuthn settings; origin and RP hostname must agree.                                                                                                                                 |
| `MOBILE_APPLE_TEAM_ID`, `MOBILE_ANDROID_CERT_SHA256`                                                                                 | Verified native links                                       | Optional association-document values; malformed values fail closed.                                                                                                                               |
| `CRON_SECRET`                                                                                                                        | Retention scheduler                                         | At least 32 random server characters; required by the scheduler route.                                                                                                                            |
| `NEXT_PUBLIC_POSTHOG_*`, `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN`                                                                | Optional analytics                                          | Public values only; analytics is off when unset.                                                                                                                                                  |

Run `pnpm run verify:deployment-config` before deployment. After deployment, run `SMOKE_API_ORIGIN=https://api.example.com pnpm --filter @rhasia-scret/api smoke:deployment`; this checks health, time, no-store headers, and unauthenticated retention rejection without sending a purge credential. Use `VERIFY_DEPLOYMENT_PRODUCTION=1` to enforce production requirements and set `DEPLOYMENT_TARGET=bun`, `node`, or `vercel` for the API target. It validates URL shape, backend configuration, API proxy credentials, secret length, and conditional variables without printing their values. Both web and API validation reject a missing production `AUTH_BACKEND`; non-production runtimes retain the passwordless default. Runtime traffic uses only `DATABASE_URL`; `DIRECT_URL` is optional in the runtime environment and is reserved for controlled migration/admin commands. The web validation rejects API-only variables, the Web Vercel build runs that validation before `next build`, and the API Vercel build runs the production API validation before generating Prisma Client and bundling the Vercel adapter.

For the standalone API, provision API-only values in the Bun, Node, or Vercel project; do not put SMTP or database values in Vercel Web. At minimum, configure `DATABASE_URL`, `WEB_ORIGIN`, `PROXY_SECRET`, `AUTH_APP_ORIGIN`, `AUTH_MAGIC_LINK_SECRET`, `AUTH_SESSION_SECRET`, `TURNSTILE_SECRET_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_FROM_NAME`, and `CRON_SECRET`. Add `PASSKEY_RP_ID`, `PASSKEY_ORIGIN`, and `AUTH_ADMITTED_EMAILS` when those optional features are enabled. Use `DEPLOYMENT_TARGET=vercel VERIFY_DEPLOYMENT_PRODUCTION=1 pnpm run verify:deployment-config` for the API Vercel project. Both Vercel project configurations enable Git deployment only for `main`; non-main branches are intentionally skipped. Their ignored-build commands compare the previous and current commits and skip unaffected services: API changes are `apps/api` plus its transitive workspace dependencies, and Web changes are `apps/web` plus its transitive workspace dependencies. Install metadata and the deployment-filter contract fail open and rebuild rather than suppressing a deployment. Never print or commit secret values.

### Native client variables

Native builds read the `Native mobile build` section of the root `.env.example` through `apps/mobile/app.config.ts`:

| Variable                               | Notes                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`                  | HTTPS API origin without credentials.                                                         |
| `EXPO_PUBLIC_WEB_ORIGIN`               | HTTPS web origin only; must match the deployment.                                             |
| `EXPO_PUBLIC_AUTH_REDIRECT_URL`        | Matching `https://.../auth/mobile`, or `rhasia-scret://auth/magic-link` for development only. |
| `EXPO_PUBLIC_NATIVE_CRYPTO_VALIDATION` | `1` only for local validation builds; never for distributed product builds.                   |

Native link credentials and association evidence are release inputs, not committed configuration. Native session credentials are stored only through `expo-secure-store`.

## Deployment procedure

### 1. Provision the host

For a self-hosted Bun API and Node web host:

```bash
mise install
mise run setup
pnpm install --frozen-lockfile
pnpm run prisma:validate
pnpm run build
pnpm --filter @rhasia-scret/api dev
pnpm start
```

Installing the workspace generates the API's Prisma Client with a synthetic, non-production URL. The API `dev`, `dev:node`, and build commands repeat generation before use; this keeps ignored generated output aligned with the installed Prisma packages without connecting to PostgreSQL. Runtime traffic still uses only `DATABASE_URL`; `DIRECT_URL` remains reserved for explicit Prisma migrations and administrative commands.

Run both processes behind an HTTPS proxy that forwards the original host/protocol correctly. If the web proxy strips and replaces forwarded headers, set `AUTH_TRUST_PROXY_HEADERS=true`; otherwise leave it `false` so client-supplied forwarding metadata is ignored. For a local self-hosted Compose deployment, use the idempotent repository commands:

```bash
pnpm selfhosted:setup
pnpm selfhosted:up
curl --fail --silent --show-error http://127.0.0.1:${APP_PORT:-3000}/api/v1/health
```

`selfhosted:setup` creates `.env` only when it is absent and repairs only
non-database `replace-with-*` placeholders in an existing file. Set
`POSTGRES_PASSWORD` manually; setup never rotates an existing database
credential. It generates local secrets, preserves configured values, verifies
Docker and the application environment, starts PostgreSQL,
and applies the API-owned migrations after an interactive `yes` confirmation.
It defaults a newly created environment to `AUTH_BACKEND=none`; configure
passwordless or OIDC in `.env` before `selfhosted:up` when hosted
authentication is required. Rerun setup to validate changed authentication
configuration before migrating again. Compose containers use production
builds, but localhost HTTP is supported for local self-hosting; use HTTPS for
any non-local web, API, or authentication origin. `selfhosted:up` verifies the environment,
builds the production images before starting them (so Compose does not try to pull
private application image names), starts PostgreSQL, API, web, and the retention
scheduler, and waits for Compose health checks. If a health check fails, it prints
sanitized Compose service status before exiting. The web cache is backed by an
ephemeral writable tmpfs while the rest of the application filesystem remains
read-only. Both commands may be rerun safely. `selfhosted:down`
stops the project without deleting the PostgreSQL volume:

```bash
pnpm selfhosted:down
```

The self-hosted commands intentionally keep PostgreSQL private on the
Compose network; the development-only override remains available for
`pnpm dev:db` when host-side database access is needed. The API runtime uses a
production-only deployment without Prisma's optional CLI, Studio, and TypeScript
tooling; the separate migration image retains the Prisma CLI and narrowly
required `tsx` tool. The web runtime uses an Alpine Node image and Next
standalone output. The named volume survives `selfhosted:down`; back it up before
retiring it.

### 2. Apply PostgreSQL schema and identity migration

The Compose migration step above is explicit and separate from application startup. Do not rely on `docker compose up` to apply schema changes.

Create the ignored `.env.prod` file with `DATABASE_URL` set to the pooled
runtime endpoint and `DIRECT_URL` set to the direct migration endpoint. From a
controlled runner:

```bash
pnpm run prisma:generate
pnpm run prisma:validate
VERIFY_DEPLOYMENT_PRODUCTION=1 pnpm run verify:deployment-config
pnpm run verify:prisma-connections
# Builds the focused migration image, applies migrations through the additive
# auth state, runs preflight, seeds/verifies local identities, and applies the
# guarded cleanup without starting the Compose-local database dependency.
pnpm prod:db:migrate
```

The production command requires typing `yes` before it runs. The validation
commands above must use the same production environment values as `.env.prod`;
the migration command loads `.env.prod` itself and performs final migration
verification.

The authentication deployment runner is staged. It applies only migrations through the additive auth-state migration, runs preflight, seeds one local identity per existing `ApplicationUser` by that existing ID, verifies the staged mapping while the legacy subject column remains available, and only then applies the guarded cleanup and remaining migrations. It is safe to rerun after an interrupted deployment.

Preflight rejects invalid or colliding normalized Application User emails. Seeding never matches users by email, never merges identities, and leaves existing External Identity rows, user IDs, Vaults, memberships, ciphertext, crypto profiles, recovery records, and audit history untouched. If preflight, seeding, or staged verification fails, the destructive migration is not applied. After the final migration there is no provider-session compatibility path; rollback requires restoring a database backup and deploying the previous application version.

### 3. Configure passwordless authentication

Set `AUTH_BACKEND=passwordless`, the API-only `AUTH_*` values, and the server-only Bun SMTP values. Local self-hosted Compose may use the documented Cloudflare Turnstile testing pair from `.env.example` when both `WEB_ORIGIN` and `AUTH_APP_ORIGIN` are localhost or `127.0.0.1`; non-local production origins still reject testing keys. The user flow is:

1. Web or native client submits an email and a fixed client audience.
2. The server persists only a keyed token digest and sends a bilingual email.
3. The raw token appears only in the URL fragment.
4. Web clears the fragment before redemption; native consumes it in memory.
5. Redemption atomically consumes the challenge, provisions/loads `rhasia:passwordless`, and creates a database session.
6. Web uses HttpOnly same-site cookies and a signed browser assertion; native stores opaque access/refresh credentials in secure storage.

Requests are limited to five per normalized email and twenty per IP per 15-minute window. Sessions use keyed digests, short-lived access credentials, native refresh rotation, reuse detection, revocation, and redacted security events. Browser keepalive validates the signed browser assertion without rotating a refresh credential, avoiding Strict Mode and concurrent-load races. No raw token, session credential, IP address, Vault material, or decrypted content is persisted or logged.

### 4. Configure optional OIDC or local-only mode

For OIDC, set `AUTH_BACKEND=oidc` and register the exact callback at one issuer. Discovery, issuer, state, nonce, PKCE, verified email, audience when configured, expiry, and configured admission are validated. The current native app supports passwordless only; use OIDC for web deployments until a separately reviewed native adapter exists.

For local-only browser work, set `AUTH_BACKEND=none`. Hosted Personal/Shared Vault, synchronization, memberships, audit, and recovery APIs fail closed in this mode.

If the selected backend is malformed or incomplete, protected web routes redirect to the localized `/sign-in?auth=configuration_error` state rather than looking unauthenticated. A serverless API composition returns `{ "error": "authentication_misconfigured" }` with HTTP 503, `Cache-Control: no-store`, and an opaque request ID; the web proxy forwards it without exposing parser text. Standalone Bun/Node startup logs only a fixed category, bounded configuration field, and startup correlation marker before exiting, so no listener is advertised as ready. The existing `api_misconfigured` dependency response remains distinct from authentication configuration failures.

### 5. Configure HTTPS and verified links

Use one exact HTTPS origin for hosted/non-local deployments. Local self-hosting may use `http://localhost` or `http://127.0.0.1`; HTTPS remains required for non-local passwordless/OIDC origins. Use the configured origin for `AUTH_APP_ORIGIN`, `PASSKEY_ORIGIN`, `EXPO_PUBLIC_WEB_ORIGIN`, and the web/native routes. Verify these association documents without redirects when native is enabled:

- `/.well-known/apple-app-site-association`
- `/.well-known/assetlinks.json`

The accepted native paths are `/auth/mobile` and `/vaults/invitations/redeem`. The custom scheme is development-only and does not prove production verified links.

### 6. Schedule retention purge

The daily scheduler calls:

```bash
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  http://api:8787/v1/internal/retention-purge
```

Resolve the secret at execution time. The bounded purge removes expired account/vault data, authentication challenges, expired/revoked sessions, and anonymous rate-limit windows. It reports only opaque IDs, counts, and backlog flags; identity security events follow their own retention policy. The database operator owns encrypted backups/PITR and restore drills.

## Clean local smoke test

```bash
mise install
mise run setup
cp .env.example .env
pnpm install --frozen-lockfile
pnpm run prisma:validate
AUTH_BACKEND=none pnpm run verify:deployment-config
node tools/confirm-database-operation.mjs 'the local smoke-test database migration' && pnpm run prisma:migrate:deploy
AUTH_BACKEND=none pnpm run build
pnpm run test:browser:smoke
```

Do not use production credentials, real accounts, user-provided account data, Vault content, secrets, tokens, or keys in a smoke test. Use synthetic, non-PII identities with reserved example domains and dummy labels. Before merge or release, run a fresh root `pnpm run test:full`; native release evidence additionally requires the Android and iOS simulator build commands.

## Operational handoff checklist

Retain a dated, redacted record of host/runtime and commit SHA; PostgreSQL TLS, pooled/direct endpoint, migration, backup/PITR, and restore evidence; selected authentication backend, secret rotation, session/revocation review, and callback checks; association-document checks; retention scheduler output; security-header/cache/source-map checks; and the final verification result. Record only opaque IDs, counts, timestamps, and exit status.
