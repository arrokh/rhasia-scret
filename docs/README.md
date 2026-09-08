# Documentation index

This index is the public entry point for the repository's product, operating, architecture, and security material. Start with the root [`README.md`](../README.md) for setup and the support matrix. Documents describe repository evidence and intended operating procedures; they do not replace a production security review or operator sign-off.

## User and product behavior

- [`advanced-recovery-security.md`](advanced-recovery-security.md) — Passkey-Assisted Recovery, Passkey-Assisted Unlock, Remembered Browser, and destructive reset boundaries.
- [`encrypted-vault-backup.md`](encrypted-vault-backup.md) — encrypted archive export/import contracts and key handling.
- [`offline-pwa-verification.md`](offline-pwa-verification.md) — read-only encrypted offline snapshots and PWA verification.
- [`browser-acceptance-tests.md`](browser-acceptance-tests.md) — supported browser acceptance coverage.
- [`ui-reference/`](ui-reference/) — web and native presentation references, including mobile behavior.

## Privacy, support, and provenance

- [`privacy.md`](privacy.md) / [`privacy.id.md`](privacy.id.md) — user- and operator-facing privacy and hosted-service disclosures.
- [`support.md`](support.md) / [`support.id.md`](support.id.md) — public support channels, safe report boundaries, and triage.
- [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) — native, UI, font, icon, asset, dependency, and generated-material provenance.
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md), [`../CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md), [`../GOVERNANCE.md`](../GOVERNANCE.md) — contributor and maintainer workflow.

## Deployment and operations

- [`authentication-configuration.md`](authentication-configuration.md) — Supabase and OIDC configuration, callbacks, route protection, and logout.
- [`self-hosting.md`](self-hosting.md) — supported host/database/authentication matrix, environment contract, deployment procedure, local setup, and smoke test.
- [`continuous-integration.md`](continuous-integration.md) — required pull-request checks, security automation, fork safety, and maintenance cadence.
- [`retention-purge-operations.md`](retention-purge-operations.md) — scheduled deletion and audit-retention operations.
- [`mobile-release-configuration.md`](mobile-release-configuration.md) — verified links, native cryptography validation, and release evidence.
- [`release-process.md`](release-process.md) — versioning, compatibility, candidate verification, provenance, rollback, and signing boundaries.
- [`release-readiness/2026-09-08.md`](release-readiness/2026-09-08.md) — current launch decision and evidence ledger.
- [`browser-test-runtime.md`](browser-test-runtime.md) — browser-gate topology, worker controls, and reproducible test commands.
- [`monorepo.md`](monorepo.md) — workspace ownership, package commands, deployment assumptions, and local verification.
- [`performance/README.md`](performance/README.md) — bundle and navigation performance evidence.

## Architecture and domain decisions

- [`../CONTEXT.md`](../CONTEXT.md) — authoritative product language, security model, and domain terminology.
- [`app-router-composition.md`](app-router-composition.md) — App Router composition rules.
- [`shared-code-inventory.md`](shared-code-inventory.md) — platform-neutral client capability inventory.
- [`i18n-implementation-plan.md`](i18n-implementation-plan.md) — bilingual web/native localization contract and coverage plan.
- [`adr/`](adr/) — Architecture Decision Records, including the threat model, crypto protocols, authentication boundaries, retention, localization, and native client foundation.

## Security

- [`security/deployment-hardening-checklist.md`](security/deployment-hardening-checklist.md) — release hardening checklist and evidence expectations.
- [`security/dependency-audit-exceptions.md`](security/dependency-audit-exceptions.md) — explicit dependency advisory exceptions and expiry owners.
- [`security/incident-response.md`](security/incident-response.md) — incident handling and escalation guidance.
- [`advanced-recovery-security.md`](advanced-recovery-security.md) — recovery limitations and client-only key handling.
- [`../SECURITY.md`](../SECURITY.md) — private vulnerability reporting and embargo policy.
- [`adr/0004-honest-but-curious-server-threat-model.md`](adr/0004-honest-but-curious-server-threat-model.md) — authoritative server trust boundary.
- [`audits/2026-07-29-security-privacy-quality-operational-readiness.md`](audits/2026-07-29-security-privacy-quality-operational-readiness.md) — historical repository audit; production controls marked Not Verifiable remain unresolved until operator evidence exists.

## Historical audits and validation evidence

- [`audits/`](audits/) — dated audit reports and verification addenda.
- [`validation/`](validation/) — issue-specific validation evidence.
- [`performance/`](performance/) — checked-in performance baselines and interpretation.

## Implementation plans

- [`mvp-plan.md`](mvp-plan.md) — product and MVP sequencing.
- [`i18n-implementation-plan.md`](i18n-implementation-plan.md) — localization implementation and maintenance requirements.
- [`navigation-interaction-performance-plan.md`](navigation-interaction-performance-plan.md) — navigation and interaction performance work.
- [`shared-vault-member-account-permissions-plan.md`](shared-vault-member-account-permissions-plan.md) — Shared Vault permission model.
- [`encrypted-vault-backup.md`](encrypted-vault-backup.md) — archive workflow implementation contract.

## Source and generated artifacts

- Repository-owned native Argon2 wrapper and upstream notices: [`../apps/mobile/modules/native-argon2id/`](../apps/mobile/modules/native-argon2id/).
- Workspace dependency lockfile: [`../pnpm-lock.yaml`](../pnpm-lock.yaml).
- CI workflows and security automation: [`../.github/workflows/`](../.github/workflows/).

When a document conflicts with an ADR or `CONTEXT.md`, the ADR and context terminology control. User-facing changes must update Indonesian and English catalogs together and must not put secrets, OTPs, keys, or decrypted content in documentation, logs, or fixtures.
