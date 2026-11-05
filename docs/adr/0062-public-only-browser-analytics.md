# Public-only browser analytics

- **Status:** Accepted
- **Date:** 2026-11-05
- **Related:** ADR-0044, ADR-0045

## Context

The prior analytics policy allowed sanitized page and performance events from
protected routes and shipped the analytics SDK from the shared application
layout. Sanitization reduced transmitted data, but a third-party SDK on a
sensitive application surface increased the consequences of a future SDK or
sanitizer regression.

## Decision

PostHog browser analytics is initialized only on the exact public paths `/`,
`/landing`, `/privacy`, and `/support`. Client initialization, user
identification, explicit capture, and `before_send` all fail closed on every
other path. Content Security Policy responses add the PostHog script and
connection hosts only for those public paths. Cloudflare Web Analytics is
removed because it is not needed by the product.

Public pages may report pageviews, pageleaves, Web Vitals, allowlisted clicks
and submits on links or buttons, bounded automatic exception types, and the
bounded error-boundary event. The sanitizer removes DOM text, attributes, and
URL parameters. Product event definitions remain typed in the client, but all
product-event captures are discarded on every route. The application never
identifies a PostHog user. Private page loads do not initialize the PostHog SDK
and their CSP does not allow PostHog hosts.

Client-side navigation keeps the original document's CSP and any SDK already
loaded on that document. Runtime route guards and the event sanitizer suppress
captures after navigation to a private route. A future requirement to remove
third-party code and permissions immediately after such navigation must use a
full document navigation or another isolated public origin.

## Consequences

PostHog can report aggregate traffic and performance for public information
pages without collecting Vault or account workflow telemetry. Adding a public
route requires an explicit update to the route policy and corresponding CSP
and sanitizer tests. Re-enabling product event collection requires a separate
privacy and security review.
