# Repository product release process

This process governs the SemVer version and source release for the repository. A repository release publishes an immutable `main` commit as an annotated `vX.Y.Z` tag and GitHub Release. The workflow also builds and publishes Docker Hub images from that exact commit; it does **not** deploy the API or web/PWA application.

Service deployments are independent. Vercel deploys the affected API or Web service from eligible `main` changes according to each service's changed-file scope. API code changes deploy the API; Web code changes deploy Web; shared build dependencies may affect either or both. A product-version-only synchronization triggers a Web build so its compiled footer version can update, while the unnecessary API build remains skipped. Other source, dependency, installation, and deployment-configuration changes retain normal service-specific behavior.

The root product version is also displayed in the shared web footer before the conditional language switcher, Privacy, and Support links. It is compiled into the Web build and identifies that deployed build, not necessarily the newest GitHub source tag. A root product-version-only change on eligible `main` triggers the Web deployment that updates the footer; the API remains skipped when only synchronized version fields changed. The manual `Repository release evidence` workflow remains evidence-only. The local preparation and automatic publication workflow are implemented; see the [release-version automation plan](release-version-automation-plan.md) for implementation details and tests.

## Release scope and version source

The root `package.json` `version` is the product release version. It must be reflected in every workspace package manifest, including:

- `package.json`;
- `apps/api/package.json`;
- `apps/web/package.json`; and
- all package manifests under `packages/`.

`pnpm run verify:version-alignment` enforces these values. Protocol and envelope versions remain separate from the product release version. This release scope covers the API and sole web/PWA client; no native application distribution is maintained.

Use SemVer, with an explicit maintainer-selected bump:

| Change | Version rule | Compatibility requirement                                                                                                                    |
| ------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Patch  | `x.y.Z`      | Security fixes, bug fixes, and dependency updates with no protocol or migration contract change.                                             |
| Minor  | `x.Y.z`      | Backward-compatible product capabilities and additive API/database changes. Existing released clients continue to read their permitted data. |
| Major  | `X.y.z`      | Breaking API, encrypted-protocol, authentication, database, or client behavior. Publish migration and upgrade guidance before the tag.       |

Do not infer protocol compatibility from a matching package version. A crypto or wire-format change requires an ADR, explicit reader/writer compatibility, synthetic non-PII protocol vectors, migration or rollback behavior, and security review.

## Compatibility and rollout rules

- Database migrations use an expand-and-contract sequence: deploy additive schema first, deploy code that reads both shapes, perform bounded/idempotent backfills, then remove obsolete schema in a later release. A repository release never applies an operational migration. Do not roll back application code across a destructive migration without a separately approved recovery plan.
- Web releases preserve the tested service-worker update/lock behavior and Cache Storage boundary. Run the browser/PWA gates against the exact source; a stale client must not display a server-derived workspace before the tested update path completes. See [`offline-pwa-verification.md`](offline-pwa-verification.md).

## Preparing a release candidate

Run preparation from an up-to-date, clean `main` checkout using Node.js `24.19.0`, pnpm `11.17.0`, and the mise-managed toolchain:

```bash
pnpm run release:prepare                 # inaugural v0.1.0 only
pnpm run release:prepare -- patch        # later releases: patch | minor | major
```

The command requires local `origin/main` to equal `HEAD`; it does not fetch, contact a remote, switch branches, commit, push, or open a PR. It refuses staged, modified, and untracked files. For the inaugural release it keeps the existing `0.1.0` version and requires no prior `v*` tag. Later bumps are explicit and calculated from the current root version, which must match the latest release tag.

The command updates only top-level package `version` fields. It creates a changelog draft from first-parent commit subjects starting at initial commit `d067b7e` (inclusive) for the inaugural release, or after the previous release tag for later releases. It preserves existing released entries and the entire `[Unreleased]` section. The dedicated release PR is where the maintainer edits the generated list for wording, duplicates, or internal-only changes.

A new candidate-specific `docs/release-readiness/vX.Y.Z.md` is created with a `HOLD` decision and `Not Verifiable` external evidence. Preparation never copies a prior `READY` decision or claims provider readiness. If the candidate record already exists, the script requires its version to match and leaves its contents untouched. The maintainer must review and update the record and confirm the external evidence remains current before publication.

## Exact-SHA publication workflow

