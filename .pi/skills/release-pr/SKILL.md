---
name: release-pr
description: Prepare or refresh a repository release pull request with the release commands.
disable-model-invocation: true
---

# Release PR

Use the repository release commands to prepare and refresh a release PR. The commands push branches and create or update PRs; they never merge, publish a release, deploy services, or run operational migrations.

## Create a candidate

1. Read `docs/release-process.md` and confirm the requested SemVer bump is explicit. Do not infer compatibility from commit prefixes.
2. From a clean, current local `main` checkout with `CI` not set to `true`, run exactly one command:
   - `pnpm release:patch`
   - `pnpm release:minor`
   - `pnpm release:major`
3. Report the command's actual result, candidate version, branch, PR URL, and verification results. The command runs the focused release checks and full repository gate before pushing and opening a non-draft PR.

## Refresh a candidate

1. Run `pnpm release:update` only from the dedicated `infra/chore/prepare-release-vX.Y.Z` branch. The command verifies the matching release PR when one exists.
2. It merges latest `origin/main`, appends missing first-parent subjects to the candidate changelog without replacing curated notes, runs the checks, and pushes the branch. It updates the managed baseline/commit section of an existing PR description while preserving maintainer text outside that section; if no PR exists, the command creates it.
3. If the command reports conflicts, an invalid candidate, a dirty worktree, or failed checks, stop and report the exact blocker. Resolve conflicts without discarding user changes, commit the resolved merge, then rerun. Preserve user changes and do not force-push.

The release publication workflow runs only after a reviewed release PR is merged. It validates the exact source SHA, release-only diff, version alignment, changelog, and full isolated test gate before publication. Candidate readiness records are not part of this automated path. The skill does not merge or publish.
