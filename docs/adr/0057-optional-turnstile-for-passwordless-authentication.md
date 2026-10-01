# Optional Turnstile challenge for passwordless sign-in

- Status: Accepted
- Date: 2026-10-01
- Related: ADR-0049, ADR-0053, ADR-0056

## Context

Some self-hosted operators do not want to provision Cloudflare Turnstile while still using passwordless email sign-in and hosted account features. SMTP remains necessary to deliver sign-in links. PostgreSQL-backed anonymous email and client-IP rate limits already apply to every link request.

## Decision

Cloudflare Turnstile is optional for passwordless authentication. The public `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and server-only `TURNSTILE_SECRET_KEY` must either both be configured or both be blank. A partial pair is invalid. When both are blank, the browser does not render a challenge and the API accepts a request without a Turnstile token. When configured, the browser must provide a valid token and the API validates it before rate limiting or email delivery.

The API receives the public site key only to validate configuration pairing; the secret remains API-only and is never forwarded to Web. The self-hosted web and terminal setup flows explain the optional pair, and deployment validation rejects partial configuration. PostgreSQL-backed per-email and trusted-proxy IP/shared-unattributed rate limits remain active whether Turnstile is enabled or not.

## Consequences

- Self-hosted operators can run hosted passwordless authentication without configuring Turnstile.
- Operators who omit the challenge rely on the existing database-backed request limits and SMTP provider controls for anonymous abuse mitigation.
- A configured challenge cannot silently become a no-op due to one missing key; startup and deployment validation fail closed on a partial pair.
- No database migration is required; API request bodies permit a missing token and the runtime configuration determines whether it is accepted.
