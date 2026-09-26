# Passwordless-only hosted authentication

- Status: Accepted
- Date: 2026-09-25
- Supersedes: the active OIDC-backend support decision in ADR-0039 and OIDC-availability claims in ADR-0042 and ADR-0051; other decisions in those records remain in force

The repository supports self-managed passwordless email-link authentication as its sole hosted sign-in method. `AUTH_BACKEND=none` remains available for local-only deployments and is not an authentication provider. OIDC is not an active runtime, deployment, or user-facing option; there are no OIDC deployments, Application Users, or user data requiring a migration or compatibility path. The existing passwordless flow is preserved without behavioral changes, and the provider-neutral `ExternalIdentity` model remains to preserve the Application User identity boundary and allow a future provider only after a separate architecture and security decision. Local Profile/Local Vault and read-only Offline Local Vault Snapshot workflows remain independent of hosted authentication. Identity Linking and Provider Migration are not supported product workflows under this decision.
