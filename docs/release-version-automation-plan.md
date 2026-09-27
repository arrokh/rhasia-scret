# Repository release-version automation plan

**Status:** Implemented locally; final verification and review remain in progress.

## Objective

Automate a repeatable, reviewable SemVer source release for the whole repository while keeping API/Web service deployments independent. The output is an annotated repository tag and GitHub Release, not a Vercel deployment or a set of service/mobile binaries.

## Agreed behavior

- The inaugural source release is `v0.1.0`, using the version already aligned in the repository; it does not bump package versions.
- Later releases use an explicit maintainer-selected `patch`, `minor`, or `major` bump. Version selection is not inferred from commit types.
- The root version is reflected in every workspace package manifest and `apps/mobile/app.config.ts`. Mobile metadata remains aligned, but native builds, signing, stores, and device checks are outside this API/Web release.
- `pnpm run release:prepare` changes the working tree and checks only. It does not create branches, commits, push refs, or open PRs. The shared web footer displays the root product version embedded in the deployed Web build before its conditional language switcher, Privacy, and Support links; repository-only version bumps do not refresh the live site.
- Changelog drafts come from first-parent commit subjects on `main`: include history from initial commit `d067b7e` for `v0.1.0`; for future releases use commits after the previous `vX.Y.Z` tag. Maintainers review and edit the draft in the dedicated release PR.
- The dedicated release PR is the human approval. Once merged, Actions runs the exact-commit release checks and automatically creates the annotated tag and GitHub Release if they pass. There is no second approval click.
- GitHub Release notes include the reviewed changelog and full source commit SHA. Do not attach API/Web build bundles or native artifacts; retain non-sensitive verification provenance as workflow evidence.
- Vercel deployments remain path-driven and independent. API/Web source or build-input changes deploy the affected service. A version-only synchronization skips both services.
- The release workflow never deploys to Vercel or applies migrations to persistent/operational databases. Its complete repository test gate may apply checked-in migrations only inside the disposable Testcontainers database owned by that test run; operational migration work keeps its separate, target-specific approval.
- API/Web readiness is required. Native mobile distribution is excluded; credential-rotation work identified by the maintainer as a non-blocking follow-up remains tracked but is not represented as completed.

## Implementation state

- The root, API, Web, mobile, every direct `packages/*` workspace, and Expo metadata are checked by `tools/verify-version-alignment.mjs`; SemVer failures and mismatches fail closed.
- `tools/vercel-ignore.mjs` ignores a product-version-only change while rebuilding for dependency, source, configuration, or other manifest changes.
- `pnpm run release:prepare` requires a clean `main` checkout equal to the locally fetched `origin/main`, selects the inaugural `0.1.0` or an explicit later bump, creates a first-parent changelog draft, preserves `[Unreleased]`, and creates a HOLD candidate record without copying readiness evidence.
- The evidence verifier selects `docs/release-readiness/vX.Y.Z.md`, checks the candidate against the root version, and supports an explicit ready-only publication gate. The manual evidence workflow remains evidence-only.
- `.github/workflows/release.yml` selects only a merged `[infra][chore] Prepare release vX.Y.Z` PR with a release-only diff; an already-existing matching candidate record may remain unchanged. It tests the exact push SHA, then grants write access only to the tag/release publication job. Retries reuse only an annotated tag already at that exact SHA.
- The shared app footer displays the root product version embedded in the current Web build in the requested order with locale-aware accessible naming and conditional language control; it updates on the next Web deployment, not on an independent source-tag publication.
- The current `v0.1.0` readiness record retains its maintainer-reported external evidence and human-review decision; automation or repository tests do not independently verify provider readiness.

## Implementation sequence

### 1. Enforce repository-wide version alignment — implemented

The verifier inspects the root manifest, `apps/api`, `apps/web`, `apps/mobile`, every `packages/*` workspace manifest, and `apps/mobile/app.config.ts`. The native Argon2 module's implementation version remains independent. Focused tests cover mismatched paths and malformed SemVer.

**Evidence:** `pnpm run verify:version-alignment` and `tools/verify-version-alignment.test.mjs`.

### 2. Exclude version-only changes from Vercel deployment — implemented

`tools/vercel-ignore.mjs` ignores only a top-level version-field change. Dependency, scripts, engines, other build inputs, source changes, shared dependency changes, and uncertain Git/JSON analysis retain the existing rebuild or fail-open behavior.

