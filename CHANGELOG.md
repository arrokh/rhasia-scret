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
