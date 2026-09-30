# Tailscale exposure without application sign-in

- Status: Accepted
- Date: 2026-10-01
- Related: ADR-0053, ADR-0054

## Context

Self-hosted operators may want to open the browser-local Rhasia experience from another device without configuring an email provider or creating Rhasia accounts. Tailscale Serve can restrict network reachability to the tailnet. Tailscale Funnel is intentionally public. Neither mode creates an Rhasia identity or grants access to hosted application data.

## Decision

The self-hosted Tailscale helper supports `AUTH_BACKEND=none` for both operator-selected Serve and Funnel modes. It requires the Web and API containers to run with that exact backend, requires proxy-header trust to remain disabled, and keeps the Docker Web listener bound to host loopback. The setup requires an HTTPS `WEB_ORIGIN` matching the host's Tailscale MagicDNS name. SMTP, Turnstile, magic-link, session, and passkey settings are not required for this mode.

With `AUTH_BACKEND=none`, Rhasia sign-in is disabled. Hosted Personal/Shared Vault, synchronization, membership, audit, and recovery APIs remain fail-closed. Users can only use browser-local and offline local workflows. Tailnet ACLs or grants govern who can reach Serve, but do not authenticate a user to Rhasia or enable hosted APIs.

Funnel remains publicly reachable by any internet visitor. The helper requires an explicit public confirmation and tells the operator that the exposed application has no Rhasia sign-in and only browser-local features. A Funnel URL is never described as private.

## Consequences

- Operators do not need SMTP or Turnstile credentials for the Tailscale `none` setup.
- Each browser profile owns its independent Local Profile and Local Vault data; those values are not synchronized to the self-hosted database.
- Tailscale authorization is a network boundary only. It is not converted into a Verified Principal, Application User, or hosted Vault authorization.
- Anyone who opens a Funnel URL can load the public application. This mode must not expose hosted Vault data or be presented as a private share link.
- Operators who need hosted accounts and server-backed Vaults must use the separately supported passwordless authentication configuration through a deployment path outside this helper's `none`-only contract.
- The helper verifies the effective Web and API container settings before creating or removing only its recorded listener; it does not change tailnet ACLs, Funnel policy, or unrelated Tailscale services.