**Evidence:** `tools/vercel-ignore.test.mjs` covers version-only, source, shared dependency, and non-version manifest changes.

### 3. Add the local release-preparation command — implemented

`pnpm run release:prepare` is backed by `tools/prepare-release.mjs`. It requires clean `main` equal to local `origin/main`, makes no remote calls or Git refs, selects `0.1.0` for bootstrap or requires one explicit later bump, updates only package/app version fields, drafts changelog from first-parent subjects beginning at `d067b7e` or after the latest release tag, preserves `[Unreleased]`, and creates/identifies a candidate readiness record without copying readiness evidence. It reports the base SHA, range, and changed paths.

**Evidence:** `tools/prepare-release.test.mjs` uses temporary Git repositories for bootstrap, first-parent ranges, explicit bumps, dirty/stale checkout refusal, alignment, and non-destructive readiness/changelog handling.

### 4. Make readiness selection explicit and candidate-safe — implemented

The validator selects `docs/release-readiness/vX.Y.Z.md`, passes the explicit path, checks `Candidate version` against root SemVer, and retains `HOLD` as a publication failure. `pnpm run verify:release-evidence:ready` is used before release checks; successful tests never create operational readiness. The manual evidence workflow remains evidence-only.

**Evidence:** `tools/verify-release-evidence.test.mjs` covers missing records, mismatched versions, HOLD, and READY candidates.

### 5. Add automatic tag and GitHub Release publication — implemented

`.github/workflows/release.yml` runs on pushes to `main`, cheaply skips ordinary merges, and requires one merged PR titled `[infra][chore] Prepare release vX.Y.Z`. It verifies the PR file list and uses `tools/verify-release-pr-changes.mjs` to reject app changes, dependency/script edits hidden in manifests, and non-version Expo changes.

The candidate gate checks out the exact triggering `github.sha` with full history; verifies the explicit ready record, version alignment, stable version advancement, and reviewed changelog; then runs `pnpm run test:full:container` (the repository's full gate in its disposable Testcontainers database). The test harness may apply checked-in migrations only inside that disposable database; no persistent or operational database is migrated. The publish job has `contents: write`, creates/reuses only an annotated tag at the exact tested SHA, publishes reviewed notes with the full SHA, and uploads only non-sensitive workflow evidence. Actions are immutably pinned and tag publication is serialized by version.

**Evidence:** `tools/release-publication.test.mjs`, `tools/verify-release-pr-changes.test.mjs`, and `tools/verify-release-workflow-policy.test.mjs` cover SemVer advancement, notes, tag retries, release-only changes, permissions, exact-SHA gating, and deployment/migration boundaries.

### 6. Update documentation and verification policy — in progress

Keep `CONTEXT.md`, `docs/release-process.md`, the candidate readiness record, `CHANGELOG.md`, `docs/continuous-integration.md`, `docs/monorepo.md`, and `docs/README.md` consistent with implemented commands and boundaries. Preserve the separate native release guide and operational migration approval policy. The shared footer surfaces the root version without changing deployment or mobile-distribution scope.

Run release-helper and workflow-policy tests, formatting, and the fresh repository `mise exec -- pnpm run test:full` gate after the final implementation change; verify the relevant GitHub issue/check state before handoff.

## Acceptance criteria

- One explicit root SemVer version is enforced across all workspace metadata, including API and mobile metadata.
- The first release is `v0.1.0`; subsequent bumps are explicit and notes are drafted from the agreed first-parent range.
- The local script changes files only; maintainers create and review the release PR through normal GitHub controls.
- Merge of a dedicated `[infra][chore] Prepare release vX.Y.Z` PR with only version metadata/changelog changes (and a candidate readiness update when needed), plus successful exact-SHA checks against a matching READY record, is sufficient to publish the tag and GitHub Release automatically.
- Release notes and provenance identify the exact main SHA; no API/Web build bundle or native binary is attached.
- API/Web deployments remain independent; service code/build changes deploy affected services, while version-only synchronization does not. The web footer displays the root product version embedded in the deployed Web build before conditional language, Privacy, and Support controls; it is not a live pointer to the newest repository tag.
- No release workflow deploys to Vercel or migrates a persistent/operational database; the full test gate is restricted to its disposable Testcontainers database, and no native mobile distribution step is required.
- Readiness must be explicitly current and `READY FOR HUMAN RELEASE REVIEW`; credential rotation remains a separately tracked non-blocking item only under the maintainer's stated scope.
