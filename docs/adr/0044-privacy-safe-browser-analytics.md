# Privacy-safe browser analytics

- **Status:** Accepted
- **Date:** 2026-08-23
- **Related:** ADR-0038, ADR-0041
- **Amended by:** ADR-0045 supersedes the hashed identity and blanket email exclusion below; all other safeguards remain in force.

## Context

The application needs PostHog Web Analytics for page traffic and browser performance, including protected application routes. The browser must not transmit or persist plaintext Vault content, account labels, issuer values, TOTP configuration, OTPs, QR data, passphrases, keys, email addresses, or arbitrary user identifiers. Disabling screen recording does not by itself prevent pageview, DOM-interaction, URL, exception, or performance metadata from being captured.

## Decision

Browser analytics is initialized only when the public PostHog token and host are configured. Its policy is centralized in `apps/web/src/shared/infrastructure/browser-analytics-config.ts`.

The routes `/vaults`, `/local`, `/totp`, `/offline`, `/sign-in`, and `/auth` expose only these automatic events:

- `$pageview`
- `$pageleave`
- `$web_vitals`
- `$performance_event`

Their URL paths were originally normalized to `/[private]`; ADR-0045 supersedes this with static-route preservation and private-segment masking. Query strings and fragments are removed. Automatic clicks, submits, dead clicks, heatmap payloads, exceptions, DOM text, DOM attributes, copied text, and object-valued automatic properties are rejected on those routes. Public DOM interaction autocapture is limited to `click`/`submit` on `a`/`button` elements; all enabled automatic event types pass through the same sanitizer. Heatmap collection is disabled globally because the SDK heatmap payload is object-valued DOM data that cannot be safely allowlisted by the generic sanitizer.

PostHog browser persistence is disabled. This is required because the SDK's session-properties manager can retain the current URL before the `before_send` sanitizer runs. Referrer, campaign, and URL-fragment capture are disabled. PostHog session recording, surveys, feature flags, web experiments, product tours, conversations, and external dependency loading remain disabled; all text and element attributes remain masked, and Do Not Track remains respected. The application user identifier is SHA-256 hashed in the browser before `identify`; raw application identifiers are never sent to PostHog.

Explicit application events use a typed allowlist and locale-independent, aggregate properties. They cannot accept arbitrary event names or Vault content. The authenticated-session event is emitted only after the browser identifies the hashed application user; the pre-authentication sign-in-link event remains anonymous and is not treated as part of an identified activation funnel. Error-boundary telemetry is limited to bounded error names and digests and is never accepted from automatic exception payloads. The current product event catalog and recommended PostHog views are maintained in `docs/analytics-events.md`.

## Consequences

PostHog Web Analytics can report redacted pageview and performance activity for protected routes while omitting their private interaction details. Analytics does not correlate reloads or tabs through browser persistence; encrypted Vault state and application content remain in their existing client-owned stores and are not placed in analytics persistence.

The `before_send` policy is defense-in-depth rather than a formal guarantee against future SDK behavior changes. Production rollout must include a controlled payload review after deployment, and any new automatic event type or sensitive property requires an analytics policy/test update.
