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
- `EMAIL_PROVIDER_URL`, `EMAIL_PROVIDER_TOKEN`, `AUTH_EMAIL_FROM`, and `AUTH_EMAIL_FROM_NAME` for API-only HTTP email delivery.

The API validates the provider endpoint and sends mail over HTTPS. Never expose API credentials through `NEXT_PUBLIC_` or `EXPO_PUBLIC_` variables.

`AUTH_BACKEND=none` remains available for local-only deployments. `AUTH_BACKEND=oidc` remains an optional provider adapter with its existing server-only configuration. Invalid or incomplete selected-backend configuration fails closed and must fail deployment validation.

## Link and session security

`POST /api/v1/auth/magic-link/request` accepts `web`, `pwa`, or `mobile` and a bounded continuation path. Browser and installed-PWA requests must provide a one-time Cloudflare Turnstile token; the server validates it before rate-limit or magic-link work. Native requests do not carry a browser widget token and remain protected by the PostgreSQL limits. PWA requests also carry a bounded opaque PWA handoff identifier and verifier; the database stores only their keyed digests, normalized request email, and permitted lifecycle metadata. It requires same-origin requests for web/PWA clients, applies PostgreSQL-backed anonymous limits of five requests per normalized email and, when `AUTH_TRUST_PROXY_HEADERS=true` is enabled for a header-rewriting proxy, twenty per forwarded client IP per 15-minute window, and returns a generic result without account enumeration. The database stores only the HMAC token digest, normalized email, client audience, purpose, bounded return path, expiry, and consumption timestamp for the challenge, plus the verifier-backed PWA handoff row. It never stores raw tokens, handoff values, IP addresses, URLs, or email-delivery provider payloads.

Email links carry the raw one-time token and bounded routing hints in the URL fragment. PWA links use `/auth/pwa-confirm` and include only their opaque handoff identifier; the browser confirmation page clears the fragment with `history.replaceState` before exchanging it. A browser callback never persists or logs the PWA refresh credential: it sends it only in the same-origin PWA-session publisher request, which rotates it and binds its session only to an email-matching verifier-backed handoff row. The receiving PWA polls with its session-scoped handoff identifier and verifier; `POST /api/v1/auth/pwa/session` atomically consumes the row before setting HttpOnly cookies in the receiving PWA. If the callback opens in a separate PWA window, the original sign-in window supplies the session-scoped verifier through a one-shot, handoff-ID-matched same-origin `BroadcastChannel` response; the refresh credential never crosses that channel. The invitation Secure Share Link secret is never added to the magic-link request or email URL; an open invitation tab retains that secret in client memory and receives the authentication-completion announcement. `POST /api/v1/auth/magic-link/redeem` atomically consumes the digest, provisions or loads the local `ExternalIdentity`, and creates a database-backed session. Web/PWA sessions use HttpOnly same-site cookies plus a signed browser assertion; native sessions keep opaque access and refresh credentials only in Keychain/Keystore-backed secure storage.

Access and refresh credentials are stored as keyed digests. Native refresh credentials rotate atomically. Browser session keepalive validates the signed browser assertion without consuming or rotating the refresh credential, so React Strict Mode and concurrent browser loads cannot race the rotation protocol; the browser assertion and database session retain the configured refresh lifetime. Reuse of an already rotated credential revokes that session, records a redacted security event, and never reveals whether the credential belonged to a live account. Logout revokes only the current session and is idempotent. The retention job removes expired challenges, revoked/expired sessions, and anonymous rate-limit windows; redacted identity security events remain available for their normal retention policy.

## Hosted account deletion

The Account Deletion workflow uses `GET /api/v1/me/deletion/preview`,
`POST /api/v1/me/deletion/otp/request` and `/otp/verify` for passwordless
reauthentication, `POST /api/v1/me/deletion/oidc/start` for OIDC reauthentication,
and `DELETE /api/v1/me` for the final synchronous hard deletion. All mutation
routes require a same-origin browser request and authenticated application
mutation rate limits. Passwordless deletion OTPs are six digits, expire after
10 minutes, are single-use, and lock after five failed attempts. OIDC starts
with `prompt=login` and `max_age=0` and does not add an OTP.

The final request must include fresh authorization, exact `HAPUS AKUN`, an
acknowledgement, and a decision for every owned Shared Vault. A selected
client-generated archive failure blocks deletion; skipping backup requires a
separate acknowledgement. The server stores no archive bytes or keys. A
successful deletion removes all hosted user data and sessions in one
transaction, retains only the documented non-FK ledger/tombstones and
aggregate metric, and sends a best-effort completion email containing only the
opaque receipt ID. Identity tombstones preserve timestamp-aware invalidation of
pre-deletion OIDC sessions and passwordless links while allowing a fresh
registration with the same identity.

## Identity and migration

Local passwordless identities use issuer `rhasia:passwordless` and a random subject. `ExternalIdentity` remains unique by `(issuer, subject)` and remains the only identity-to-`ApplicationUser` binding. Future Firebase, OIDC, or other providers create separate identity rows. Linking requires explicit reauthentication; email similarity never performs an automatic merge.

The migration is intentionally staged. For production, put the pooled `DATABASE_URL` and direct `DIRECT_URL` in the ignored `.env.prod` file and run `pnpm prod:db:migrate`. It builds the focused migration image, applies all migrations through the additive authentication migration, runs preflight, seeds one local identity per existing Application User by that existing user ID, performs staged verification while the legacy column is retained, and only then applies the guarded cleanup migration and remaining migrations. It does not start the Compose-local database dependency. The command is safe to rerun after an interrupted deployment and performs final migration verification; record counts only, never emails, tokens, or database values.

For a local non-container database, `pnpm run prisma:migrate:deploy` remains the lower-level migration command.

If preflight, seeding, or staged verification fails, the runner stops before the destructive migration. There is no dual-auth fallback or compatibility session path; rollback after the final migration requires restoring the database backup and deploying the previous application version.

Database migration generation, application, resolution, reset, and deployment require explicit human approval for the target environment. An agent must not infer that approval from test or verification requirements.

## Route protection and logout

The proxy verifies the signed browser assertion optimistically, while every page/API authorization seam verifies the corresponding database session and active `ApplicationUser` status. Proxy is not the authorization boundary. Protected pages are `/vaults` and descendants plus `/totp`. Public authentication routes are `/sign-in`, `/auth/confirm`, `/auth/pwa-confirm`, `/auth/complete`, `/api/v1/auth/magic-link/*`, `/api/v1/auth/pwa/session`, `/api/v1/auth/session/*`, and same-origin `POST /auth/logout`.

Web/PWA logout rejects missing or different `Origin`, revokes the current database session, clears all local auth cookies, and redirects with a redacted status. Native logout sends its bearer access credential to `/v1/auth/session/revoke`, then clears secure storage locally.
