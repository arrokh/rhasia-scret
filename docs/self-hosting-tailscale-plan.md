# Tailscale Serve and Funnel for Docker self-hosting

**Status:** The repository setup flow supports both `none` and `passwordless` application authentication. Operators still need to verify their tailnet policy, Docker host reachability, and the selected authentication flow before treating a deployment as production-verified. SMTP and Turnstile are required only for passwordless.

**Research date:** 2026-09-30.

## Summary

The existing Docker Compose deployment can be exposed through Tailscale. Install and authenticate Tailscale on the Docker host, bind the Web container's published port to loopback, then have Tailscale proxy HTTPS traffic to that local port. Keep the API and PostgreSQL on the private Compose network.

The operator chooses the exposure mode:

- **Serve** makes the service available within the tailnet, subject to the tailnet's ACL or grants policy.
- **Funnel** makes the service reachable from the public internet. Tailnet ACLs do not restrict visitors to a Funnel URL. With `AUTH_BACKEND=none`, the app has no sign-in and only browser-local features are available; with `passwordless`, hosted features remain protected by application sign-in.

The repository offers three first-run configuration paths: a terminal wizard, a temporary local web wizard, or manual <code>.env</code> setup using the existing template and commands. All paths produce configuration consumed by the existing self-hosted workflow.

This was implemented without changing Vault encryption, API contracts, or client/server crypto boundaries. Tailscale exposure does not create an application identity. `AUTH_BACKEND=none` keeps hosted APIs fail-closed; `passwordless` continues to require the normal application sign-in. Tailnet access, public Funnel reachability, provider configuration, and host network protections remain operator-specific verification.

## Agreed setup experience

| Path                     | Behavior                                                                                                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interactive terminal     | <code>pnpm selfhosted:configure</code> asks the setup questions in the terminal, hides secret input, and writes the root <code>.env</code> with restrictive permissions. It refuses to overwrite an existing file and does not start containers or run migrations.               |
| Interactive browser form | <code>pnpm selfhosted:configure --interactive</code> starts a one-shot web form bound only to <code>127.0.0.1</code>, writes the root <code>.env</code> with restrictive permissions, and refuses to overwrite an existing file. It does not start containers or run migrations. |
| Manual setup             | The operator edits the canonical root <code>.env.example</code> into <code>.env</code>, provides values required by the selected authentication mode, and runs the existing self-hosted commands. The template remains the only tracked environment template.                    |

All three paths feed the same <code>pnpm selfhosted:setup</code>, <code>pnpm selfhosted:up</code>, and <code>pnpm selfhosted:down</code> lifecycle. <code>selfhosted:setup</code> continues to validate configuration and requires its existing explicit confirmation before applying the database migration. It is not called implicitly by either wizard.

Tailscale exposure is a separate post-start step because the Web service must be healthy before the proxy is configured. The one-shot CLI helper, launched after <code>selfhosted:up</code>, asks the operator to choose Serve or Funnel, checks the Web health endpoint, applies the selected host Tailscale configuration, and exits. It is a separate invocation from the environment form, so neither setup process needs to remain running. It also provides status and a safe way to disable only the Rhasia listener it created. The helper does not edit tailnet ACLs or select a mode on the operator's behalf.

The manual route has the same exposure choice: use the documented Tailscale commands or the local exposure helper. Other HTTPS reverse proxies remain a documented manual option; the helper only manages host Tailscale.

## Current repository state

