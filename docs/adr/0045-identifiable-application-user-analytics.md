# Identifiable Application User analytics

- **Status:** Accepted
- **Date:** 2026-09-06
- **Related:** ADR-0039, ADR-0044
- **Supersedes:** ADR-0044's hashed identity and blanket email exclusion only

## Context

Operators need to correlate PostHog people directly with internal Application User records and see the user's contact email. SHA-256-derived identifiers prevent direct lookup by `application_users.id`. Sending raw identifiers and email makes analytics personally identifiable; this is an explicit exception, not an expansion of permitted Vault telemetry.

## Decision

The authenticated Vault page passes the server-resolved Application User's `id` and `email` to the browser identification adapter. The adapter calls `posthog.identify(userId, { email })`: `distinct_id` is exactly `application_users.id`, and the email person property is `application_users.email`. Neither the Supabase subject nor an External Identity identifier is used. Email remains contact metadata, never an identity key or a basis for merging users.

The `before_send` sanitizer permits only a bounded email string within `$set` on `$identify` and the SDK's explicit `$set` person-update event. It sanitizes both envelope-level person properties (initial identification) and property-level person properties (subsequent updates). All other nested person properties, `$set_once`, top-level email, and email in automatic or explicit product-event properties remain excluded. The identification adapter rejects malformed identifiers and email. An email change reruns identification with the same Application User ID.

All other ADR-0044 safeguards remain in force: no browser persistence, Do Not Track respected, private routes redacted, private DOM interaction capture suppressed, and no Vault names, Authenticator Account labels, TOTP configuration, secrets, keys, OTPs, QR data, or decrypted content in analytics. This decision does not change encryption, authorization, server storage, audit redaction, or localization.

## Consequences and rollout

PostHog now receives personally identifiable contact metadata and directly linkable internal user identifiers. Access, retention, exports, and deletion of PostHog person data must be handled as personal data; hashing or removing this feature later cannot retract previously ingested data.

Existing hashed distinct IDs are not automatically aliased or migrated. Returning users may therefore have separate historical hashed and new raw-ID person records, and unique-user/funnel reporting across rollout may split or double-count users. Anonymous events still use SDK-generated IDs until identification. Any historical merge/backfill is a separate, explicitly reviewed operation; never merge by email.

Before production rollout, verify a synthetic authenticated session's outgoing `$identify` payload contains exactly the raw Application User ID and the intended email person property, then verify subsequent events use that ID. Check unrelated person properties and sensitive Vault data are absent, private URLs remain redacted, and logout resets identity. No real secrets or personal test email addresses should be used in this payload review.
