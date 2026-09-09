# Supported self-hosting

This guide describes the supported deployment contract for operators running the rhasia-scret web application. It is intentionally provider-aware but not provider-dependent: the repository has a reference Vercel deployment shape and tests against PostgreSQL 16, while database, authentication, DNS, backups, and scheduler evidence remain the operator's responsibility.

The application is zero-knowledge with respect to Vault content. The web server and database may handle encrypted content and permitted authorization/lifecycle metadata, but must never receive or log Vault Names, authenticator labels, TOTP configuration, OTPs, QR data, Vault keys, passphrases, private keys, or decrypted content.

## Supported deployment matrix

| Layer | Supported reference | Supported alternatives | Unsupported or unverified combinations |
| --- | --- | --- | --- |
| Web host | Vercel project rooted at the repository root, using Node.js `24.x` and the checked-in `vercel.json` | The checked-in Docker Compose stack, or a Node.js host that can run `pnpm build` and `pnpm start` behind an HTTPS reverse proxy | Static export, an edge-only runtime, or a host that cannot run the Next.js server/API routes |
| Database | Supabase-managed PostgreSQL project for the reference hosted shape; CI's compatibility reference is the official `postgres:16` image | A managed or operator-run PostgreSQL provider with TLS and separate pooled runtime and direct migration endpoints | SQLite, MySQL, browser Supabase Data API/RLS access, or production deployments with no direct migration connection |
| Web authentication | `supabase` (default adapter) or `oidc` (provider-neutral OIDC Authorization Code + PKCE) | A future adapter that preserves the Identity bounded-context contract after a separate security review | Auth.js/NextAuth as a second identity authority, password-based application auth, or an unvalidated custom provider |
| Local-only web mode | `none`, which exposes the browser Local Profile/Local Vault path only | A development or isolated deployment with no remote authentication | Hosted Vault, membership, recovery, audit, or synchronization APIs while `AUTH_BACKEND=none` |
| Native client | Supabase Auth with the HTTPS verified-link endpoints published by the web host | Development custom scheme only for local builds | The current native UI with `AUTH_BACKEND=oidc`, production custom-scheme links, or native Local Vault/WebAuthn PRF assumptions |

The reference hosted shape uses Supabase-managed PostgreSQL alongside Supabase Auth. The repository does not certify an additional managed PostgreSQL vendor. Treat PostgreSQL 16 compatibility, pooled/direct connection support, TLS, backup/PITR, restore, and purge scheduling as acceptance requirements for any alternative provider selected by the operator. The CI PostgreSQL service proves application compatibility; it is not production infrastructure.

## Prerequisites and boundaries

Install the pinned toolchain before running repository commands:

- Node.js `24.19.0` through mise (`24.x` is the supported host range).
- pnpm `11.17.0`.
- PostgreSQL 16 or a compatible PostgreSQL service.
- Docker Engine with the Compose plugin when using the containerized deployment.
- A supported browser and Playwright browsers for browser verification.
- Java 21 and native platform tooling only when compiling the Expo clients.

The repository ships a Dockerfile and Compose reference for a single-node self-hosted deployment. The stack provisions PostgreSQL 16, runs Prisma migrations before the web process, publishes only the web port, and runs the bounded retention purge at 03:00 UTC each day. Operators still own HTTPS termination, authentication-provider configuration, backups/PITR, monitoring, host hardening, and secret management.

The web deployment is a Node server, not a static site. Keep Prisma, authentication, retention, and all other server routes on the server. Do not add browser database access or replace server-side Prisma with the Supabase Data API; that boundary is deliberate.

## Environment contract

Copy the root `.env.example` for the web/server contract. `apps/web/.env.example` is the equivalent app-local example. Examples contain placeholders only. Never commit a real URL containing credentials, provider secret, database password, session secret, cron secret, token, or key.

The web process loads the root `.env`, then app-local `.env`/`.env.local` where applicable. The deployment platform should set production values through its secret/environment manager, with separate Preview and Production scopes. `NEXT_PUBLIC_*` values are embedded in browser-visible output; they must be public values only.

