# Repository release-version automation

**Status:** Implemented. This document records the release preparation and publication automation; it does not claim that a new release has been published.

## Objective

Automate a reviewable SemVer release PR and exact-source repository publication while keeping API/Web service deployments independent. Publication creates an annotated `vX.Y.Z` tag, a GitHub Release, and versioned Docker Hub images. It does not deploy API/Web services or apply operational database migrations.

## Release PR commands

The root product version is reflected in every workspace package manifest. The first repository release was `v0.1.0`; later releases require an explicit `patch`, `minor`, or `major` bump. Version choice is not inferred from commit subjects.

- `pnpm release:patch`, `pnpm release:minor`, and `pnpm release:major` require a clean, current `main` checkout, the pinned Node/pnpm toolchain, and authenticated `gh` access. They fetch `origin/main` and tags, reject duplicate candidates, update package versions and the changelog, create the dedicated release branch and DCO-signed commit, run release checks plus `pnpm run test:full`, push, and open a non-draft PR with the exact title `[infra][chore] Prepare release vX.Y.Z`.
- The release PR changes only the changelog and top-level versions in workspace manifests. It does not create a candidate readiness record. Maintainers review and curate the generated changelog before merging.
- `pnpm release:update` is limited to the matching dedicated release branch and PR. It merges the latest `origin/main`, appends missing first-parent subjects since the recorded changelog baseline, preserves curated notes, updates the baseline marker, runs the checks, and pushes. The push updates an open PR; if none exists yet, it opens the required PR. It does not force-push or rewrite history.
- Neither command merges a PR or publishes a release. Failures leave the branch available for review or correction and never discard user work.

The changelog draft includes first-parent history from the initial source commit for the inaugural release, or after the latest published release tag for later candidates. The entire `[Unreleased]` section and older release notes remain intact.

## Exact-SHA publication

`.github/workflows/release.yml` runs on pushes to `main` and accepts only a merged dedicated release PR. Candidate discovery checks the PR title and file list, then verifies the complete release diff against the pre-merge `main` SHA from `github.event.before`. This excludes unrelated commits that landed on `main` while the PR was open. Workspace manifests may change only in their top-level `version` fields.

The workflow verifies the triggering source SHA, repository-wide version alignment, SemVer advancement, reviewed changelog section, workflow policy, and the full isolated `pnpm run test:full:container` gate. It tests the exact commit before granting write access to publication. It creates or reuses only an annotated tag at that tested SHA, publishes the GitHub Release, and then builds the versioned Docker Hub images. Recovery accepts only the merged dedicated release PR and reruns verification against its immutable merge commit; it does not bypass source or test checks.

Candidate readiness records are not generated or required by this automated release path. The manually dispatched `Repository release evidence` workflow remains separate and evidence-only. Existing readiness records are historical or separately maintained snapshots; they do not gate release preparation or publication.

## Deployment and database boundaries

Vercel deployments remain path-driven and independent of repository releases. A root product-version-only change rebuilds Web so its compiled footer version updates; API skips the version-only synchronization. Other source and build-input changes retain normal service-specific deployment behavior.

Repository publication never deploys to Vercel or migrates a persistent, development, staging, or production database. The complete verification gate may apply checked-in migrations only inside its own disposable Testcontainers PostgreSQL instance. Operational migrations and service deployments require their existing target-specific authorization.

## Evidence and tests

The release workflow records the exact source commit, version, toolchain, lockfile and release-note digests, and successful check names. Separate image artifacts record Docker Hub digests. Web build bundles are not attached to GitHub Releases.

Focused behavior is covered by `tools/prepare-release.test.mjs`, `tools/release-automation.test.mjs`, `tools/release-publication.test.mjs`, `tools/verify-release-pr-changes.test.mjs`, and `tools/verify-release-workflow-policy.test.mjs`. `pnpm run test:release-process` runs the focused suite. The full repository gate is required before publication.