- <code>docs/self-hosting.md</code> documents Docker Compose with optional Tailscale Serve or Funnel, all environment setup paths, mode selection, route status, and teardown.
- <code>pnpm selfhosted:setup</code> creates <code>.env</code> only when absent, fills selected generated local values, validates Docker and deployment configuration, starts PostgreSQL, and applies the migration only after an interactive confirmation. A new file defaults to <code>AUTH_BACKEND=none</code>. The command does not silently rotate an existing database password.
- <code>pnpm selfhosted:up</code> builds and starts the Compose services and waits for health checks. <code>pnpm selfhosted:down</code> stops services while preserving the PostgreSQL volume.
- The Compose Web port binds to <code>127.0.0.1</code> by default, with an explicit IPv4 override for separately managed proxies. API and PostgreSQL do not publish host ports.
- The repository has one canonical root <code>.env.example</code>. Generated <code>.env</code> files use mode <code>0600</code>.
- <code>pnpm selfhosted:configure</code> collects the same configuration fields in the terminal; <code>pnpm selfhosted:configure --interactive</code> opens the browser form. Both paths share validation, refuse to overwrite <code>.env</code>, and use the same atomic mode-<code>0600</code> writer.
- <code>AUTH_BACKEND=none</code> disables Rhasia sign-in and hosted APIs. The Tailscale helper can expose browser-local workflows through Serve or Funnel; Funnel is public and has no application login in this mode. <code>passwordless</code> with production SMTP/Turnstile provides hosted-account features and is also supported by the helper.

## Network and security model

### Serve and Funnel

Tailscale Serve is tailnet-restricted and applies the tailnet's ACL or grants policy. Funnel is internet-public; Funnel authorization controls which tailnet nodes may enable it, not which internet visitors may connect. Do not describe Funnel as a private link or as an access-control substitute.

Tailscale terminates HTTPS on the node and forwards traffic to the local Web service. This does not move the application host outside the trust boundary or provide protection from a malicious host. Tailscale controls network reachability only; it does not authenticate users to Rhasia or create hosted authorization. Funnel exposes the app to the public internet, where hosted features still require passwordless sign-in when selected.

Funnel requires an eligible HTTPS listener on port 443, 8443, or 10000 and can forward it to the local Web port. The same Tailscale HTTPS port cannot be active as Serve and Funnel simultaneously. The operator selects one mode for this listener; the setup does not restrict that choice. If an operator needs concurrent private and public listeners, treat that as a separate, explicitly configured multi-listener deployment.

### Docker binding

Change the Compose Web port mapping to use a configurable host bind address whose default is <code>127.0.0.1</code>. Tailscale and a same-host reverse proxy can reach the Web service through loopback. Keep API and PostgreSQL ports unpublished.

If another proxy needs a non-loopback listener, require an explicit override and document that traffic to that address may bypass Tailscale Serve policy. Docker documents a localhost-published-port caveat for Engine versions before 28.0.0; validate and publish a supported Docker Engine floor or require a host firewall mitigation before claiming loopback binding prevents all network access.

### Application origin and secrets

For this Tailscale helper, accept <code>AUTH_BACKEND=none</code> or <code>passwordless</code> and require a valid HTTPS MagicDNS origin. Require proxy-header trust to be disabled for <code>none</code>; passwordless requires it enabled because the helper serves through Tailscale's header-rewriting reverse proxy. Passwordless also requires the normal SMTP and Turnstile settings.

The interactive setup form has basic and advanced sections. It generates internally managed random values locally and uniquely per deployment. SMTP, Turnstile, and passkey fields are used only for the passwordless setup option; selecting <code>none</code> clears those values. Do not treat example or testing credentials as production values.

The setup form can discover and prefill the Tailscale MagicDNS HTTPS hostname when the host is connected. The current Tailscale helper requires that exact value for <code>WEB_ORIGIN</code>; custom domains and other reverse proxies require a separately managed proxy. Passwordless setup keeps <code>AUTH_APP_ORIGIN</code> pinned to that canonical origin so forwarded host/protocol values cannot change origin checks. Keep proxy-header trust disabled for <code>none</code> and direct access.

All generated and supplied application credentials remain server-side in the ignored root <code>.env</code>. Never ask for, store, display, log, or transmit TOTP secrets, Vault keys, Vault Unlock Secrets, OTPs, QR payloads, or decrypted Vault content. Do not expose server credentials through browser-visible <code>NEXT_PUBLIC_*</code> variables.

## Interactive wizard security contract

The terminal and browser wizards write a file that contains deployment credentials, so treat them as privileged local setup tools:

