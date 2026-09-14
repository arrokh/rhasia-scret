# Supported self-hosting

This guide describes the supported deployment contract for rhasia-scret. The web application is a Node.js Next.js server backed by PostgreSQL and Prisma; it is not a static export. The server may handle encrypted content and permitted authorization/lifecycle metadata, but must never receive or log Vault Names, authenticator labels, TOTP configuration, OTPs, QR data, Vault keys, passphrases, private keys, or decrypted content.

## Supported deployment matrix

| Layer                 | Reference                                         | Supported alternatives                                                        | Unsupported                                                                              |
| --------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Web host              | Vercel with Node.js 24.x                          | Checked-in Docker Compose or another Node.js host behind HTTPS                | Static export or edge-only API runtime                                                   |
| Database              | PostgreSQL 16 compatibility target                | Managed/operator-run PostgreSQL with TLS and separate pooled/direct endpoints | SQLite, MySQL, browser database access                                                   |
| Web authentication    | `passwordless` (default), or optional `oidc`      | `none` for local-only browser work                                            | Password-based app auth, email-based account merging, second identity authority          |
| Native authentication | Self-managed passwordless links from the web host | Development `rhasia-scret://` link scheme                                     | Production custom-scheme-only links, native Local Vault, native WebAuthn PRF assumptions |

All providers must satisfy PostgreSQL compatibility, TLS, backup/PITR, restore, retention scheduling, least-privilege access, and pooled/direct connection requirements. CI PostgreSQL proves application compatibility; it is not production infrastructure.

## Prerequisites and boundaries

Use mise-managed Node.js `24.19.0` and pnpm `11.17.0`, PostgreSQL 16 or compatible, Docker Compose when containerized, Playwright browsers for browser checks, and Java/native tooling only for Expo release builds. Keep Prisma, authentication, retention, and API routes server-only. Never add browser database access or a client-side database API.

The Compose reference provisions PostgreSQL 16, applies migrations before starting the web process, publishes only the web port, and schedules the bounded retention purge daily. Operators still own HTTPS termination, secret management, backups, monitoring, host hardening, and restore drills.

## Environment contract

Copy the single root `.env.example` to `.env`. It separates shared database/Prisma values, hosted web server values, browser-visible `NEXT_PUBLIC_*` values, native-visible `EXPO_PUBLIC_*` values, and Docker Compose bootstrap values. `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` values must contain public values only. Never create app-local `.env` files or commit a credential-bearing URL, SMTP password, authentication secret, database password, session credential, cron secret, token, or key.

### Web and server variables

