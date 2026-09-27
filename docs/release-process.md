# Repository product release process

This process governs the SemVer version and source release for the repository. A repository release publishes an immutable `main` commit as an annotated `vX.Y.Z` tag and GitHub Release. It does **not** deploy the API or Web service and does not distribute native mobile builds.

Service deployments are independent. Vercel deploys the affected API or Web service from eligible `main` changes according to each service's changed-file scope. API code changes deploy the API; Web code changes deploy Web; shared build dependencies may affect either or both. A product-version-only synchronization skips both Vercel builds, while other source, dependency, installation, and deployment-configuration changes retain normal service-specific behavior.

The root product version is also displayed in the shared web footer before the conditional language switcher, Privacy, and Support links. It is compiled into the Web build and identifies that deployed build, not necessarily the newest GitHub source tag. A repository-only version bump intentionally does not trigger Vercel or update an already-running Web build; the footer changes with the next independently triggered Web deployment. The manual `Repository release evidence` workflow remains evidence-only. The local preparation and automatic publication workflow are implemented; see the [release-version automation plan](release-version-automation-plan.md) for implementation details and tests.

## Release scope and version source

The root `package.json` `version` is the product release version. It must be reflected in every workspace package manifest and the Expo app version:

- `package.json`;
- `apps/api/package.json`;
- `apps/web/package.json`;
- `apps/mobile/package.json`;
- all package manifests under `packages/`; and
- `apps/mobile/app.config.ts`.

`pnpm run verify:version-alignment` enforces these values. The native Argon2 module under `apps/mobile/modules/native-argon2id` has implementation-specific metadata and is not a product release package. Protocol/envelope versions and native store build numbers are also separate from the product release version.

This release scope covers the repository's API and Web source release. Mobile version metadata stays aligned, but iOS/Android native compilation, signing, store submission, and real-device release checks are out of scope. Those remain required for a separate native distribution release under [`mobile-release-configuration.md`](mobile-release-configuration.md).

Use SemVer, with an explicit maintainer-selected bump:

| Change | Version rule | Compatibility requirement                                                                                                                    |
| ------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Patch  | `x.y.Z`      | Security fixes, bug fixes, and dependency updates with no protocol or migration contract change.                                             |
| Minor  | `x.Y.z`      | Backward-compatible product capabilities and additive API/database changes. Existing released clients continue to read their permitted data. |
| Major  | `X.y.z`      | Breaking API, encrypted-protocol, authentication, database, or client behavior. Publish migration and upgrade guidance before the tag.       |

Do not infer protocol compatibility from a matching package version. A crypto or wire-format change requires an ADR, explicit reader/writer compatibility, synthetic non-PII cross-platform vectors, migration or rollback behavior, and security review.

## Compatibility and rollout rules

- Database migrations use an expand-and-contract sequence: deploy additive schema first, deploy code that reads both shapes, perform bounded/idempotent backfills, then remove obsolete schema in a later release. A repository release never applies an operational migration. Do not roll back application code across a destructive migration without a separately approved recovery plan.
- Web releases preserve the tested service-worker update/lock behavior and Cache Storage boundary. Run the browser/PWA gates against the exact source; a stale client must not display a server-derived workspace before the tested update path completes. See [`offline-pwa-verification.md`](offline-pwa-verification.md).
- The native app retains stable identifiers `com.arrokh.rhasiascret` and verified-link configuration described in [`mobile-release-configuration.md`](mobile-release-configuration.md). Native store build numbers remain monotonic per platform and separate from SemVer. Distributed builds must omit `EXPO_PUBLIC_NATIVE_CRYPTO_VALIDATION=1`; validation builds are local diagnostics only.

## Preparing a release candidate

Run preparation from an up-to-date, clean `main` checkout using Node.js `24.19.0`, pnpm `11.17.0`, and the mise-managed toolchain:

```bash
pnpm run release:prepare                 # inaugural v0.1.0 only
pnpm run release:prepare -- patch        # later releases: patch | minor | major
```

The command requires local `origin/main` to equal `HEAD`; it does not fetch, contact a remote, switch branches, commit, push, or open a PR. It refuses staged, modified, and untracked files. For the inaugural release it keeps the existing `0.1.0` version and requires no prior `v*` tag. Later bumps are explicit and calculated from the current root version, which must match the latest release tag.

The command updates only top-level package `version` fields and `apps/mobile/app.config.ts`'s Expo `version`. It creates a changelog draft from first-parent commit subjects starting at initial commit `d067b7e` (inclusive) for the inaugural release, or after the previous release tag for later releases. It preserves existing released entries and the entire `[Unreleased]` section. The dedicated release PR is where the maintainer edits the generated list for wording, duplicates, or internal-only changes.

A new candidate-specific `docs/release-readiness/vX.Y.Z.md` is created with a `HOLD` decision and `Not Verifiable` external evidence. Preparation never copies a prior `READY` decision or claims provider readiness. If the candidate record already exists, the script requires its version to match and leaves its contents untouched. The maintainer must review and update the record and confirm the external evidence remains current before publication.

## Exact-SHA publication workflow

The dedicated release PR title must be exactly `[infra][chore] Prepare release vX.Y.Z`. It may change only the changelog, that candidate's readiness record (when newly created or reviewed), top-level versions in workspace manifests, and the Expo app version. A matching readiness record already present on `main` may remain unchanged; the exact-source readiness gate still validates it. The workflow inspects the PR file list and compares the resulting main commit with the first commit's parent; it rejects unrelated changes and any manifest/configuration changes beyond version values. Ordinary feature and dependency-update PRs do not publish releases.