- Run on the host, outside Docker, before the app stack is exposed. Bind only to <code>127.0.0.1</code>; do not support LAN, tailnet, Funnel, or remote access to the setup form.
- Start only for a setup operation, use a per-run unpredictable session token and strict Host/Origin checks, disable caching, and stop on success, cancellation, or error.
- Use no analytics or third-party browser resources. Do not retain values in browser storage, logs, process output, crash details, or the response after saving. Mask secret fields and show only redacted completion status.
- Accept only a bounded allowlist of environment fields; validate types, allowed values, URLs, and required combinations before writing.
- Create the file exclusively, atomically where practical, and enforce mode <code>0600</code>. Refuse to overwrite an existing <code>.env</code>; direct the operator to the manual path or to back up and edit the file deliberately.
- Keep the setup UI out of <code>apps/web/src/app</code>. It is host tooling, not an application route or a persistent administration panel.
- Localize visible text, accessibility labels, and validation messages in Indonesian and English, following the repository's localization rules.

The Tailscale exposure helper is a separate one-shot operation after the app is healthy. It uses the host's existing Tailscale identity and CLI; it does not ask for or store a Tailscale auth key. Before activating Funnel, require an explicit confirmation that the selected listener will be public. Do not change tailnet ACLs, enable Funnel policy, or run commands that erase unrelated listeners.

Disabling exposure must remove only the listener created for Rhasia. Avoid broad Serve/Funnel reset commands when they could remove other services from the node. If the supported CLI cannot remove the Rhasia listener independently, stop and provide operator instructions instead of resetting shared node configuration.

## Implemented repository changes

### 1. Docker exposure defaults to loopback

- <code>docker-compose.yml</code> publishes the Web service on <code>127.0.0.1</code> by default and permits an explicit IPv4 bind override.
- <code>tools/self-hosted.mjs</code> validates the bind address and host port. The focused Compose test checks the loopback default and configured override; API and PostgreSQL remain unpublished.
- Docker Engine older than 28.0.0 needs a host firewall mitigation for the localhost-published-port caveat. The repository does not verify an operator's Engine or firewall.

### 2. Environment setup for external access

- Keep the canonical root <code>.env.example</code> as the manual template; the terminal and browser wizards write the same root <code>.env</code> contract.
- Both wizards generate internal secrets locally and uniquely, preserve provider values as secrets, do not print them, and refuse to overwrite an existing file. The Tailscale helper accepts <code>none</code> or <code>passwordless</code>; only the latter requires SMTP and Turnstile configuration.
- Tailscale identity credentials and listener state are not added to <code>.env</code> or Compose services. The ignored local ownership marker contains only the route needed for targeted status and teardown.

### 3. One-shot interactive environment form

- The terminal command and host-side browser form both support Indonesian and English, validate the same fields, can use a detected MagicDNS origin, and write <code>.env</code> atomically with mode <code>0600</code>. Terminal secret input is hidden while typing; the browser form uses password controls for secret fields.
- Both wizards only create <code>.env</code>. They do not install/authenticate Tailscale, start Docker, run migrations, configure public access, or remain available as an admin panel.
- The operator continues with existing self-hosted commands, including the existing explicit database migration confirmation.

### 4. Post-start Tailscale exposure helper

- <code>pnpm selfhosted:tailscale --interactive</code> offers the operator Serve or Funnel. Direct commands support <code>serve</code>, <code>funnel --confirm-public</code>, <code>status</code>, and <code>off</code>.
- Serve uses the tailnet's configured access policy; Funnel is public and requires explicit confirmation. Neither mode is selected by repository policy.
- Before publishing, the helper checks a connected Tailscale CLI, a healthy Web endpoint, the exact MagicDNS HTTPS origin, Docker's active Web port mapping (loopback only, matching `.env`), the selected `AUTH_BACKEND` in both running containers, the corresponding Web proxy-header trust setting, and an unused HTTPS port 443.
- It reports the URL without environment values, records the route it creates, verifies it before disabling, and does not use broad reset commands.
- Installation, tailnet login, node authorization, HTTPS enablement, ACLs/grants, and Funnel policy remain operator-managed. The Compose design has no Tailscale sidecar.

### 5. Operator and security documentation

