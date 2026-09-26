# Passwordless authentication configuration

The hosted deployment uses self-managed passwordless email authentication by default. A person enters an email address, receives one generic sign-in link, and is either signed in or signed up after redeeming it. The UI never exposes a signup mode, and an email match never links two existing identities.

## Server configuration

Set `AUTH_BACKEND=passwordless` and configure:

- `AUTH_APP_ORIGIN`: the exact HTTPS application origin, without path, query, fragment, or credentials. HTTP localhost is allowed outside production.
- `AUTH_TRUST_PROXY_HEADERS`: optional `false`/`true` switch; enable only when a trusted HTTPS proxy strips and replaces forwarded host, protocol, and client-IP headers.
- `AUTH_MOBILE_REDIRECT_URL`: optional native callback override. Use the exact web `/auth/mobile` callback, or `rhasia-scret://auth/magic-link` only in development. It may not contain query, fragment, credentials, or an unapproved host/path.
  The API owns the following passwordless-only values and they must not be provided to the web runtime: `AUTH_MAGIC_LINK_SECRET`, `AUTH_MAGIC_LINK_TTL_SECONDS`, `AUTH_ACCESS_TOKEN_TTL_SECONDS`, and `AUTH_REFRESH_TOKEN_TTL_SECONDS`.
- `AUTH_SESSION_SECRET`: a shared, independently generated value of at least 32 random characters used by the API for sessions and by web/API verification for browser assertions.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: public Cloudflare Turnstile site key rendered by browser and installed-PWA sign-in forms.
- `TURNSTILE_SECRET_KEY`: server-only Cloudflare Turnstile secret used to validate browser tokens. For local development, use the always-pass testing pair documented by Cloudflare; production configuration rejects those testing keys.
- API runtimes: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, `AUTH_EMAIL_FROM`, and `AUTH_EMAIL_FROM_NAME` for the server-only Nodemailer adapter. The same settings are used by Bun, self-hosted Node.js, and Vercel API deployments.

All API runtimes use Nodemailer exclusively. SMTP port 587 requires STARTTLS; implicit TLS uses port 465 with `SMTP_SECURE=true`. Port 25 is not supported. API request logs contain only a correlation ID, method, path, status, and duration; magic-link dependency failures add a fixed dependency/client label and bounded timing, while Turnstile failures may add only a fixed failure reason and HTTP status, and allowlisted SMTP/database transport codes may be included without messages. Request bodies, cookies, authorization headers, provider payloads, email addresses, and tokens are never logged. The Web API proxy logs only configuration or transport failures because the API owns implementation-route access logs. Never expose API credentials through `NEXT_PUBLIC_` or `EXPO_PUBLIC_` variables.

`AUTH_BACKEND=none` remains available for local-only deployments, and `passwordless` is the only hosted authentication backend. Explicit `oidc` and any other unsupported value fail closed rather than selecting another backend. Invalid or incomplete configuration must fail deployment validation. Non-production runtimes retain the passwordless default; production deployment and runtime validation require `AUTH_BACKEND` to be explicit. Legacy OIDC-only values in ignored local environment files are not bound or forwarded to application runtimes; if such a file still sets `AUTH_BACKEND=oidc`, startup intentionally fails until the operator changes that file manually.

## Configuration failure behavior

Configuration failures are classified separately from an absent or expired session. The web proxy never converts an invalid or unsupported backend, origin, session secret, or other configuration failure into `none` or `auth=required`; protected pages redirect to `/sign-in?auth=configuration_error`, preserving the safe invitation continuation when present. The public sign-in page validates the web-owned configuration before querying the hosted API, skips that query for explicit `none`, and renders the localized configuration state without raw parser text.

When a lazy/serverless API composition detects invalid authentication configuration, it returns the additive contract `{ "error": "authentication_misconfigured" }` with HTTP 503, `Cache-Control: no-store`, and the opaque request ID header. The web proxy forwards that response unchanged, and hosted sign-in maps it to the same localized configuration state. Existing missing database or email bindings continue to return `api_misconfigured` with HTTP 503; transient SMTP, database, and Turnstile failures retain their dependency-specific outcomes.

Standalone Bun/Node startup validates authentication composition before creating the HTTP listener. Invalid configuration emits only the fixed startup event, bounded field name, and startup correlation marker, then exits without advertising readiness. Health and time remain lightweight system routes and do not initialize the full request runtime. No response, redirect, log, analytics event, cookie, or query parameter contains secret values, provider payloads, tokens, cookies, authorization headers, or raw configuration values.

The API error is additive for mixed-version deployment: an older web runtime may retain generic 503 handling, while an updated web runtime recognizes `authentication_misconfigured`. Rollback is application-only; no database migration or data operation is required.

## Link and session security

`POST /api/v1/auth/magic-link/request` accepts `web`, `pwa`, or `mobile` and a bounded continuation path. Browser and installed-PWA requests must provide a one-time Cloudflare Turnstile token; the server validates it before rate-limit or magic-link work. Native requests do not carry a browser widget token and remain protected by the PostgreSQL limits. PWA requests also carry a bounded opaque PWA handoff identifier and verifier; the database stores only their keyed digests, normalized request email, and permitted lifecycle metadata. It requires same-origin requests for web/PWA clients, applies PostgreSQL-backed anonymous limits of five requests per normalized email and, when `AUTH_TRUST_PROXY_HEADERS=true` is enabled for a header-rewriting proxy, twenty per forwarded client IP per 15-minute window. Requests without a verified proxy-derived client IP use a separate shared unattributed budget rather than bypassing the IP-side limit, and the API accepts the proxy-derived IP only through the authenticated web proxy marker. It returns a generic result without account enumeration. The database stores only the HMAC token digest, normalized email, client audience, purpose, bounded return path, expiry, and consumption timestamp for the challenge, plus the verifier-backed PWA handoff row. It never stores raw tokens, handoff values, IP addresses, URLs, or email-delivery provider payloads.

