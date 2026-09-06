# Route-aware analytics path redaction

- **Status:** Accepted
- **Related:** ADR-0044

## Context

Collapsing every protected page to `/[private]` prevents distinguishing application workflows in PostHog. Static route names are application metadata, not user content; dynamic route values remain private.

## Decision

Replace ADR-0044's whole-path masking with a source-controlled static route allowlist. Preserve known static prefixes and replace every unknown suffix segment with `[redacted]`. For example, `/vaults/manage/personal` remains unchanged, while `/vaults/manage/cms1btg0p00wt9spon6tz59d4` becomes `/vaults/manage/[redacted]`. Unknown routes fail closed rather than exposing arbitrary URL values.

Apply the same policy to `$current_url`, `$referrer`, `$initial_referrer`, and `$pathname`. Remove queries, fragments, and embedded URL credentials; reject non-HTTP(S) URLs. Enable PostHog history-change pageviews so client-side navigation receives the same sanitization as initial page loads. The allowlist must be updated when adding static pages; dynamic values must never be added.

Protected-route interaction suppression remains separate from path redaction. All existing DOM, exception, persistence, recording, and sensitive-property safeguards in ADR-0044 remain in force.

## Consequences

Page and performance analytics can distinguish static workflows without collecting Vault identifiers. Historical events remain unchanged. Future routes default to redacted until their static structure is reviewed.
