# Tailscale exposure with configurable application authentication

- Status: Accepted
- Date: 2026-10-01
- Supersedes: ADR-0055
- Related: ADR-0053, ADR-0054

## Context

Self-hosted operators may expose either browser-local workflows or hosted account features through Tailscale. Serve limits network reachability to the tailnet according to its ACL/grants policy; Funnel is public. This network exposure decision is independent of the application's authentication backend.

## Decision

The self-hosted Tailscale helper supports `AUTH_BACKEND=none` and `AUTH_BACKEND=passwordless` for Serve and Funnel. Both require an HTTPS `WEB_ORIGIN` that exactly matches the host's MagicDNS origin and a Docker Web listener published only to host loopback. Before creating a listener, the helper verifies the selected backend and MagicDNS `WEB_ORIGIN` in the running Web and API containers. With passwordless, it also verifies that both containers use the matching `AUTH_APP_ORIGIN`.

With `AUTH_BACKEND=none`, `AUTH_TRUST_PROXY_HEADERS` must be `false`. Hosted Personal/Shared Vault, synchronization, membership, audit, and recovery APIs remain fail-closed; users can use browser-local and offline local workflows.

With `AUTH_BACKEND=passwordless`, the normal SMTP and Turnstile production requirements apply. The setup wizard sets `AUTH_TRUST_PROXY_HEADERS=true` for Tailscale exposure. The host's Tailscale reverse proxy rewrites forwarded headers, allowing passwordless authentication rate limits to use the forwarded client IP. `AUTH_APP_ORIGIN` remains explicitly set to the configured canonical MagicDNS origin, which takes precedence over forwarded host/protocol values for origin checks. Direct access and `none` mode keep proxy-header trust disabled.

Funnel requires explicit public confirmation regardless of backend. With `none`, the public app has no application sign-in and only browser-local features are available. With `passwordless`, the login page is public but hosted features still require an authenticated application user. A Funnel URL is never described as private.

## Consequences

- Tailscale Serve/Funnel can be selected independently from `none` or `passwordless` application authentication.
- Tailscale authorization remains a network boundary; it is not converted into a Verified Principal, Application User, or hosted Vault authorization.
- `none` does not require SMTP or Turnstile; passwordless Tailscale exposure uses the existing provider requirements.
- Anyone who opens a Funnel URL can load the public application. Hosted data remains behind passwordless sign-in when that backend is enabled.
- The host and its Tailscale daemon remain inside the operator's trust boundary. The helper manages only its recorded listener and does not change tailnet ACLs, Funnel policy, or unrelated Tailscale services.
