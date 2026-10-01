# Supported self-hosting

This guide describes the supported deployment contract for rhasia-scret. The web application is a Node.js Next.js presentation server and same-origin API proxy. The Hono API service owns PostgreSQL and Prisma; web is not a database client. The server may handle encrypted content and permitted authorization/lifecycle metadata, but must never receive or log Vault Names, authenticator labels, TOTP configuration, OTPs, QR data, Vault keys, passphrases, private keys, or decrypted content.

## Supported deployment matrix

| Layer              | Reference                                | Supported alternatives                                                        | Unsupported                                                                          |
| ------------------ | ---------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Web host           | Vercel with Node.js 24.x                 | Checked-in Docker Compose or another Node.js host behind HTTPS                | Static export                                                                        |
| API host           | Bun service / standalone Node.js service | Vercel Node.js function or another Node/Bun host behind HTTPS                 | Next.js API routes                                                                   |
| Database           | PostgreSQL 16 compatibility target       | Managed/operator-run PostgreSQL with TLS and separate pooled/direct endpoints | SQLite, MySQL, browser database access                                               |
| Web authentication | `passwordless` for hosted account access | `none` for local browser use or Tailscale-exposed local-only features         | OIDC or other hosted providers, password-based app auth, email-based account merging |

All providers must satisfy PostgreSQL compatibility, TLS, backup/PITR, restore, retention scheduling, least-privilege access, and pooled/direct connection requirements. CI PostgreSQL proves application compatibility; it is not production infrastructure.

## Prerequisites and boundaries

Use mise-managed Node.js `24.19.0` and pnpm `11.17.0`, PostgreSQL 16 or compatible, Docker Compose when containerized, and Playwright browsers for browser checks. Keep Prisma, authentication, retention, and API routes server-only. Never add browser database access or a client-side database API.

The Compose reference provisions PostgreSQL 16, keeps the API-owned migration service behind the explicit `migration` profile, starts web only after the API health check, publishes only the web port, and schedules the bounded retention purge daily through the API. Operators apply migrations separately before starting application traffic and still own HTTPS termination, secret management, backups, monitoring, host hardening, and restore drills. The shared API Prisma factory sets `max: 5` for the `pg` pool. Bun and Node create one process-scoped client and disconnect it on shutdown; Vercel reuses one client per warm function instance. Scheduled purges call the bounded API operation and do not create a second application database client.

## Environment contract

Copy the single root `.env.example` to `.env`. It separates API persistence values, web proxy/SSR values, browser-visible `NEXT_PUBLIC_*` values, and Docker Compose bootstrap values. `NEXT_PUBLIC_*` values must contain public values only. Never create app-local `.env` files or commit a credential-bearing URL, SMTP password, authentication secret, database password, session credential, cron secret, token, or key.

### Web and server variables

