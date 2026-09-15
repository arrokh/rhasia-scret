# Sign-in rate limiting and Turnstile plan

## Goal

Protect passwordless sign-in link delivery from both high-volume requests and automated abuse without storing plaintext email addresses, IP addresses, Turnstile tokens, or other request credentials in application state.

## Implementation plan

1. **Keep the shared anonymous rate limiter**
   - Use the PostgreSQL-backed `AnonymousAuthRateLimitWindow` table.
   - Count five requests per normalized-email bucket and twenty requests per trusted-proxy IP bucket in each fifteen-minute window.
   - Hash both bucket values with the existing authentication secret; never persist the raw bucket value.
2. **Add a server-side Turnstile gate**
   - Render a visible, centered Cloudflare Turnstile widget on browser and installed-PWA sign-in forms.
   - Validate the one-time token at `challenges.cloudflare.com/turnstile/v0/siteverify` before consuming a rate-limit bucket or creating a magic-link challenge.
   - Keep the Turnstile secret server-only. Native requests remain supported without a browser widget and retain the PostgreSQL abuse limits.
3. **Preserve fail-closed response behavior**
   - Reject missing or malformed browser tokens before delivery work.
   - Return generic no-store responses for invalid Turnstile tokens, Turnstile outages, exhausted rate limits, and limiter outages; do not disclose account existence.
   - Return bounded `Retry-After` values for retryable infrastructure and rate-limit responses.
4. **Update development and deployment configuration**
   - Add the public site key and server secret key to `.env.example` using Cloudflare's always-pass testing pair.
   - Require both keys when `AUTH_BACKEND=passwordless`; production deployments must replace the testing pair with real keys.
   - Extend CSP for the Turnstile script, frame, and network endpoints.
5. **Verify the vertical slice**
   - Cover configuration, Turnstile response classification, request-route ordering and response contracts, browser request payloads, widget/form behavior, localization parity, and existing anonymous limiter behavior.
   - Run the repository's required checks before handoff.

## Status

Implemented in the passwordless sign-in request route, browser/PWA sign-in form, authentication configuration, CSP, development environment contract, documentation, and tests.