For Docker Compose, copy `.env.example` to `.env`. Compose consumes the `POSTGRES_*` and `APP_PORT` values from that file, constructs private in-network `DATABASE_URL` and `DIRECT_URL` values for the `db` service, and passes only the application variables required by the `web` service. Use a URL-safe database password because it is embedded in those internal connection URLs. Set `COMMIT_SHA` to the current short Git SHA when invoking Compose; it tags both application images and is recorded in their OCI revision label. The bundled single PostgreSQL service intentionally uses one endpoint for runtime and migrations; use separately provisioned pooled/direct endpoints for a production provider topology that requires that distinction. The web package keeps Prisma CLI in `dependencies` because the production-only migration image invokes it; Next's standalone runtime tracing does not include the CLI unless application code imports it.

### Web and server variables

| Variable | Required when | Example | Validation and handling |
| --- | --- | --- | --- |
| `AUTH_BACKEND` | Every deployment; set it explicitly in production | `supabase` | Allowed values are `none`, `supabase`, and `oidc`. The runtime defaults to `supabase` only for compatibility; invalid values fail closed. |
| `DATABASE_URL` | Every hosted web process | `postgresql://app:password@pool.example.test:5432/rhasia?sslmode=require&schema=public` | Runtime Prisma traffic. The value is server-only, must use TLS in production, and missing values make Prisma initialization fail. |
| `DIRECT_URL` | Prisma validation, migrations, and administrative commands | `postgresql://app:password@direct.example.test:5432/rhasia?sslmode=require&schema=public` | Prisma CLI migration connection. It is required by `prisma.config.ts`; it is not an automatic fallback to `DATABASE_URL`. Run `pnpm run verify:prisma-connections` to confirm the runtime and migration endpoints are distinct for a pooled provider. |
| `NEXT_PUBLIC_SUPABASE_URL` | Web `supabase` mode and native Supabase configuration | `https://project.supabase.co` | Public HTTPS project URL. It is used by the server adapter and is safe to expose only as the provider URL, never as a credential. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Web `supabase` mode and native Supabase configuration | `your-publishable-key` | Publishable/anon key only. Service-role and secret keys are forbidden. `pnpm run verify:supabase-auth` checks reachability, public signup, and required email confirmation. |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | Optional PostHog browser analytics | *(empty)* | Optional public project token. Leave it empty unless analytics is intentionally enabled. |
| `NEXT_PUBLIC_POSTHOG_HOST` | Together with the PostHog project token | `https://us.i.posthog.com` | Optional HTTPS ingestion host. Set the token and host as a pair; omit both to keep PostHog disabled. |
| `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN` | Optional Cloudflare Web Analytics | *(empty)* | Optional public beacon token. Leave empty for default-off analytics. Never use this variable for a server credential. |
| `OIDC_ISSUER` | `AUTH_BACKEND=oidc` | `https://issuer.example.test` | Required HTTPS issuer (localhost HTTP is allowed only outside production). Discovery and issuer claims are validated. |
| `OIDC_CLIENT_ID` | `AUTH_BACKEND=oidc` | `oidc-client-id` | Required server-side client identifier. |
| `OIDC_CLIENT_SECRET` | `AUTH_BACKEND=oidc` | *(secret-manager value)* | Required server-only client secret. Never expose it to browser or native environment variables. |
| `OIDC_REDIRECT_URI` | `AUTH_BACKEND=oidc` | `https://app.example.com/auth/oidc/callback` | Required exact callback origin/path; production requires HTTPS. Register the same URI at the provider. |
| `OIDC_AUDIENCE` | Only when the OIDC provider requires an audience | `https://api.example.test` | Optional provider audience; it remains server-only configuration. |
| `OIDC_SESSION_SECRET` | `AUTH_BACKEND=oidc` | *(at least 32 random characters)* | Required server-only signing secret. Configuration rejects values shorter than 32 characters. |
| `AUTH_ADMITTED_EMAILS` | Optional OIDC admission allowlist | `operator@example.test,member@example.test` | Comma-separated verified emails. An empty list still permits a verified OIDC principal with a matching pending Shared Vault Invitation. Do not use this as a Vault membership list. |
| `PASSKEY_RP_ID` | Passkey-Assisted Recovery/Unlock | `app.example.com` | Server-only WebAuthn relying-party hostname. It must match the deployed origin's intended RP scope. |
| `PASSKEY_ORIGIN` | Passkey-Assisted Recovery/Unlock | `https://app.example.com` | Server-only exact WebAuthn origin. Production must use the deployed HTTPS origin, not localhost or a custom mobile scheme. |
| `MOBILE_APPLE_TEAM_ID` | iOS verified links | `A1B2C3D4E5` | Optional for web-only deployments; when set, the association endpoint accepts exactly a 10-character uppercase alphanumeric Team ID and otherwise fails closed. |
| `MOBILE_ANDROID_CERT_SHA256` | Android verified links | `AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99` | Optional for web-only deployments; when set, use one or more uppercase colon-delimited SHA-256 certificate fingerprints separated by commas. Invalid values make the association endpoint fail closed. |
| `CRON_SECRET` | Every deployment that runs retention purge | *(at least 32 random characters)* | Server-only bearer secret. The retention route returns `503` when missing/too short and `401` for an invalid bearer value. Store it in the scheduler secret manager, not shell history or source control. |

