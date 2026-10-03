---
name: release-pr
description: Prepare the repository's versioned release candidate and open a dedicated, non-draft release PR after its readiness evidence and checks pass.
disable-model-invocation: true
---

# Release PR

Use `/release-pr` for the inaugural release, or `/release-pr patch`, `/release-pr minor`, or `/release-pr major` for a later release. This skill prepares and opens a PR; it never merges or publishes a release.

## Workflow

1. **Load the release contract.** From the repository root, read `AGENTS.md` and `docs/release-process.md`. Check `.github/workflows/release.yml`, `tools/verify-release-pr-changes.mjs`, and the release-process tests for the current release-only path rules. Treat the release-process document as authoritative for scope and readiness fields.

2. **Recommend and confirm the version.** Fetch tags and inspect `package.json` and the latest valid `vX.Y.Z` tag. For the inaugural release, require root version `0.1.0`, no existing release tag, and no bump argument. For later releases, require the root version to equal the latest valid tag. Summarize changes since that tag and show all three options using `docs/release-process.md`: **patch** for compatible fixes/security/dependency updates; **minor** for backward-compatible capabilities or additive API/database changes; **major** for breaking API, encrypted-protocol, authentication, database, or client behavior. Recommend one option with a short evidence-based reason and note uncertainty. If the user did not explicitly supply a bump, stop after presenting the three options and recommendation, and ask them to choose; a recommendation is not approval. Never infer compatibility from commit prefixes or prepare a release before the user chooses. Use `pnpm run release:prepare -- <bump>` for later releases, or `pnpm run release:prepare` for the inaugural release.

3. **Preflight without disturbing work.** Require the repository root, a clean worktree (including untracked files), the `main` branch, Node `24.19.0`, pnpm `11.17.0`, and `HEAD == origin/main`. Run `git fetch origin main --tags` before checking the remote-tracking SHA. If any condition fails, stop with the exact blocker; do not stash, discard, reset, or switch away from the user's work. Check for an existing release PR with the exact title `[infra][chore] Prepare release vX.Y.Z` and for an existing release/tag. If one already exists, report it instead of creating a duplicate. If a matching PR was merged but its publication run failed, resolve that failure separately rather than preparing the same version again.

4. **Prepare on main, then branch before committing.** Run the repository's `release:prepare` command on clean, up-to-date `main`. Review its reported version and changed paths. Immediately create `infra/chore/prepare-release-vX.Y.Z` before staging or committing; never commit on `main`. Stop if that branch already exists rather than overwriting it.

5. **Curate, don't invent.** Review the generated version section in `CHANGELOG.md` against the first-parent history and preserve the changelog format. Review `docs/release-readiness/vX.Y.Z.md` from scratch for this candidate: record the candidate baseline, current evidence timestamp and owner, fresh repository results, and candidate-specific external API/Web readiness evidence. A generated `HOLD` record is not merge-ready. Never copy a prior candidate's `READY` decision or imply that provider checks were independently verified. Ask once for missing maintainer-owned evidence; if it is not provided, stop without creating a PR. Keep credentials, provider URLs containing secrets, database URLs, cookies, tokens, user data, and other sensitive details out of the record and PR.

6. **Check that the workflow can validate this PR.** The release workflow must validate only changes belonging to the release PR, even if `main` advances while the PR is open. In particular, do not accept a workflow that compares the original first PR commit's parent to the later merge commit: that range can include unrelated changes that landed on `main`. Require regression coverage for this case in the release-process tests. If the implementation or coverage is missing, stop and report the blocker; do not claim the release PR will be safe to merge.

7. **Verify the exact candidate.** From the repository root, run the focused release checks and then the fresh complete gate after the changelog/readiness edits:

   ```bash
   pnpm run test:release-process
   pnpm run verify:version-alignment
   RELEASE_READINESS_RECORD=docs/release-readiness/vX.Y.Z.md pnpm run verify:release-evidence:ready
   pnpm run format:check
   pnpm run test:full
   ```

   Replace `vX.Y.Z` with the actual candidate. Do not use `test:full:hosted` as a substitute for the approved root wrapper. If the complete gate fails or is blocked, diagnose and fix in scope, then rerun it; otherwise stop and report the failed phase. Never access or migrate a persistent/hosted database, deploy, or publish as part of this workflow.

8. **Audit and stage only release files.** Confirm the complete diff contains only `CHANGELOG.md`, `docs/release-readiness/vX.Y.Z.md` when changed, and workspace `package.json` files with only their top-level version changed. Run `git diff --check`; inspect the staged diff; scan the changed content for secrets/PII and stop on any unclassified finding. Stage only these reviewed paths. Commit with `[infra][chore] Prepare release vX.Y.Z`.

9. **Push and open a ready-for-review PR.** Push the dedicated branch and create a non-draft PR targeting `main` with the exact title `[infra][chore] Prepare release vX.Y.Z`. Summarize the version, curated changelog, readiness record, baseline SHA, and exact checks/results. State that merge triggers exact-SHA verification and may publish the repository tag/Release; state that this PR does not deploy services or authorize operational migrations. Do not merge.

10. **Confirm PR state.** Verify the PR targets `main`, has the exact title, contains only permitted release files, and is not a draft. Wait for configured checks and report their actual result. Call it ready to merge only when all required checks pass and readiness is current; otherwise report precisely what remains (including required human review/approval). Never mark it ready or claim checks passed based on intent or a local-only result.

## Stop conditions

Stop before pushing/opening when the worktree is not clean, the base is stale, the version/bump is ambiguous, a duplicate candidate PR/tag exists, candidate readiness evidence is missing, the diff is out of scope, a secret-scanning finding is unclassified, release-workflow validation can misclassify concurrent `main` changes, or a required gate fails. Report the smallest concrete next action. The skill never merges, tags, publishes, deploys, rotates credentials, or operates on persistent databases.