| Variable                                                                                                                             | Required when                                               | Notes                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_BACKEND`                                                                                                                       | Every deployment; explicit in production                    | `none` or `passwordless`; defaults to `passwordless` outside explicit production configuration.                                                                                                                                                                                                             |
| `AUTH_APP_ORIGIN`                                                                                                                    | `passwordless`                                              | Exact origin without path/query/fragment/credentials. HTTPS is required except for localhost HTTP self-hosting.                                                                                                                                                                                             |
| `AUTH_TRUST_PROXY_HEADERS`                                                                                                           | Optional web proxy setting                                  | `false` by default. Set `true` only when a trusted proxy strips/replaces forwarded host, protocol, and client-IP metadata. The Tailscale wizard enables it for passwordless exposure; set it manually for equivalent manual Tailscale setup. API rate limiting uses the authenticated proxy marker instead. |
| `AUTH_SESSION_SECRET`                                                                                                                | `passwordless`                                              | Shared verification secret, at least 32 characters; signs browser assertions.                                                                                                                                                                                                                               |
| `AUTH_MAGIC_LINK_SECRET`, passwordless TTLs                                                                                          | API passwordless runtime                                    | API-only challenge/session settings; never pass to the web client.                                                                                                                                                                                                                                          |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`                                                                                                     | Optional passwordless challenge (Web and API)               | Public Turnstile site key. Configure it together with the API-only secret key, or leave both Turnstile values blank to disable the challenge.                                                                                                                                                               |
| `TURNSTILE_SECRET_KEY`                                                                                                               | Optional API passwordless challenge                         | Server-only Turnstile verification secret; never expose it to the web client. Configure it together with the public site key, or leave both blank.                                                                                                                                                          |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_FROM_NAME` | Bun, Node/Vercel, and self-hosted API passwordless runtimes | Server-only Nodemailer SMTP settings shared by every API runtime.                                                                                                                                                                                                                                           |
| `WEB_ORIGIN`, `PROXY_SECRET`                                                                                                         | API runtime                                                 | Exact web origin and private proxy marker; production values use HTTPS and at least 32 random secret characters.                                                                                                                                                                                            |
| `API_ORIGIN`, `API_PROXY_SECRET`                                                                                                     | Web proxy and SSR gateway                                   | Fixed API origin and private proxy marker; web calls `/v1/**` directly for SSR. Compose may use the private `http://api:8787` service name; public/non-Compose production origins must use HTTPS.                                                                                                           |
| `DATABASE_URL`                                                                                                                       | Every API runtime                                           | Pooled runtime Prisma URL; use TLS in production.                                                                                                                                                                                                                                                           |
| `DIRECT_URL`                                                                                                                         | API Prisma CLI                                              | Direct migration/admin URL; production pooled and direct endpoints must be distinct.                                                                                                                                                                                                                        |
| `PASSKEY_RP_ID`, `PASSKEY_ORIGIN`                                                                                                    | Passkey recovery/unlock                                     | Server-only WebAuthn settings; origin and RP hostname must agree.                                                                                                                                                                                                                                           |
| `CRON_SECRET`                                                                                                                        | Retention scheduler                                         | At least 32 random server characters; required by the scheduler route.                                                                                                                                                                                                                                      |
| `APP_BIND_ADDRESS`, `APP_PORT`                                                                                                       | Docker Compose self-hosting                                 | The published Web port defaults to `127.0.0.1:3000`; bind another IPv4 interface only for a separately managed proxy, with the direct-access implications understood.                                                                                                                                       |
| `SELF_HOSTED_TAILSCALE_MODE`                                                                                                         | `pnpm selfhosted:install`                                   | `none`, `serve`, or `funnel`; install applies the selected route after Web health checks. Funnel additionally requires typing `PUBLIC`.                                                                                                                                                                     |
| `NEXT_PUBLIC_POSTHOG_*`, `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN`                                                                | Optional analytics                                          | Public values only; analytics is off when unset.                                                                                                                                                                                                                                                            |

Run `pnpm run verify:deployment-config` before deployment. The root command runs API and Web validation with separate process environments: server-only variables stay available to the API check and are removed before the Web check, which rejects those variables if they are present. After deployment, run `SMOKE_API_ORIGIN=https://api.example.com pnpm --filter @rhasia-scret/api smoke:deployment`; this checks health, time, no-store headers, and unauthenticated retention rejection without sending a purge credential. Use `VERIFY_DEPLOYMENT_PRODUCTION=1` to enforce production requirements and set `DEPLOYMENT_TARGET=bun`, `node`, or `vercel` for the API target. The checks validate URL shape, backend configuration, API proxy credentials, secret length, and conditional variables without printing their values. Both web and API validation reject a missing production `AUTH_BACKEND`; non-production runtimes retain the passwordless default. Runtime traffic uses only `DATABASE_URL`; `DIRECT_URL` is optional in the runtime environment and is reserved for controlled migration/admin commands. The Web Vercel build runs its validation before `next build`, and the API Vercel build runs the production API validation before generating Prisma Client and bundling the Vercel adapter.

For the standalone API, provision API-only values in the Bun, Node, or Vercel project; do not put SMTP or database values in Vercel Web. At minimum, configure `DATABASE_URL`, `WEB_ORIGIN`, `PROXY_SECRET`, `AUTH_APP_ORIGIN`, `AUTH_MAGIC_LINK_SECRET`, `AUTH_SESSION_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_FROM_NAME`, and `CRON_SECRET`. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are optional but must be configured together in the API environment; the public key must also be configured in Web to render the challenge. Add `PASSKEY_RP_ID` and `PASSKEY_ORIGIN` when passkey recovery/unlock is enabled. Validate only the API Vercel configuration with `DEPLOYMENT_TARGET=vercel VERIFY_DEPLOYMENT_PRODUCTION=1 pnpm --filter @rhasia-scret/api verify:deployment-config`; use the root `pnpm run verify:deployment-config` to validate both services with their separate environment contracts. Both Vercel project configurations enable Git deployment only for `main`; non-main branches are intentionally skipped. Their ignored-build commands compare the previous and current commits and skip unaffected services: API changes are `apps/api` plus its transitive workspace dependencies, and Web changes are `apps/web` plus its transitive workspace dependencies. Install metadata and the deployment-filter contract fail open and rebuild rather than suppressing a deployment. Never print or commit secret values.

## Deployment procedure

### Docker Compose with optional Tailscale Serve or Funnel

The repository includes three `.env` setup paths. Each produces the root `.env` consumed by the existing Compose lifecycle:

- **Interactive terminal:** run `pnpm selfhosted:configure`. It asks the same setup questions as the browser form, supports Indonesian and English, hides Turnstile and SMTP passwords while typing, and writes `.env` with mode `0600`. If Tailscale is connected and reports a MagicDNS HTTPS origin, it asks whether to skip Tailscale, prepare Serve, or prepare Funnel, then asks which application authentication backend to use. It saves the route choice for `pnpm selfhosted:install`; install applies it after the app is healthy, and Funnel still requires typing `PUBLIC`. With passwordless, it enables trusted proxy headers for the selected Tailscale route. Configure refuses to overwrite `.env` by default; explicitly pass `--replace-existing` to back it up and preserve database connection settings. It does not start containers, run migrations, or change Tailscale state. A running Docker daemon is required for its read-only check for an existing PostgreSQL volume when creating a new file.
- **Interactive browser form:** run `pnpm selfhosted:configure --interactive`. It starts a one-time setup form bound only to `127.0.0.1`, offers Indonesian and English, and writes `.env` with mode `0600`. If Tailscale is connected, choose no route, Serve, or Funnel using the detected MagicDNS HTTPS origin. The form saves the route choice for `pnpm selfhosted:install`; install applies it after health checks, with an additional `PUBLIC` confirmation for Funnel. It refuses to overwrite `.env` by default; explicitly pass `--replace-existing` to back it up and preserve database connection settings. It does not start containers and closes after saving or cancellation. A running Docker daemon is required for the read-only existing-volume check before the form starts when creating a new file.

If the `.env` file is missing while the self-hosted PostgreSQL volume still exists, the setup refuses to generate a new database password. Restore the original `.env` (especially `POSTGRES_PASSWORD`) that belongs to that volume before continuing; changing the Compose environment does not change credentials inside an initialized PostgreSQL volume.

- **Manual file:** copy `.env.example` to `.env`, edit the required values, and restrict access to the file (for example, `chmod 600 .env` on Unix-like systems). Keep the template as the single tracked environment example.

Choose `AUTH_BACKEND=none` for browser-local workflows without Rhasia sign-in, or `AUTH_BACKEND=passwordless` with production SMTP for hosted account features. Turnstile is optional for passwordless: leave both keys blank to disable it, or configure both keys to enable it. PostgreSQL-backed email and client-IP rate limits remain active either way. Either auth mode can be combined with Tailscale Serve or Funnel. Use the exact HTTPS MagicDNS origin for `WEB_ORIGIN`; keep `AUTH_TRUST_PROXY_HEADERS=false` with `none`. With passwordless Tailscale exposure, the wizard sets it to `true`; set it manually for equivalent manual setup so the app can use Tailscale's rewritten client-IP forwarding header for authentication rate limits. Enable it only while the Web listener is exposed through the trusted Tailscale proxy. The helper verifies the selected backend and expected `WEB_ORIGIN` in the running Web/API containers, plus the matching `AUTH_APP_ORIGIN` when passwordless is selected; it also checks the Web proxy-trust setting. New configurations generate unique database and application secrets. During explicit replacement, the existing database connection settings are retained while new application secrets are generated. Provider values are not printed by the terminal wizard or displayed after saving in the browser form. Do not enter Vault or TOTP material.

For either interactive configuration path, `pnpm selfhosted:install` runs configuration, setup, startup, and the selected Tailscale route in order; add `--interactive` to use the browser form. If `.env` already exists, install asks whether to reuse it (the default, which skips configuration) or start over. Starting over backs up the old file to `.env.backup-<UTC timestamp>` with mode `0600`, then writes a fresh configuration while preserving `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_HOST_PORT`. The backup stays in the ignored repository root and is not overwritten if a timestamp collides. Serve/Funnel changes happen only after the Web health check succeeds. Funnel requires typing `PUBLIC` at that point. If an existing `.env` is found without an interactive terminal, install stops without changing files; run it from a terminal and choose reuse or start over. Direct `pnpm selfhosted:configure` still refuses to overwrite by default; `--replace-existing` explicitly enables the same backup-and-preserve behavior. If you use the manual file path above, run setup and startup individually:

```bash
pnpm selfhosted:setup
pnpm selfhosted:up
```

When running setup stages individually, choose or enable the optional Tailscale route after startup:

```bash
pnpm selfhosted:tailscale --interactive
```

`selfhosted:setup` verifies the deployment configuration, starts PostgreSQL, and makes a read-only `SELECT 1` authentication check using the configured database credentials before asking for migration confirmation. If credentials do not authenticate, it stops before building or running the migration and instructs you to restore the `.env` that belongs to the existing volume. The API-owned migration runs only after the interactive confirmation. `selfhosted:up` builds and starts the application, then waits for health checks. The Tailscale command runs only after the Web health endpoint is ready. Tailscale must already be installed and connected on the Docker host; the helper requires CLI 1.52 or later and does not install Tailscale, log in, create auth keys, or change tailnet policy.

When using `pnpm selfhosted:install`, the saved Serve or Funnel choice is activated automatically after `pnpm selfhosted:up` reports healthy. Funnel activation requires typing `PUBLIC`; if you run setup stages individually, use `pnpm selfhosted:tailscale --interactive` or the explicit `funnel --confirm-public` command after startup. Funnel makes the application publicly reachable; hosted features require passwordless sign-in when that backend is selected.

The interactive Tailscale step lets the operator choose either mode:

- **Serve** exposes HTTPS within the tailnet. Tailnet ACLs or grants control which people/devices can connect; review that policy separately. With `none`, only local browser features are available. With `passwordless`, hosted features also require Rhasia sign-in.
- **Funnel** exposes HTTPS to the public internet. Tailnet ACLs do not limit visitors to the Funnel URL. The helper requires explicit confirmation. With `none`, visitors can use only browser-local features. With `passwordless`, the login page is public but hosted features require Rhasia sign-in.

The helper forwards Tailscale HTTPS port `443` to `http://127.0.0.1:${APP_PORT:-3000}`. It checks that the running Web and API containers use the selected `AUTH_BACKEND` and the exact MagicDNS `WEB_ORIGIN`, that passwordless containers use the matching `AUTH_APP_ORIGIN`, that Web proxy-header trust matches the selected mode (`false` for `none`, `true` for `passwordless`), and that an exported shell variable cannot make the live app differ from the validated `.env` settings. It also verifies the exact loopback-only Docker port mapping, a healthy app, and an unused HTTPS port. `none` does not use SMTP or Turnstile; passwordless Tailscale exposure requires SMTP and may enable Turnstile by configuring both keys. One Rhasia listener is managed at a time. `--bg` keeps the selected Tailscale route across reboot. Check the locally recorded Rhasia route and disable it with:

```bash
pnpm selfhosted:tailscale status
pnpm selfhosted:tailscale off
```

The helper records only the route it created in ignored `.tailscale-rhasia.json`; disabling checks both Serve and Funnel status before removing it. It does not issue `tailscale serve reset` or `tailscale funnel reset`, and a changed or unknown route is left for operator review. If Tailscale cannot confirm that a failed activation left both modes clear, the local marker is retained for review. The app and PostgreSQL containers remain on the private Compose network; only the Web port is published on host loopback.

Tailscale terminates HTTPS on the host and forwards HTTP over loopback to the Web container. The host and its Tailscale daemon remain inside the operator's trust boundary. Serve/Funnel provide network reachability; they do not create Rhasia identities or replace passwordless sign-in for hosted APIs. Neither mode protects a compromised host. Keep Docker Engine at 28.0.0 or later, or add a host firewall rule: Docker documents that localhost-published ports could be reachable from adjacent L2 hosts on earlier Engine versions. A different HTTPS reverse proxy can use an explicit `APP_BIND_ADDRESS` override; that listener may bypass Tailscale Serve access policy. The Tailscale helper supports the node's MagicDNS origin; use a separately managed proxy for custom domains.

This repository setup configures one selected Tailscale mode on HTTPS port `443`. The command-line helpers and fake-CLI tests verify the local configuration contract; they do not establish that a particular tailnet allows Serve or Funnel or that the host firewall prevents LAN access. Funnel is always publicly reachable, while hosted features still require passwordless sign-in when selected. Record the chosen mode and the corresponding tailnet/public reachability with the deployment before treating it as production-verified.

For a manual host CLI workflow, after `.env` is configured and `pnpm selfhosted:up` reports healthy:

```bash
# Tailnet-only
tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve status --json

# Public internet: verify the prompt and policy approval before enabling
tailscale funnel --bg --https=443 http://127.0.0.1:3000
tailscale funnel status --json

# Disable only the listener configured above
tailscale serve --bg --https=443 http://127.0.0.1:3000 off
# or
tailscale funnel --bg --https=443 http://127.0.0.1:3000 off
```

The manual examples use the default host port `3000`; replace it with the `APP_PORT` value from `.env` if you configured another port. The repository helper reads `.env` and checks the running Docker port mapping before it configures Tailscale.

Funnel supports only Tailscale HTTPS ports `443`, `8443`, and `10000`; the repository helper intentionally uses `443`. Read the upstream [Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve) and [Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel) documentation before changing the command or host-port contract.

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

Run both processes behind an HTTPS proxy that forwards the original host/protocol correctly. If the web proxy strips and replaces forwarded headers, set `AUTH_TRUST_PROXY_HEADERS=true`; otherwise leave it `false` so client-supplied forwarding metadata is ignored. For a local self-hosted Compose deployment, run the complete interactive install:

```bash
pnpm selfhosted:install
curl --fail --silent --show-error http://127.0.0.1:${APP_PORT:-3000}/healthz
```

Use `pnpm selfhosted:install --interactive` to enter configuration in the local browser form. The command runs `selfhosted:configure`, `selfhosted:setup`, and `selfhosted:up` in order, passing `--interactive` only to the configure step, then applies the selected Tailscale route after health checks. When `.env` exists, choose to reuse it or start over with a timestamped backup; database connection settings are retained when starting over. Funnel still requires typing `PUBLIC`. It stops immediately if a step fails. Setup still requires an interactive `yes` confirmation before applying migrations. To run the stages separately or use the setup defaults without the configuration wizard, run `pnpm selfhosted:setup` and then `pnpm selfhosted:up`.

`selfhosted:setup` creates `.env` only when it is absent and repairs only
non-database `replace-with-*` placeholders in an existing file. Set
`POSTGRES_PASSWORD` manually; setup never rotates an existing database
credential. It generates local secrets, preserves configured values, verifies
Docker and the application environment, starts PostgreSQL,
and applies the API-owned migrations after an interactive `yes` confirmation.
It defaults a newly created environment to `AUTH_BACKEND=none`; configure
passwordless in `.env` before `selfhosted:up` when hosted authentication is
required. Rerun setup to validate changed authentication configuration before
migrating again. Compose containers use production
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

To intentionally discard all data in the self-hosted PostgreSQL volume, run
`pnpm selfhosted:clean`. It requires a TTY and asks you to type the exact
Compose volume name (`rhasia-scret-selfhosted_postgres-data`) before making
changes. After confirmation, it stops and removes only the self-hosted Compose
project, then deletes only that PostgreSQL volume. It does not use broad Docker
volume-prune commands, and it does not change Tailscale Serve or Funnel
configuration. Back up the database first if you may need its contents. A
declined or unavailable terminal confirmation leaves the stack and volume
untouched. Use `selfhosted:down` when you want to stop services while keeping
the data.

The self-hosted commands intentionally keep PostgreSQL private on the
Compose network; the development-only override remains available for
`pnpm dev:db` when host-side database access is needed. The API runtime uses a
production-only deployment without Prisma's CLI or TypeScript tooling. The
migration image has a dedicated `apps/api/Dockerfile.migration` and installs the
focused dependency manifest in `tools/api-migration-runtime/`. It copies only
the migration dependency tree, generated Prisma Client, migration scripts,
schema, and migrations onto a pinned Alpine runtime with the Node.js binary;
Prisma generation uses the matching musl and OpenSSL platform. The final image
does not include pnpm/Corepack, TypeScript, React, PGlite, or `tsx`: esbuild
compiles the migration scripts during image preparation. It retains the Prisma
CLI, PostgreSQL adapter/client, and `dotenv`, and removes Prisma query-compiler
assets for non-PostgreSQL providers because the API schema uses PostgreSQL.
The web runtime uses an Alpine Node image and Next standalone output. The named volume survives
`selfhosted:down`; use `selfhosted:clean` with its exact-name confirmation to
permanently delete it after backing up or retiring the data.

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

Set `AUTH_BACKEND=passwordless`, the API-only `AUTH_*` values, and the server-only Bun SMTP values. Turnstile is optional; set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` together, or leave both empty. Local self-hosted Compose may use the documented Cloudflare Turnstile testing pair from `.env.example` when both `WEB_ORIGIN` and `AUTH_APP_ORIGIN` are localhost or `127.0.0.1`; non-local production origins still reject testing keys. Without Turnstile, anonymous email and client-IP rate limits remain enabled. The user flow is:

1. The web browser submits an email and the `web` or `pwa` client audience.
2. The server persists only a keyed token digest and sends a bilingual email.
3. The raw token appears only in the URL fragment.
4. The browser clears the fragment before redemption.
5. Redemption atomically consumes the challenge, provisions/loads `rhasia:passwordless`, and creates a database session.
6. The website uses HttpOnly same-site cookies and a signed browser assertion; PWA session separation uses the verifier-backed handoff.

Requests are limited to five per normalized email and twenty per IP per 15-minute window. Sessions use keyed digests, short-lived access credentials, the verifier-backed PWA refresh handoff, reuse detection, revocation, and redacted security events. Browser keepalive validates the signed browser assertion without rotating a refresh credential, avoiding Strict Mode and concurrent-load races. No raw token, session credential, IP address, Vault material, or decrypted content is persisted or logged.

### 4. Configure no-sign-in mode

Set `AUTH_BACKEND=none` when Rhasia sign-in is disabled. Hosted Personal/Shared Vault, synchronization, memberships, audit, and recovery APIs fail closed in this mode. The UI can still be exposed through Tailscale Serve or Funnel for browser-local workflows. Serve access follows tailnet ACLs/grants; Funnel is public and has no application login. Tailscale access does not create an application identity or enable hosted APIs. Passwordless email-link authentication remains the only supported hosted sign-in method and can also be used with Tailscale when SMTP and trusted-proxy settings are configured; Turnstile can be enabled by configuring both keys. Explicit unsupported backends fail deployment validation rather than falling back.

If the selected backend is malformed or incomplete, protected web routes redirect to the localized `/sign-in?auth=configuration_error` state rather than looking unauthenticated. A serverless API composition returns `{ "error": "authentication_misconfigured" }` with HTTP 503, `Cache-Control: no-store`, and an opaque request ID; the web proxy forwards it without exposing parser text. Standalone Bun/Node startup logs only a fixed category, bounded configuration field, and startup correlation marker before exiting, so no listener is advertised as ready. The existing `api_misconfigured` dependency response remains distinct from authentication configuration failures.

### 5. Configure HTTPS and browser security

Use one exact HTTPS origin for Tailscale-exposed deployments. Local self-hosting may use `http://localhost` or `http://127.0.0.1`; HTTPS remains required for non-local origins. `AUTH_APP_ORIGIN` and `PASSKEY_ORIGIN` are needed only for their respective passwordless/passkey features. The installable PWA uses the same web routes, browser cookies, and service-worker cache policy as the website.

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

Do not use production credentials, real accounts, user-provided account data, Vault content, secrets, tokens, or keys in a smoke test. Use synthetic, non-PII identities with reserved example domains and dummy labels. Before merge or release, run a fresh root `pnpm run test:full`.

## Operational handoff checklist

Retain a dated, redacted record of host/runtime and commit SHA; PostgreSQL TLS, pooled/direct endpoint, migration, backup/PITR, and restore evidence; selected authentication backend, secret rotation, session/revocation review, and callback checks; association-document checks; retention scheduler output; security-header/cache/source-map checks; and the final verification result. Record only opaque IDs, counts, timestamps, and exit status.