- Expand <code>docs/self-hosting.md</code> with:
  - Both configuration paths: interactive wizard and manual <code>.env</code>.
  - The shared sequence for environment validation, explicit migration confirmation, app startup, and exposure.
  - Tailscale host prerequisites, Serve and Funnel setup, URL/origin, HTTPS, health checks, status, restart, and teardown.
  - Generic reverse-proxy guidance for operators who do not use the Tailscale helper.
  - The public nature of Funnel, the tailnet policy boundary for Serve, and the fact that neither mode creates an application identity; document differences between `none` and `passwordless`.
  - The loopback binding behavior, direct-access caveat, backups, and operator responsibility.
- <code>docs/self-hosting.md</code> and the root <code>.env.example</code> document the manual and interactive environment paths, lifecycle, and exposure contract.
- <code>docs/security/deployment-hardening-checklist.md</code> covers host listener reachability, Serve ACL/grants, public Funnel exposure, application authentication, and targeted listener removal.
- <code>docs/privacy.md</code> and <code>docs/privacy.id.md</code> document the Tailscale node, TLS termination, provider metadata, and operator boundary.
- <code>docs/README.md</code> links to this implementation record and operator-verification checklist.

### 6. Verify before marking the setup supported

Repository tests cover environment parsing and validation, bind-address defaults/overrides, file permissions and no-overwrite behavior, secret redaction, strict wizard request validation, the local wizard's HTTP/Host/Origin/cache/shutdown behavior, active Docker port mapping and runtime-environment checks, and Serve/Funnel lifecycles for both `none` and `passwordless` against fake Docker and Tailscale CLIs. They do not exercise an operator's real tailnet or third-party SMTP and Turnstile services.

Verify on a supported Docker host and tailnet:

- Compose publishes only Web on loopback by default; API and PostgreSQL have no host ports.
- A same-host Tailscale proxy reaches the healthy Web service through loopback.
- Serve is unavailable from a device outside the tailnet and works only for users/devices permitted by ACLs or grants.
- Funnel is reachable without Tailscale. With `none`, it has no Rhasia application sign-in and hosted Vault APIs remain unavailable; with `passwordless`, confirm hosted access requires sign-in. Never describe the URL as private.
- The helper rejects an unsupported auth backend, incomplete HTTPS origins, mismatched Docker runtime configuration, and non-loopback Web bindings.
- Browser-local workflows load on the actual HTTPS hostname. When `passwordless` is selected, verify email links, Turnstile, and optional passkey flows at the Tailscale origin.
- LAN access cannot bypass the intended Serve-only path on supported host configurations; record Docker Engine version and any firewall mitigation.
- Teardown removes the Rhasia listener only and leaves other Tailscale services and the PostgreSQL volume intact.

Use synthetic non-PII data only. Redact environment values, credentials, user data, and provider output from test artifacts and operator evidence. Repository tests cannot prove a tailnet ACL, Funnel availability, or production provider behavior; retain separate operator evidence for those claims.

## Rollout and verification status

1. Repository implementation, documentation, and test coverage are complete; the full repository verification gate is part of the implementation handoff. Live tailnet and provider verification remains an operator task.
2. Operators must verify their actual Serve ACL/grants or public Funnel reachability, Docker Engine/firewall boundary, HTTPS hostname, and browser-local workflows. SMTP and Turnstile are not required in the selected `none` mode.
3. Record that operator evidence before describing a specific deployment as production-verified. This page is an implementation record, not evidence that every tailnet or provider configuration works.

ADR-0056 records that Tailscale exposure can be combined with either supported authentication backend. Future changes to authentication semantics, trust boundaries, or another hard-to-reverse deployment contract require their own ADR.

## Upstream references

- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel)
- [Tailscale CLI: Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Tailscale CLI: Funnel](https://tailscale.com/docs/reference/tailscale-cli/funnel)
- [Tailscale Docker Compose](https://tailscale.com/docs/features/containers/docker/how-to/connect-docker-container)
- [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/)
- [Cloudflare Turnstile hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/)
- [Cloudflare Turnstile plans](https://developers.cloudflare.com/turnstile/plans/)
