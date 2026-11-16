# Public-only browser analytics

- **Status:** Accepted
- **Date:** 2026-11-05
- **Related:** ADR-0044, ADR-0045

## Context

The prior analytics policy allowed sanitized page and performance events from
protected routes and shipped an analytics SDK from the shared application
layout. Sanitization reduced transmitted data, but a third-party SDK on a
sensitive application surface increased the consequences of an SDK or
sanitizer regression. Public-site traffic still needs enough visibility to
understand which information pages visitors use, where they arrive from, and
how those pages perform.

## Decision

Cloudflare Web Analytics and PostHog are optional, default-off integrations
with separate purposes. Both are limited to the exact public paths `/`,
`/landing`, `/privacy`, and `/support`. Their public CSP sources are added only
when configured and only for those paths. Runtime configuration is read by the
server so one published container image can use deployment-specific settings.
The tokens are browser-visible project identifiers, not secrets.

Cloudflare provides aggregate page visits, page paths, referring-site hosts,
geography, browser/device information, and page performance reporting. Its
beacon is configured with `spa: false`; same-origin links that change between
public pages or cross the public/private boundary use a full document
navigation. This lets Cloudflare report public page loads without its SPA
observer following client-side navigation into a Vault route.

PostHog provides public-page and performance events plus redacted public
click/submit interactions and bounded exception types. The application never
identifies a PostHog user. Product event captures are discarded on every route.
Session recording, persistence, surveys, console capture, and campaign
parameter auto-capture remain disabled. The SDK respects Do Not Track.

PostHog pageviews do not include referrer or campaign attribution. Referrer
collection and campaign-parameter capture are disabled, and the sanitizer
removes query strings, fragments, titles, DOM text, and element attributes
before transmission. The page route is restricted to a source-controlled public
route. Private page loads do not initialize either integration and their CSP
does not allow either provider. Use Cloudflare's aggregate referring-site and
geography reports for acquisition insights.

The site uses the `origin` Referrer-Policy so navigation from a rhasia-scret
page sends only the site origin, including when a visitor crosses from a
private route to a public page. PostHog does not collect referrers or campaign
parameters. Cloudflare may report external referring-site host/path dimensions;
its Web Analytics documentation says query strings are not logged.

Crossing between public and private routes must use a full document
navigation. With Cloudflare enabled, navigation between different public
information pages also uses a full document navigation so each page load is
reported while SPA tracking remains disabled.

## Consequences

Cloudflare provides aggregate public traffic, referrer, geography, and
performance visibility. PostHog provides public-page performance and redacted
interaction signals without referrer or campaign attribution. Neither provider
receives Vault or account workflow telemetry. Adding a public route requires
an explicit update to the route policy, CSP, sanitizer, and tests. Re-enabling
product-event collection or tracking application routes requires a separate
privacy and security review.

| Provider or component                                      | Data it may handle                                                                                                                                                                      | Responsibility boundary                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-managed passwordless authentication                   | Verified email, authentication events, and session material required to verify a principal                                                                                              | The self-managed service verifies authentication. No external authentication provider receives Vault plaintext from this application. Configure applicable email-delivery retention, access control, and privacy notices.                                                                                                                                                                                                                   |
| Email delivery used by the authentication provider         | Recipient address, sign-in or verification link metadata, delivery and bounce data                                                                                                      | The provider controls delivery logs and retention. The application does not receive the email secret.                                                                                                                                                                                                                                                                                                                                       |
| Reference Vercel host, CDN, or a self-hosted reverse proxy | Requests, IP/network metadata, headers, timing, deployment and error logs, and encrypted API traffic                                                                                    | The hosted-demo maintainer or self-host operator controls host configuration, log access, retention, TLS, and secret handling.                                                                                                                                                                                                                                                                                                              |
| Tailscale Serve or Funnel (optional)                       | Tailscale account/node/connection metadata; the host daemon receives application HTTP after HTTPS termination and forwards it over loopback                                             | Serve follows tailnet access policy; Funnel is public. With `AUTH_BACKEND=none`, Rhasia sign-in is disabled and hosted Vault APIs remain unavailable; with `passwordless`, hosted features still require application sign-in. The host operator remains trusted and controls local request access, logs, and retention. Review Tailscale's current [Privacy Policy](https://tailscale.com/legal/privacy-policy) for provider-held metadata. |
| PostgreSQL provider                                        | Encrypted content, opaque identifiers, permitted metadata, and database connection/operational logs                                                                                     | The database must remain behind the server-side Go/Echo API. Do not enable direct browser database access for this application. The operator owns backups, restore, purge scheduling, and database access.                                                                                                                                                                                                                                  |
| Cloudflare Web Analytics (optional)                        | Aggregate public page visits, page paths, external referring-site dimensions, geography, browser/device details, and performance metrics on `/`, `/landing`, `/privacy`, and `/support` | Disabled unless `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN` is set. The beacon disables SPA tracking; analytics sources are permitted only on exact public routes. Cloudflare documents that Web Analytics does not collect or use visitor personal data and does not log query strings.                                                                                                                                                   |
| PostHog browser analytics (optional)                       | Aggregate public page/performance events, redacted click/submit interactions, bounded exception types, and a transient anonymous SDK identifier                                         | Disabled unless both `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` are set. Referrer collection and campaign-parameter capture are disabled. The SDK is not initialized on private routes, and their page responses do not allow PostHog hosts. Product events and user identification are disabled on all routes.                                                                                                     |