Email links carry the raw one-time token and bounded routing hints in the URL fragment. PWA links use `/auth/pwa-confirm` and include only their opaque handoff identifier; the browser confirmation page clears the fragment with `history.replaceState` before exchanging it. A browser callback never persists or logs the PWA refresh credential: it sends it only in the same-origin PWA-session publisher request, which rotates it and binds its session only to an email-matching verifier-backed handoff row. The receiving PWA polls with its session-scoped handoff identifier and verifier; `POST /api/v1/auth/pwa/session` atomically consumes the row before setting HttpOnly cookies in the receiving PWA. If the callback opens in a separate PWA window, the original sign-in window supplies the session-scoped verifier through a one-shot, handoff-ID-matched same-origin `BroadcastChannel` response; the refresh credential never crosses that channel. The invitation Secure Share Link secret is never added to the magic-link request or email URL; an open invitation tab retains that secret in client memory and receives the authentication-completion announcement. `POST /api/v1/auth/magic-link/redeem` atomically consumes the digest, provisions or loads the local `ExternalIdentity`, and creates a database-backed session. Web/PWA sessions use HttpOnly same-site cookies plus a signed browser assertion; native sessions keep opaque access and refresh credentials only in Keychain/Keystore-backed secure storage.

Access and refresh credentials are stored as keyed digests. Native refresh credentials rotate atomically. Browser session keepalive validates the signed browser assertion without consuming or rotating the refresh credential, so React Strict Mode and concurrent browser loads cannot race the rotation protocol; the browser assertion and database session retain the configured refresh lifetime. Reuse of an already rotated credential revokes that session, records a redacted security event, and never reveals whether the credential belonged to a live account. Logout revokes only the current session and is idempotent. The retention job removes expired challenges, revoked/expired sessions, and anonymous rate-limit windows; redacted identity security events remain available for their normal retention policy.

## Hosted account deletion

The Account Deletion workflow uses `GET /api/v1/me/deletion/preview`,
`POST /api/v1/me/deletion/otp/request` and `/otp/verify` for passwordless
reauthentication, and `DELETE /api/v1/me` for the final synchronous hard deletion.
All mutation routes require a same-origin browser request and authenticated
application mutation rate limits. Deletion OTPs are six digits, expire after
10 minutes, are single-use, and lock after five failed attempts.

The final request must include fresh authorization, exact `HAPUS AKUN`, an
acknowledgement, and a decision for every owned Shared Vault. A selected
client-generated archive failure blocks deletion; skipping backup requires a
separate acknowledgement. The server stores no archive bytes or keys. A
successful deletion removes all hosted user data and sessions in one
transaction, retains only the documented non-FK ledger/tombstones and
aggregate metric, and sends a best-effort completion email containing only the
opaque receipt ID. Identity tombstones preserve timestamp-aware invalidation of
credentials issued before deletion while allowing a fresh passwordless
registration with the same identity.

## Identity and migration

Local passwordless identities use issuer `rhasia:passwordless` and a random subject. `ExternalIdentity` remains provider-neutral, unique by `(issuer, subject)`, and is the only identity-to-`ApplicationUser` binding. No identity-linking or provider-migration flow is exposed; email similarity never links accounts. A future authentication adapter requires a separate architecture and security decision.

The migration is intentionally staged. For production, put the pooled `DATABASE_URL` and direct `DIRECT_URL` in the ignored `.env.prod` file and run `pnpm prod:db:migrate`. It builds the standalone focused migration Compose project, which requires only `DATABASE_URL`, `DIRECT_URL`, `COMMIT_SHA`, and `NODE_ENV`; application runtime secrets such as `PROXY_SECRET` and SMTP credentials are not needed. It applies all migrations through the additive authentication migration, runs preflight, seeds one local identity per existing Application User by that existing user ID, performs staged verification while the legacy column is retained, and only then applies the guarded cleanup migration and remaining migrations. It does not start the Compose-local database dependency. The command is safe to rerun after an interrupted deployment and performs final migration verification; record counts only, never emails, tokens, or database values.

For a local non-container database, `pnpm run prisma:migrate:deploy` remains the lower-level migration command.

If preflight, seeding, or staged verification fails, the runner stops before the destructive migration. There is no dual-auth fallback or compatibility session path; rollback after the final migration requires restoring the database backup and deploying the previous application version.

Database migration generation, application, resolution, reset, and deployment require explicit human approval for the target environment. An agent must not infer that approval from test or verification requirements.

## Route protection and logout

The proxy verifies the signed browser assertion optimistically, while every page/API authorization seam verifies the corresponding database session and active `ApplicationUser` status. Proxy is not the authorization boundary. Protected pages are `/vaults` and descendants plus `/totp`. Public authentication routes are `/sign-in`, `/auth/confirm`, `/auth/pwa-confirm`, `/auth/complete`, `/api/v1/auth/magic-link/*`, `/api/v1/auth/pwa/session`, `/api/v1/auth/session/*`, and same-origin `POST /auth/logout`.

Web/PWA logout rejects missing or different `Origin`, revokes the current database session, clears all local auth cookies, and redirects with a redacted status. Native logout sends its bearer access credential to `/v1/auth/session/revoke`, then clears secure storage locally.