| Variable                                                                                          | Required when                            | Notes                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_BACKEND`                                                                                    | Every deployment; explicit in production | `none`, `passwordless`, or `oidc`; defaults to `passwordless` outside explicit production configuration.                        |
| `AUTH_APP_ORIGIN`                                                                                 | `passwordless`                           | Exact HTTPS origin without path/query/fragment/credentials. HTTP localhost is allowed outside production.                       |
| `AUTH_TRUST_PROXY_HEADERS`                                                                        | Optional                                 | `false` by default. Set `true` only when a trusted HTTPS proxy strips/replaces forwarded host, protocol, and client-IP headers. |
| `AUTH_MOBILE_REDIRECT_URL`                                                                        | Optional                                 | Exact `/auth/mobile` callback, or development-only `rhasia-scret://auth/magic-link`.                                            |
| `AUTH_MAGIC_LINK_SECRET`                                                                          | `passwordless`                           | Independent random server secret, at least 32 characters; HMACs link tokens and anonymous buckets.                              |
| `AUTH_SESSION_SECRET`                                                                             | `passwordless`                           | Different independent random server secret, at least 32 characters; HMACs session credentials and signs browser assertions.     |
| `AUTH_MAGIC_LINK_TTL_SECONDS`                                                                     | `passwordless`                           | 60–3,600 seconds; default 900.                                                                                                  |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS`                                                                   | `passwordless`                           | 60–86,400 seconds; default 900.                                                                                                 |
| `AUTH_REFRESH_TOKEN_TTL_SECONDS`                                                                  | `passwordless`                           | 3,600–31,536,000 seconds; default 2,592,000.                                                                                    |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`                                       | `passwordless`                           | Server-only Nodemailer transport. Use implicit TLS on 465 or STARTTLS on 587/25; production port 25 is rejected.                |
| `SMTP_USER`, `SMTP_PASSWORD`                                                                      | `passwordless`                           | Server-only SMTP credentials; never log or expose.                                                                              |
| `AUTH_EMAIL_FROM`, `AUTH_EMAIL_FROM_NAME`                                                         | `passwordless`                           | Authentication-only sender; address must be valid and display name cannot contain newlines.                                     |
| `DATABASE_URL`                                                                                    | Hosted web process                       | Runtime Prisma URL; use TLS in production.                                                                                      |
| `DIRECT_URL`                                                                                      | Prisma CLI                               | Direct migration/admin URL; production pooled and direct endpoints must be distinct.                                            |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_SESSION_SECRET` | `oidc`                                   | Existing server-only OIDC adapter settings; production callback and issuer use HTTPS.                                           |
| `OIDC_AUDIENCE`, `AUTH_ADMITTED_EMAILS`                                                           | Optional OIDC policy                     | Audience and verified-email admission policy; not a membership list.                                                            |
| `PASSKEY_RP_ID`, `PASSKEY_ORIGIN`                                                                 | Passkey recovery/unlock                  | Server-only WebAuthn settings; origin and RP hostname must agree.                                                               |
| `MOBILE_APPLE_TEAM_ID`, `MOBILE_ANDROID_CERT_SHA256`                                              | Verified native links                    | Optional association-document values; malformed values fail closed.                                                             |
| `CRON_SECRET`                                                                                     | Retention scheduler                      | At least 32 random server characters; required by the scheduler route.                                                          |
| `NEXT_PUBLIC_POSTHOG_*`, `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN`                             | Optional analytics                       | Public values only; analytics is off when unset.                                                                                |

Run `pnpm run verify:deployment-config` before deployment. Use `VERIFY_DEPLOYMENT_PRODUCTION=1` to enforce production requirements. It validates URL shape, backend configuration, secret length, SMTP settings, mobile signing values, PostgreSQL endpoints, and conditional variables without printing their values.

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

For a Node host:

```bash
mise install
mise run setup
pnpm install --frozen-lockfile
pnpm run prisma:generate
pnpm run prisma:validate
pnpm run build
pnpm start
```

Run the process behind an HTTPS proxy that forwards the original host/protocol correctly. If the proxy strips and replaces forwarded headers, set `AUTH_TRUST_PROXY_HEADERS=true`; otherwise leave it `false` so client-supplied forwarding metadata is ignored. For Compose:

```bash
cp .env.example .env
# Set the Shared workspace database, Hosted web service, Native mobile build,
# and Docker Compose values required by the deployment you are running.
COMMIT_SHA="$(git rev-parse --short HEAD)" docker compose -f docker-compose.yml config --quiet
COMMIT_SHA="$(git rev-parse --short HEAD)" docker compose -f docker-compose.yml up --build -d
curl --fail --silent --show-error http://127.0.0.1:${APP_PORT:-3000}/api/health
```

Do not publish the database port. The named volume survives `docker compose down`; back it up before retiring it.

### 2. Apply PostgreSQL schema and identity migration

Set `DATABASE_URL` to the pooled runtime endpoint and `DIRECT_URL` to the direct migration endpoint. From a controlled runner:

```bash
pnpm run prisma:generate
pnpm run prisma:validate
VERIFY_DEPLOYMENT_PRODUCTION=1 pnpm run verify:deployment-config
pnpm run verify:prisma-connections
# Applies migrations through the additive auth state, runs preflight,
# seeds and verifies local identities, then applies guarded cleanup.
pnpm run prisma:migrate:deploy
pnpm run verify:passwordless-migration
```

The authentication deployment runner is staged. It applies only migrations through the additive auth-state migration, runs preflight, seeds one local identity per existing `ApplicationUser` by that existing ID, verifies the staged mapping while the legacy subject column remains available, and only then applies the guarded cleanup and remaining migrations. It is safe to rerun after an interrupted deployment.

Preflight rejects invalid or colliding normalized Application User emails. Seeding never matches users by email, never merges identities, and leaves existing External Identity rows, user IDs, Vaults, memberships, ciphertext, crypto profiles, recovery records, and audit history untouched. If preflight, seeding, or staged verification fails, the destructive migration is not applied. After the final migration there is no provider-session compatibility path; rollback requires restoring a database backup and deploying the previous application version.

### 3. Configure passwordless authentication

Set `AUTH_BACKEND=passwordless`, all `AUTH_*` values, and the server-only SMTP values. The user flow is:

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

### 5. Configure HTTPS and verified links

Use one exact HTTPS origin for `AUTH_APP_ORIGIN`, `PASSKEY_ORIGIN`, `EXPO_PUBLIC_WEB_ORIGIN`, and the web/native routes. Verify these association documents without redirects when native is enabled:

- `/.well-known/apple-app-site-association`
- `/.well-known/assetlinks.json`

The accepted native paths are `/auth/mobile` and `/vaults/invitations/redeem`. The custom scheme is development-only and does not prove production verified links.

### 6. Schedule retention purge

The daily scheduler calls:

```bash
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  https://app.example.com/api/internal/retention-purge
```

Resolve the secret at execution time. The bounded purge removes expired account/vault data, authentication challenges, expired/revoked sessions, and anonymous rate-limit windows. It reports only opaque IDs, counts, and backlog flags; identity security events follow their own retention policy. The database operator owns encrypted backups/PITR and restore drills.

## Clean local smoke test

```bash
mise install
mise run setup
cp .env.example .env
pnpm install --frozen-lockfile
pnpm run prisma:generate
pnpm run prisma:validate
AUTH_BACKEND=none pnpm run verify:deployment-config
pnpm run prisma:migrate:deploy
AUTH_BACKEND=none pnpm run build
pnpm run test:browser:smoke
```

Do not use production credentials, real accounts, Vault content, secrets, tokens, or keys in a smoke test. Before merge or release, run a fresh root `pnpm run test:full`; native release evidence additionally requires the Android and iOS simulator build commands.

## Operational handoff checklist

Retain a dated, redacted record of host/runtime and commit SHA; PostgreSQL TLS, pooled/direct endpoint, migration, backup/PITR, and restore evidence; selected authentication backend, secret rotation, session/revocation review, and callback checks; association-document checks; retention scheduler output; security-header/cache/source-map checks; and the final verification result. Record only opaque IDs, counts, timestamps, and exit status.