After that PR is reviewed and merged to `main`, `.github/workflows/release.yml` verifies the exact triggering `github.sha` (not the moving branch name), explicit candidate readiness, repository-wide version alignment, SemVer advancement, reviewed changelog section, formatting and policy, and the complete repository test gate. The gate is `pnpm run test:full:container`; it runs against a disposable Testcontainers PostgreSQL instance. Checked-in migrations may be applied only inside that job-owned test database as test setup. The workflow never migrates a persistent, development, staging, or production database. Operational migrations/backfills remain API-owned procedures requiring their own target-specific human approval.

The first publication must be `v0.1.0`; each later version must advance beyond the latest valid `vX.Y.Z` tag. Only the final publish job receives `contents: write`. It creates an annotated tag at the exact tested SHA and publishes release notes from the reviewed changelog section with `Source commit: <full SHA>`. Retries may reuse an existing annotated tag only when it points to that same SHA; mismatched or lightweight tags fail closed. Publication evidence records the source SHA, version, Node/pnpm versions, lockfile digest, release-notes digest, and successful gate names. No application build bundles or native binaries are uploaded or attached.

The required review and merge of the dedicated release PR is the publication approval. The workflow does not require another environment approval. It has no Vercel deployment credentials and does not invoke Vercel, compile/sign native apps, or submit to app stores.

## Service deployment boundary

Vercel's existing `main`-only, service-aware Git deployments remain independent from repository release publication. A source or build-input change deploys the affected service(s), regardless of whether a GitHub Release is created. The version-only exception ignores only the product `version` field; changes to service source, dependencies, installation metadata, deployment configuration, and the ignore contract continue to rebuild the affected service.

No Vercel project may be created or relinked for this process. Use only the repository's existing projects and their configured associations. Production deployment still requires the applicable human authority and is not performed by the repository release workflow.

## API/Web deployment evidence and rollback

Repository tagging does not build or deploy a service. For a separately authorized Web deployment, use a clean checkout of the approved commit and the mise-managed Node/pnpm toolchain, then run the applicable repository gate, `pnpm run build`, `pnpm run verify:build-output`, and `pnpm run verify:deployment-config`. The Web build's post-build step removes client source maps and scans generated client assets for forbidden server secrets; `verify:build-output` independently fails if maps or prohibited material remain. Run `pnpm audit --prod --audit-level=high`, dependency-license checks, and review the exact-SHA GitHub secret-scan result before deployment.

Record the deployed commit SHA, lockfile digest, Web build/static-output digest, Vercel deployment identifier and URL, verification command outcomes, and the previous known-good deployment identifier as the rollback target. Keep API and Web service evidence separate. A rollback restores a prior artifact only when its database schema remains compatible; database rollback or migration reversal requires its own approved procedure. A suspected dependency, CI, or artifact compromise requires containment and cache/artifact invalidation under [`security/incident-response.md`](security/incident-response.md), not only a version rollback. The release-publication workflow does not perform this deployment work.

## Readiness and evidence

The current API/Web repository readiness record is [`release-readiness/v0.1.0.md`](release-readiness/v0.1.0.md). Its decision is `READY FOR HUMAN RELEASE REVIEW`, based on maintainer-reported API/Web Vercel and self-hosted verification. The agent did not independently access those provider environments. The record is not a deployment action or a claim that the release has already been published. The mobile native release is out of scope for this repository release.

Credential-rotation work that the maintainer has identified as a non-blocking follow-up may remain in progress; it must not be represented as completed. If a rotation concerns an active or potentially exposed credential, the security incident and containment rules take precedence over this release exception.

Each pre-release readiness record must include:

- candidate version, reviewed baseline commit SHA, decision, evidence timestamp, and evidence owner;
- repository verification commands and results;
- API/Web deployment and self-hosted readiness evidence, with no secrets or user data; and
- non-blocking follow-ups or exceptions with owner and expiry where applicable.

The post-merge release provenance must record the exact triggering `main` SHA, tag status, GitHub Release reference, lockfile digest, toolchain versions, and check results. The annotated tag and release notes must identify that same SHA. The release workflow artifact stores non-sensitive source/version/toolchain/check metadata and lockfile/notes digests; it does not attach service build output.

`pnpm run test:full` includes mobile JavaScript and Expo Doctor verification, but this API/Web repository release does not require native mobile builds or store/device evidence. Its disposable test database does not count as an operational database migration or authorization to migrate another environment. For a separate native distribution, follow the platform build, verified-link, signing, simulator/device, and store-evidence procedure in [`mobile-release-configuration.md`](mobile-release-configuration.md); simulator or JavaScript bundle evidence is not physical-device evidence.

## Readiness record contents

Each `docs/release-readiness/vX.Y.Z.md` record must identify the candidate version, reviewed baseline SHA, decision, evidence timestamp and owner, linked issue/PRs where relevant, exact repository commands/results, API/Web deployment and self-hosted evidence or `Not Verifiable` status, explicit owner/expiry for exceptions, artifact/provenance identity, rollback target, and maintainer sign-off. Never copy a previous `READY` decision as current without human review, and never put secrets or user Vault data in the record.

Keep signing credentials, provider secrets, deployment credentials, database credentials, cookies, tokens, Vault material, OTPs, QR data, and decrypted content out of Git, logs, artifacts, issue comments, and release notes. Record only redacted operational evidence and immutable identifiers such as commit SHAs and artifact digests.
