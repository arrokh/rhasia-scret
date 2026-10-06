# Changelog

All notable changes to this project will be documented in this file. The
format follows the Keep a Changelog convention. Version tags and compatibility
notes follow the [repository release process](docs/release-process.md).

## [Unreleased]

### Added

- Public MIT license, third-party provenance inventory, and DCO contribution
  agreement.
- Bilingual privacy and support disclosures with public web links.
- Contributor, security, governance, roadmap, support, and issue-intake
  documentation.
- Documented the repository release process and API/Web readiness ledger.
- Defined repository SemVer source releases separately from API/Web service
  deployments, with aligned workspace versions.
- Added local release-candidate preparation and exact-SHA GitHub tag/Release publication automation, gated by a reviewed release PR and version-specific readiness.
- Enforced product-version alignment across root, API, Web, and shared-package manifests; version-only synchronization is excluded from Vercel build triggers.
- Added the current product version to the shared web footer before conditional language, Privacy, and Support controls.

### Verification

- Dependency-license verification remains a required release check.
- Full versioned release evidence is not implied by this unreleased entry.

## [0.1.3]

### Changes

- Link the Web footer version to its matching GitHub Release.
- Publish version- and source-SHA-tagged Web, API, and migration images to Docker Hub; use the selected published images for self-hosting.
- Update `source-map-js` to patched version 1.2.2 and remove a duplicate pnpm override.
- Improve candidate-scoped release evidence and recovery guidance, and accept pnpm's separator in the documented release-preparation command.

## [0.1.2]

### Changes

- Rebuild the Web app when the product version changes so its footer stays current.
- Use version-based `vX.Y.Z Latest` titles for new GitHub Releases.
- Update workspace dependencies, including Hono request-path security fixes.

## [0.1.1]

### Changes

- Fixed release verification and publication by making PR validation safe when `main` advances, enabling recovery after failed publication, provisioning pinned Bun and Chromium prerequisites, and assigning the GitHub Actions identity to annotated tags.

## [0.1.0]

### Highlights

- Introduces encrypted Local, Personal, and Shared Vault workflows for managing TOTP accounts, including QR import, invitations, membership controls, recovery, and secure sharing.
- Adds client-side TOTP generation, encrypted backup and restore, key-rotation workflows, and passkey-assisted recovery and remembered-browser unlock.
- Provides an installable web/PWA experience with encrypted Personal Vault offline snapshots and read-only offline access.
- Localizes the product in Indonesian and English, with passwordless sign-in and a versioned API service.

### Security and operations

- Strengthens encrypted-data context binding, access controls, audit redaction, rate limits, and browser delivery protections.
- Documents self-hosting with Docker Compose and optional Tailscale access, and adds release automation and an isolated local load-test suite.
- The responsive web application/PWA is the sole supported client; native iOS and Android distribution is not included.
