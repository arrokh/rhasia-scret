# Passwordless authentication configuration

The hosted deployment uses self-managed passwordless email authentication by default. A person enters an email address, receives one generic sign-in link, and is either signed in or signed up after redeeming it. The UI never exposes a signup mode, and an email match never links two existing identities.

## Server configuration

Set `AUTH_BACKEND=passwordless` and configure:

- `AUTH_APP_ORIGIN`: the exact HTTPS application origin, without path, query, fragment, or credentials. HTTP localhost is allowed outside production.
- `AUTH_TRUST_PROXY_HEADERS`: optional `false`/`true` switch; enable only when a trusted HTTPS proxy strips and replaces forwarded host, protocol, and client-IP headers.
- `AUTH_MOBILE_REDIRECT_URL`: optional native callback override. Use the exact web `/auth/mobile` callback, or `rhasia-scret://auth/magic-link` only in development. It may not contain query, fragment, credentials, or an unapproved host/path.
- `AUTH_MAGIC_LINK_SECRET`: at least 32 random characters used only to HMAC magic-link tokens and anonymous rate-limit buckets.
- `AUTH_SESSION_SECRET`: a different, independently generated value of at least 32 random characters used only to HMAC session credentials and sign the browser assertion.
- `AUTH_MAGIC_LINK_TTL_SECONDS`: link lifetime from 60 to 3,600 seconds; the default is 900.
- `AUTH_ACCESS_TOKEN_TTL_SECONDS`: access lifetime from 60 to 86,400 seconds; the default is 900.
- `AUTH_REFRESH_TOKEN_TTL_SECONDS`: refresh lifetime from 3,600 to 31,536,000 seconds; the default is 2,592,000.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, `AUTH_EMAIL_FROM`, and `AUTH_EMAIL_FROM_NAME` for server-only Nodemailer delivery.

Use implicit TLS on port 465 or STARTTLS on port 587/25 with certificate verification enabled. Production deployments must not use port 25. Configure SPF, DKIM, and DMARC for the authentication sender domain and keep authentication mail separate from marketing mail. Never expose the two authentication secrets or SMTP credentials through `NEXT_PUBLIC_` or `EXPO_PUBLIC_` variables.

`AUTH_BACKEND=none` remains available for local-only deployments. `AUTH_BACKEND=oidc` remains an optional provider adapter with its existing server-only configuration. Invalid or incomplete selected-backend configuration fails closed and must fail deployment validation.

## Link and session security

`POST /api/auth/magic-link/request` accepts `web`, `pwa`, or `mobile` and a bounded continuation path. PWA requests also carry a bounded opaque PWA handoff identifier and verifier; the database stores only their keyed digests, normalized request email, and permitted lifecycle metadata. It requires same-origin requests for web/PWA clients, applies PostgreSQL-backed anonymous limits of five requests per normalized email and, when `AUTH_TRUST_PROXY_HEADERS=true` is enabled for a header-rewriting proxy, twenty per forwarded client IP per 15-minute window, and returns a generic result without account enumeration. The database stores only the HMAC token digest, normalized email, client audience, purpose, bounded return path, expiry, and consumption timestamp for the challenge, plus the verifier-backed PWA handoff row. It never stores raw tokens, handoff values, IP addresses, URLs, or email-delivery provider payloads.

Email links carry the raw one-time token and bounded routing hints in the URL fragment. PWA links use `/auth/pwa-confirm` and include only their opaque handoff identifier; the browser confirmation page clears the fragment with `history.replaceState` before exchanging it. A browser callback never persists or logs the PWA refresh credential: it sends it only in the same-origin PWA-session publisher request, which rotates it and binds its session only to an email-matching verifier-backed handoff row. The receiving PWA polls with its session-scoped handoff identifier and verifier; `POST /api/auth/pwa/session` atomically consumes the row before setting HttpOnly cookies in the receiving PWA. If the callback opens in a separate PWA window, the original sign-in window supplies the session-scoped verifier through a one-shot, handoff-ID-matched same-origin `BroadcastChannel` response; the refresh credential never crosses that channel. The invitation Secure Share Link secret is never added to the magic-link request or email URL; an open invitation tab retains that secret in client memory and receives the authentication-completion announcement. `POST /api/auth/magic-link/redeem` atomically consumes the digest, provisions or loads the local `ExternalIdentity`, and creates a database-backed session. Web/PWA sessions use HttpOnly same-site cookies plus a signed browser assertion; native sessions keep opaque access and refresh credentials only in Keychain/Keystore-backed secure storage.

Access and refresh credentials are stored as keyed digests. Native refresh credentials rotate atomically. Browser session keepalive validates the signed browser assertion without consuming or rotating the refresh credential, so React Strict Mode and concurrent browser loads cannot race the rotation protocol; the browser assertion and database session retain the configured refresh lifetime. Reuse of an already rotated credential revokes that session, records a redacted security event, and never reveals whether the credential belonged to a live account. Logout revokes only the current session and is idempotent. The retention job removes expired challenges, revoked/expired sessions, and anonymous rate-limit windows; redacted identity security events remain available for their normal retention policy.

## Identity and migration

Local passwordless identities use issuer `rhasia:passwordless` and a random subject. `ExternalIdentity` remains unique by `(issuer, subject)` and remains the only identity-to-`ApplicationUser` binding. Future Firebase, OIDC, or other providers create separate identity rows. Linking requires explicit reauthentication; email similarity never performs an automatic merge.

The migration is intentionally staged. Run `pnpm run prisma:migrate:deploy`; its passwordless deployment runner applies all migrations through the additive authentication migration, runs preflight, seeds one local identity per existing Application User by that existing user ID, performs staged verification while the legacy column is retained, and only then applies the guarded cleanup migration and remaining migrations. It is safe to rerun after an interrupted deployment. Finish with `pnpm run verify:passwordless-migration` and record counts only, never emails, tokens, or database values.

If preflight, seeding, or staged verification fails, the runner stops before the destructive migration. There is no dual-auth fallback or compatibility session path; rollback after the final migration requires restoring the database backup and deploying the previous application version.

Database migration generation, application, resolution, reset, and deployment require explicit human approval for the target environment. An agent must not infer that approval from test or verification requirements.

## Route protection and logout

The proxy verifies the signed browser assertion optimistically, while every page/API authorization seam verifies the corresponding database session and active `ApplicationUser` status. Proxy is not the authorization boundary. Protected pages are `/vaults` and descendants plus `/totp`. Public authentication routes are `/sign-in`, `/auth/confirm`, `/auth/pwa-confirm`, `/auth/complete`, `/api/auth/magic-link/*`, `/api/auth/pwa/session`, `/api/auth/session/*`, and same-origin `POST /auth/logout`.

Web/PWA logout rejects missing or different `Origin`, revokes the current database session, clears all local auth cookies, and redirects with a redacted status. Native logout sends its bearer access credential to `/api/auth/session/revoke`, then clears secure storage locally.