The dedicated release PR title must be exactly `[infra][chore] Prepare release vX.Y.Z`. It may change only the changelog, that candidate's readiness record (when newly created or reviewed), and top-level versions in workspace manifests. A matching readiness record already present on `main` may remain unchanged; the exact-source readiness gate still validates it. The workflow inspects the PR file list and compares the triggering main commit with the pre-merge main SHA from the push event (`github.event.before`). This excludes unrelated changes that landed on `main` while the release PR was open, while rejecting any other out-of-scope changes and manifest/configuration changes beyond version values. Ordinary feature and dependency-update PRs do not publish releases.

After that PR is reviewed and merged to `main`, `.github/workflows/release.yml` verifies the exact triggering `github.sha` (not the moving branch name), explicit candidate readiness, repository-wide version alignment, SemVer advancement, reviewed changelog section, formatting and policy, and the complete repository test gate. The gate is `pnpm run test:full:container`; it runs against a disposable Testcontainers PostgreSQL instance. The verification job also installs the pinned Bun runtime, Chromium browser, and Chromium system dependencies required by the browser suites. Checked-in migrations may be applied only inside that job-owned test database as test setup. The workflow never migrates a persistent, development, staging, or production database. Operational migrations/backfills remain API-owned procedures requiring their own target-specific human approval.

If the candidate-identification job fails before exact-source verification, a maintainer may manually dispatch the same workflow from `main` with the merged release PR number as `recovery_pr`. Recovery accepts only an already-merged PR targeting `main` with the exact dedicated release title, confirms its merge commit is on current `main`, and validates the candidate diff from that merge commit's first parent. Verification and publication still run against that immutable candidate merge SHA and require the same readiness, version, changelog, and full test gates; the recovery dispatch does not bypass or replace them. Do not use this path to retry a candidate that failed readiness or source verification.

The first publication must be `v0.1.0`; each later version must advance beyond the latest valid `vX.Y.Z` tag. Only the final repository-release job receives `contents: write`. It creates an annotated tag at the exact tested SHA. Newly created GitHub Releases use the display title `vX.Y.Z`; the tag name remains `vX.Y.Z`, and the release body contains the reviewed changelog, `Source commit: <full SHA>`, and release-specific Docker Hub pull commands. Retries may reuse an existing annotated tag only when it points to that same SHA; mismatched or lightweight tags fail closed. Existing GitHub Releases continue to be verified against the source SHA without rewriting the release or its title. Repository-release evidence records the source SHA, version, Node/pnpm versions, lockfile digest, release-notes digest, and successful gate names. Docker Hub image evidence is retained separately, and Web build bundles are not attached to GitHub Release assets.

### Docker Hub images

After the tested GitHub Release is published, the `images` job builds all three images from the exact verified source SHA and pushes them to the `arrokh` Docker Hub namespace:

- `arrokh/rhasia-scret` — Web/PWA;
- `arrokh/rhasia-scret-api` — API; and
- `arrokh/rhasia-scret-api-migrate` — one-off API migration image.

Each image receives only the matching `vX.Y.Z` release tag. New releases do not publish a source-SHA image tag or a floating `latest` tag; source-SHA tags from earlier releases remain on Docker Hub. The GitHub Release body lists each image link and release-specific pull command. Images are built for `linux/amd64`; their OCI labels identify the source repository, release version, and verified commit. A separate workflow artifact for each image records its release tag, source commit, Dockerfile/target, platform, and pushed registry digest. After all three image jobs succeed, a follow-up job adds one consolidated overview to the GitHub Actions run summary with image links, purposes, tags, digests, and pull commands. Docker Hub tags can be overwritten unless tag immutability is enabled; use the recorded `@sha256` digest when a deployment must pin the exact image.

Before merging a release PR, configure the GitHub Actions repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`. Use a Docker Hub access token with the `repo:write` scope and permission to push to the `arrokh` namespace. Docker Hub creates personal-namespace repositories on first push; review their visibility afterward and set them to public if they should be visible and pullable by everyone at `https://hub.docker.com/u/arrokh` ([Docker Hub quickstart](https://docs.docker.com/docker-hub/quickstart/)). Never put the token in source control or chat. If image publishing fails after the GitHub Release was created, fix the Docker Hub secret or repository permissions, then use the existing `workflow_dispatch` recovery path with that merged release PR number. It re-verifies the same source before retrying publication.

The required review and merge of the dedicated release PR is the publication approval. The workflow does not require another environment approval. It has no Vercel deployment credentials and does not invoke Vercel.