`DATABASE_URL`, `DIRECT_URL`, OIDC secrets, `PASSKEY_*`, and `CRON_SECRET` must never be prefixed with `NEXT_PUBLIC_` or `EXPO_PUBLIC_`. A public Supabase publishable key is not a service credential.

Run `pnpm run verify:deployment-config` before a local smoke test or deployment. It validates URL shape, selected backend, conditional values, secret length, mobile signing formats, and the production pooled/direct endpoint rule without printing environment values. Use `VERIFY_DEPLOYMENT_PRODUCTION=1 pnpm run verify:deployment-config` for the production contract; provider reachability and Supabase account settings are checked separately by `pnpm run verify:supabase-auth`.

### Native client variables

Native builds use `apps/mobile/.env.example` and require public values only:

| Variable | Required when | Example | Validation and handling |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | Every native build | `https://app.example.com` | HTTPS URL for the web API. Credentials are rejected and only the URL origin is retained. |
| `EXPO_PUBLIC_WEB_ORIGIN` | Every native build | `https://app.example.com` | HTTPS origin only; no path, query, fragment, or credentials. It must match the web deployment. |
| `EXPO_PUBLIC_AUTH_REDIRECT_URL` | Every native build | `https://app.example.com/auth/mobile` | Must be the matching verified web callback, or `rhasia-scret://auth/callback` for development only. The mobile config parser rejects other hosts and paths. |
| `EXPO_PUBLIC_SUPABASE_URL` | Current native authentication flow | `https://project.supabase.co` | Public HTTPS Supabase URL; it must point at the configured authentication project. |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Current native authentication flow | `your-publishable-key` | Publishable key only; service-role keys and other secrets are forbidden. |
| `EXPO_PUBLIC_NATIVE_CRYPTO_VALIDATION` | Native validation build only | `0` | Set to `1` only for a local diagnostic build. Omit or set `0` for every distributed product build. |

The current native composition supports Supabase bearer sessions, not the web OIDC UI. Do not claim native OIDC support solely because the server has an OIDC adapter.

## Deployment procedure

### 1. Provision the web host

For the reference Vercel deployment:

1. Create a Vercel project from the repository and keep the project root at the repository root.
2. Use Node.js `24.x`. The checked-in `vercel.json` installs `@rhasia-scret/web` and workspace dependencies with the frozen root lockfile, then runs the root `pnpm build` command.
3. Leave Output Directory unset. Do not use a static export.
4. Set the environment variables above in the correct Vercel environment scope. Keep Preview and Production values separate.
5. Deploy the web build only after the database migration and provider configuration steps below are ready. Vercel does not run Prisma migrations or identity backfill as part of the build.

For an operator-run Node host, use the same root commands:

```bash
mise install
mise run setup
pnpm install --frozen-lockfile
pnpm run prisma:generate
pnpm run prisma:validate
pnpm run build
pnpm start
```

Run `pnpm start` behind a reverse proxy or load balancer that terminates HTTPS, forwards the original host correctly, and applies deployment-level access controls. Keep the process on a Node runtime compatible with the repository's `24.x` engine range.

For the containerized single-node deployment:

```bash
cp .env.example .env
# Set the provider, passkey, CRON_SECRET, and POSTGRES_PASSWORD values in .env.
# Use a URL-safe password, for example: openssl rand -hex 32
COMMIT_SHA="$(git rev-parse --short HEAD)" docker compose -f docker-compose.yml config --quiet
COMMIT_SHA="$(git rev-parse --short HEAD)" docker compose -f docker-compose.yml up --build -d
```

The `web` service does not start until `migrate` completes successfully. Check the public health contract without sending credentials or Vault data:

