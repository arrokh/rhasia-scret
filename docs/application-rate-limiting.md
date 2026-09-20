# Authentication and application rate limiting

## Scope

Authenticated application mutations under the API's `/v1/**` route tree use the operation-class inventory in `apps/web/src/modules/rate-limiting/presentation/authenticated-mutation-rate-limit-inventory.ts`. The web `/api/v1/**` proxy is transport-only. Budgets are shared by opaque `ApplicationUser` and operation class, so alternate routes for one use case cannot multiply a budget. The machine-authenticated retention route and passwordless session/link routes are outside authenticated-user budgets because they have no authenticated Application User.

Anonymous passwordless link requests use two layers: browser and installed-PWA requests first pass Cloudflare Turnstile validation, then all clients use separate PostgreSQL-backed 15-minute windows:

| Bucket                          | Limit |
| ------------------------------- | ----: |
| HMAC bucket of normalized email |     5 |
| HMAC bucket of source IP        |    20 |

The rate-limit table stores only keyed bucket digests, operation names, window timestamps, expiry, and counts. It does not persist email addresses, IP addresses, Turnstile tokens, link tokens, session credentials, or request bodies. Turnstile validation sends the token only to Cloudflare's server-side verification endpoint and does not persist the response. Link redemption is additionally protected by atomic one-time challenge consumption and expiry.

Authenticated budgets:

| Operation class                                | Limit |     Window |
| ---------------------------------------------- | ----: | ---------: |
| Account mutation                               |   120 | 60 seconds |
| Vault mutation                                 |    30 | 60 seconds |
| Membership / Secure Share Link mutation        |    30 | 60 seconds |
| Audit access event                             |   120 | 60 seconds |
| Key material registration, rewrap, or rotation |    10 |  5 minutes |
| Passkey recovery authentication                |    30 |  5 minutes |
| Passkey recovery enrollment or removal         |    10 | 10 minutes |
| Destructive mutation                           |     5 |     1 hour |
| Encrypted archive import                       |    10 |     1 hour |

Rate limiting occurs after authentication and active-user checks but before body parsing, authorization-sensitive repository work, or mutation. It never replaces authorization, revision checks, one-time-link semantics, or session revocation.

## Responses

An exhausted budget returns HTTP `429`, `{"error":"rate_limited"}`, bounded `Retry-After`, and `Cache-Control: no-store`. Invalid browser Turnstile tokens return a generic HTTP `403`; Turnstile or PostgreSQL limiter outages fail closed with HTTP `503` and bounded `Retry-After`. Authentication delivery failures use a generic response and never disclose account existence or provider details.

Operational logs contain only operation/outcome counters. Never log user identifiers, email addresses, IP addresses, route bodies, ciphertext, link material, credentials, or keys. Expired application and anonymous windows are removed by the retention purge.

## Deployment

Apply the Prisma-generated authentication and application-rate-limit migrations through `DIRECT_URL` before deploying application code. Runtime traffic uses `DATABASE_URL`; production pooled and direct endpoints must be distinct. Atomic database upserts provide cross-instance safety without process memory or client-supplied identity headers.

The checked-in policy table is production configuration. Change budgets through a reviewed code change with matching tests and documentation, not ad hoc per-instance overrides.