## Service deployment boundary

Vercel's existing `main`-only, service-aware Git deployments remain independent from repository release publication. A source or build-input change deploys the affected service(s), regardless of whether a GitHub Release is created. The version-only exception ignores only the product `version` field: a root product-version-only change rebuilds Web because its footer compiles that value, while API skips the version-only synchronization. Changes to service source, dependencies, installation metadata, deployment configuration, and the ignore contract continue to rebuild the affected service.

No Vercel project may be created or relinked for this process. Use only the repository's existing projects and their configured associations. Production deployment still requires the applicable human authority and is not performed by the repository release workflow.

## API/Web deployment evidence and rollback

Repository tagging does not build or deploy a service. For a separately authorized Web deployment, use a clean checkout of the approved commit and the mise-managed Node/pnpm toolchain, then run the applicable repository gate, `pnpm run build`, `pnpm run verify:build-output`, and `pnpm --filter @rhasia-scret/web verify:deployment-config`. The Web build's post-build step removes client source maps and scans generated client assets for forbidden server secrets; `verify:build-output` independently fails if maps or prohibited material remain. Run `pnpm audit --prod --audit-level=high`, dependency-license checks, and review the exact-SHA GitHub secret-scan result before deployment.

Record the deployed commit SHA, lockfile digest, Web build/static-output digest, Vercel deployment identifier and URL, verification command outcomes, and the previous known-good deployment identifier as the rollback target. Keep API and Web service evidence separate. A rollback restores a prior artifact only when its database schema remains compatible; database rollback or migration reversal requires its own approved procedure. A suspected dependency, CI, or artifact compromise requires containment and cache/artifact invalidation under [`security/incident-response.md`](security/incident-response.md), not only a version rollback. The release-publication workflow does not perform this deployment work.

## Readiness and evidence

Readiness evidence is candidate-specific. Each `docs/release-readiness/vX.Y.Z.md` record applies only to that version, source SHA, and recorded evidence timestamp. Its `READY FOR HUMAN RELEASE REVIEW` decision is not proof of publication or readiness for a later candidate. Keep mutable operational evidence in the candidate record rather than this process document. Confirm publication through the exact-source GitHub Release and workflow provenance; a local tag or the relative position of a tag and `main` does not establish publication status.

The historical `v0.1.0` record listed credential rotation as a non-blocking follow-up; the `v0.1.2` record says no current follow-ups were reported. These are candidate-specific statements, not proof that any particular credential rotation is complete. Check whether the historical follow-up remains relevant before the next release. If a rotation concerns an active or potentially exposed credential, security containment and incident-response requirements take precedence.

Each pre-release readiness record must include:

- candidate version, reviewed baseline commit SHA, decision, evidence timestamp, and evidence owner;
- repository verification commands and results;
- API/Web deployment and self-hosted readiness evidence, with no secrets or user data; and
- non-blocking follow-ups or exceptions with owner and expiry where applicable.

The post-merge release provenance must record the exact triggering `main` SHA, tag status, GitHub Release reference, lockfile digest, toolchain versions, and check results. The annotated source tag and release notes identify that SHA; each Docker Hub image records it in its OCI revision label and publication artifact alongside the release tag and digest. The repository-release workflow artifact stores non-sensitive source/version/toolchain/check metadata and lockfile/notes digests. Separate Docker Hub artifacts record each published image digest; no Web build bundle is attached to the GitHub Release.

`pnpm run test:full` covers the web/PWA client, shared client package, API, repository policy, browser, build, and performance checks. Its disposable test database does not count as an operational database migration or authorization to migrate another environment.

## Readiness record contents

Each `docs/release-readiness/vX.Y.Z.md` record must identify the candidate version, reviewed baseline SHA, decision, evidence timestamp and owner, linked issue/PRs where relevant, exact repository commands/results, API/Web deployment and self-hosted evidence or `Not Verifiable` status, explicit owner/expiry for exceptions, artifact/provenance identity, rollback target, and maintainer sign-off. Never copy a previous `READY` decision as current without human review, and never put secrets or user Vault data in the record.

Keep signing credentials, provider secrets, deployment credentials, database credentials, cookies, tokens, Vault material, OTPs, QR data, and decrypted content out of Git, logs, artifacts, issue comments, and release notes. Record only redacted operational evidence and immutable identifiers such as commit SHAs and artifact digests.