```bash
curl --fail --silent --show-error http://127.0.0.1:${APP_PORT:-3000}/api/health
COMMIT_SHA="$(git rev-parse --short HEAD)" docker compose -f docker-compose.yml ps
```

Put the stack behind an HTTPS reverse proxy before enabling hosted use. Do not publish the `db` service port. `COMMIT_SHA="$(git rev-parse --short HEAD)" docker compose -f docker-compose.yml down` preserves the named database volume; use an explicit, operator-reviewed backup and volume-retirement procedure before removing it.

### 2. Provision PostgreSQL and apply schema changes

Create a database and a least-privilege application role with TLS enabled. Configure:

- `DATABASE_URL` to the provider's pooled or connection-limited runtime endpoint.
- `DIRECT_URL` to the provider's direct endpoint for Prisma migrations and administrative work.
- `DIRECT_URL` must be reachable from the controlled migration runner; it does not need to be exposed to the web browser or bundled client.

Before serving a new application version, from a controlled runner with both variables set:

```bash
pnpm run prisma:generate
pnpm run prisma:validate
VERIFY_DEPLOYMENT_PRODUCTION=1 pnpm run verify:deployment-config
pnpm run verify:prisma-connections
pnpm run prisma:migrate:deploy
```

`verify:prisma-connections` is expected to reject a pooled and migration URL that resolve to the same host/port. A single local PostgreSQL process may use the same endpoint for development; use distinct pooled/direct provider endpoints for the supported production shape.

If the database contains legacy Supabase-backed Application Users, run the provider-neutral identity migration step after migrations and before switching application code or providers:

```bash
pnpm run prisma:backfill-external-identities
```

The backfill is idempotent, preserves Application User IDs and Vault relationships, and does not touch Vault keys or ciphertext. It uses only the configured database and Supabase project URL; it does not require a Supabase service-role key. Record its count and exit status without recording user emails, tokens, or database values.

### 3. Configure authentication

#### Supabase mode

Set `AUTH_BACKEND=supabase`, the public project URL, and the publishable key. In Supabase Authentication settings:

- Enable public email signup.
- Require email confirmation.
- Set the Site URL to the exact deployed web origin.
- Allow the exact web callback `https://app.example.com/auth/confirm` and the native callback `https://app.example.com/auth/mobile` when native builds are used; replace `app.example.com` with the operator's exact origin.
- Use the callback template documented in [`authentication-configuration.md`](authentication-configuration.md); do not hardcode a production Site URL into a shared template.

Verify the provider settings without logging credentials:

```bash
pnpm run verify:supabase-auth
```

Supabase Auth is the authentication provider, not the application database API. Application data continues to use server-side Prisma.

#### OIDC mode

Set `AUTH_BACKEND=oidc` and all required `OIDC_*` values. Register the exact `OIDC_REDIRECT_URI` at one issuer. The application uses discovery, Authorization Code + PKCE, state, nonce, issuer, verified-email, audience (when configured), and token-expiry validation. Configure `AUTH_ADMITTED_EMAILS` for initial operators or create pending invitations for admitted recipients.

The current native app does not provide the corresponding OIDC client flow. Use OIDC for a web-only deployment until a separately reviewed native adapter exists.

#### Local-only mode

Set `AUTH_BACKEND=none` for a browser-only Local Profile/Local Vault deployment. Do not configure it as if it provided hosted Personal or Shared Vault access: remote authentication, synchronization, memberships, audit, recovery, and hosted Vault APIs fail closed by design.

### 4. Configure HTTPS, passkeys, and mobile verified links

Use the exact production HTTPS origin consistently:

- Supabase web callback: `/auth/confirm`.
- Supabase native callback: `/auth/mobile`.
- OIDC callback: the configured `OIDC_REDIRECT_URI`, normally `/auth/oidc/callback`.
- Passkey origin: `PASSKEY_ORIGIN` equal to the origin, with `PASSKEY_RP_ID` equal to its hostname.
- Native link host: `EXPO_PUBLIC_WEB_ORIGIN` equal to the same origin.

The web app emits security headers for pages and APIs, including CSP, HSTS, frame denial, `nosniff`, restrictive referrer policy, Permissions Policy, COOP, CORP, and private no-store caching on API/auth responses. Review [`security/deployment-hardening-checklist.md`](security/deployment-hardening-checklist.md) and verify the deployed responses rather than assuming the repository configuration proves the proxy/CDN configuration.

