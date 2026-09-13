# Continuous integration and security automation

GitHub Actions provides a main-push quality gate, an explicitly enabled implementation-branch quality gate, a lightweight pull-request formatting check, and fork-safe pull-request security checks. The workflows use only synthetic database/authentication values and do not require deployment, signing, provider, or production database secrets.

## Events and permissions

The quality and browser verification workflow runs for pushes to `main` and the explicitly enabled implementation branch `infra/chore/enable-ci-feature-branch`. The formatting workflow runs on pull requests and pushes to `main`; the security workflows run on their appropriate public events:

- format check: pull requests targeting `main` and pushes to `main`;
- CodeQL and secret scanning: pull requests targeting `main`, pushes to `main`, manual dispatch, and (for secret scanning) the weekly schedule;
- dependency review: pull requests targeting `main`; and
- Dependabot: weekly dependency and GitHub Actions update proposals.

Workflows declare least-privilege read access by default. CodeQL receives `security-events: write` only for its analysis job so results can be uploaded when GitHub permits it; fork pull requests still execute analysis but do not receive repository secrets or write access.

Do not add secrets to pull-request jobs. GitHub does not expose repository secrets to fork workflows, and the formatting and security jobs must continue to work without provider, deployment, signing, or database secrets. Full quality and browser verification runs on the protected main push and the explicitly enabled implementation branch.

## Required verification coverage

The main-push and implementation-branch workflow targets a sub-five-minute critical path by selecting only affected applications and running independent checks concurrently:

- **Repository:** frozen-lockfile installation, version/policy/release-evidence checks, formatting, production dependency audit, and license review.
- **Core:** shared client package typecheck and tests when shared code changes.
- **Quality:** Prisma generation/schema/migration/backfill, web lint/typecheck/unit/integration/contract/architecture checks, production build, and route-bundle budgets when web code changes.
- **Mobile:** Expo lint/typecheck/tests/doctor and iOS/Android JavaScript exports when mobile code changes.
- **Browser matrix:** smoke and encrypted workflows for each supported engine, plus a production PWA/navigation job, when web code changes.

Every CI job has a five-minute hard timeout. This is enforced after the work is distributed; it is not a substitute for measuring or fixing slow checks. The mobile verification job intentionally does not claim native compilation or real-device evidence; those remain release checks in [`mobile-release-configuration.md`](mobile-release-configuration.md).

The formatting gate applies Prettier to repository-owned JavaScript, TypeScript,
JSON, Markdown, YAML, and CSS files, and applies the Prisma formatter to the
repository schema. Prisma-generated SQL migrations are not rewritten after
generation. The vendored Argon2 C/C++ implementation and native platform
adapters remain outside this automatic formatter until the project adopts
dedicated, compatible formatters for those languages.

The dependency-review job runs on pull requests and rejects newly introduced dependencies with a high or critical advisory. `pnpm audit --prod --audit-level=high` and the repository license policy remain required main-push quality steps.

## Security automation

- **CodeQL:** JavaScript/TypeScript analysis runs on pull requests, `main`, and manual dispatch. Fork analysis runs without uploading results when the token cannot write security events.
- **Secret scanning:** GitHub secret scanning and push protection are enabled for this public repository. The checked-in Gitleaks workflow remains an independent backstop: it scans changed commits on pull requests/pushes and runs a full-history scan on manual or weekly scheduled dispatches, redacting findings in output.
- **Repository release evidence:** The manually dispatched `Repository release evidence` workflow validates the dated readiness record, version/policy invariants, full repository gate, and non-sensitive commit/toolchain/lockfile metadata from a clean checkout. It never deploys or publishes a release.
- **Dependency review:** the pull-request workflow inspects changed dependency manifests and lockfile changes; the main-push quality job also runs the production audit and license policy.
- **Dependabot:** weekly updates cover the root npm/pnpm workspace and GitHub Actions. Updates must preserve the single root `pnpm-lock.yaml` boundary.
- **Action pinning:** third-party actions are pinned to immutable commit SHAs. Dependabot owns their updates.

## Branch protection and required checks

`main` is protected through the GitHub branch-protection API with:

- one pull-request approval before merge;
- stale approval dismissal after new commits;
- required pull-request checks: `Format check`, `CodeQL JavaScript and TypeScript`, `Dependency review`, and `Secret scan`; quality and browser verification run on pushes to `main` and the explicitly enabled implementation branch;
- strict up-to-date-branch checks and required conversation resolution;
- linear history enforcement;
- force-push and branch-deletion restrictions; and
- administrators included in enforcement.

The repository is public, so GitHub secret scanning, push protection, Dependabot security updates, vulnerability alerts, and the protected-branch settings are enabled. Re-verify remote settings with `gh api repos/arrokh/rhasia-scret/branches/main/protection` and `gh api repos/arrokh/rhasia-scret --jq .security_and_analysis`; completed workflow runs remain the evidence for individual commits.

## Local reproduction

Run the complete repository gate from the root with the mise-managed toolchain:

```bash
mise install
mise run setup
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run verify:ci-policy
pnpm run test:full
```

For the browser topology used in CI, run one suite/engine cell at a time. The hosted workflow uses a six-cell matrix so the three engines do not serialize behind one runner:

```bash
CI=true PLAYWRIGHT_WORKERS=1 pnpm run test:browser:smoke --project=firefox --reporter=list
CI=true PLAYWRIGHT_WORKERS=1 pnpm run test:browser:e2e --project=firefox --reporter=list
```

`BROWSER_TEST_SEQUENTIAL=1` remains available for constrained local machines, but is not used by the distributed CI workflow.

The policy verifier checks the main and explicitly enabled implementation-branch quality triggers, pull-request security triggers, permissions, pinned security actions, fork-safe conditions, and Dependabot coverage. It validates repository policy text; the commands above verify the GitHub-hosted branch protection and secret-scanning settings, while completed workflow runs remain commit-specific evidence.