For native verified links, set the signing identities and confirm these endpoints over HTTPS without redirects:

- `/.well-known/apple-app-site-association`
- `/.well-known/assetlinks.json`

The endpoints return `503` until their corresponding valid environment value is configured. Verify `/auth/mobile` and `/vaults/invitations/redeem` from a signed iOS/Android build. A custom `rhasia-scret://` scheme is development-only and is not production proof of verified links.

### 5. Schedule retention purge

Vercel uses the checked-in daily schedule (`03:00 UTC`) in `vercel.json`. Configure `CRON_SECRET` in the Vercel Production environment; Vercel supplies it as a bearer credential to the retention route.

On a non-Vercel host, configure an external scheduler or operator-owned system timer to make the same authenticated request daily:

```bash
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  https://app.example.com/api/internal/retention-purge
```

Resolve `${CRON_SECRET}` from a secret manager at execution time. Do not place a real value in a command saved to shell history, tickets, logs, CI output, or source control. The route is bounded and idempotent; inspect only its opaque counts/backlog flags. If the scheduler is absent or the secret is invalid, deletion deadlines are not enforced.

The application does not perform database backups. The database operator must configure encrypted backups/PITR, retention, least-privilege backup access, and a restore drill. Restore into an isolated database, verify the expected migration state, and run the application smoke checks before switching traffic. Never use real Vault content or production credentials in a test restore. A backup may contain encrypted content and permitted metadata, so it still requires the same access controls as the live database.

## Minimal local database path

For a non-containerized local setup, use a local PostgreSQL 16 installation or an operator-provided PostgreSQL service:

```bash
createdb shared_totp_vault
cp .env.example .env
# Set DATABASE_URL and DIRECT_URL in .env.
# For a single local server, both may use localhost; production must use the
# provider's separate pooled/direct endpoints.
mise install
mise run setup
pnpm install --frozen-lockfile
pnpm run prisma:generate
pnpm run prisma:migrate:deploy
pnpm run prisma:validate
AUTH_BACKEND=none pnpm run verify:deployment-config
AUTH_BACKEND=none pnpm run build
```

For local-only browser development, set `AUTH_BACKEND=none`. For hosted-flow development, configure a development Supabase project and its exact localhost callback (`http://localhost:3000/auth/confirm`); never use production provider credentials or Vault material in local files.

## Clean deployment smoke test

Run the following from a fresh checkout with synthetic/local values and a disposable PostgreSQL database:

```bash
mise install
mise run setup
cp .env.example .env
pnpm install --frozen-lockfile
pnpm run prisma:generate
pnpm run prisma:validate
export AUTH_BACKEND=supabase
export NEXT_PUBLIC_SUPABASE_URL=https://auth.example.test
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=synthetic-browser-key
pnpm run verify:deployment-config
pnpm run prisma:migrate:deploy
pnpm run build
pnpm run test:browser:smoke
```

Then start the production server and check only public, non-sensitive responses:

```bash
pnpm start
# In another terminal:
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
curl --fail --silent --show-error -D - -o /dev/null http://127.0.0.1:3000/api/health
```

The health response must be `{"status":"ok"}`. The header response must include `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Cache-Control: no-store, private`. Do not sign in, create a Vault, send an invitation, or put real secrets into this smoke test. A deployed smoke test may use the same two public endpoints over the operator's HTTPS origin, followed by provider-link checks when mobile is enabled.

For the repository gate, run a fresh root `pnpm run test:full` after the final change. This validates the workspace, database migrations/tests, security/build checks, browser matrix, and mobile JavaScript verification; it does not replace native compilation, real-device verified-link checks, provider dashboards, backup/restore evidence, or operator security sign-off.

## Operational handoff checklist

Before calling a deployment supported, retain a dated, redacted record of:

- host/runtime, commit SHA, build output, and rollback target;
- database provider, TLS, pooled/direct endpoint verification, migration output, backup/PITR policy, and restore result;
- selected authentication backend, provider settings, callback allowlist, session/revocation review, and admission policy;
- passkey origin/RP validation and mobile association/link checks, if enabled;
- retention scheduler run, bounded backlog behavior, alerting, and manual retry procedure;
- security-header/cache/source-map checks and the final `pnpm run test:full` result.

Record opaque IDs, counts, timestamps, and command exit status only. Do not attach environment files, database URLs, provider tokens, cookies, authorization headers, Vault material, or decrypted content.
