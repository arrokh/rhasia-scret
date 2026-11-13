# Continuous integration and security automation

Test scope follows [core-flow testing policy](core-flow-testing.md): protect functional outcomes, confidentiality, authorization, and recovery rather than cosmetic fidelity. The [test review decision list](reviews/core-flow-test-review.md) records proposed pruning and coverage gaps. The approved pruning uses an explicit core-flow smoke allowlist; real-stack E2E and production offline/PWA remain separate safety gates. CI schedules, required check names, and navigation performance are unchanged.

GitHub Actions provides main-push and pull-request quality gates, a lightweight pull-request formatting check, and fork-safe pull-request security checks. The workflows and their test fixtures use only synthetic, non-PII database/authentication values and do not require deployment, signing, provider, or production database secrets. Never copy user-provided TOTP URIs, account labels, issuer names, QR payloads, or credentials into CI fixtures.

## Events and permissions

The quality and browser verification workflow runs for pushes to `main` and pull requests targeting `main`. The formatting workflow runs on pull requests and pushes to `main`; the security workflows run on their appropriate public events:

- format check: pull requests targeting `main` and pushes to `main`;
- CodeQL and secret scanning: pull requests targeting `main`, pushes to `main`, manual dispatch, and (for secret scanning) the weekly schedule;
- dependency review: pull requests targeting `main`; and
- Dependabot: weekly dependency and GitHub Actions update proposals.

Workflows declare least-privilege read access by default. CodeQL receives `security-events: write` only for its analysis job so results can be uploaded when GitHub permits it; fork pull requests still execute analysis but do not receive repository secrets or write access.

Do not add secrets to pull-request jobs. GitHub does not expose repository secrets to fork workflows, and the formatting and security jobs must continue to work without provider, deployment, signing, or database secrets. Full quality and browser verification runs on the protected main push and pull requests targeting `main`.

## Required verification coverage

The main-push and pull-request workflow selects affected applications and runs independent checks concurrently:

- **Repository:** frozen-lockfile installation, version/policy/release-evidence checks, release-automation tests, formatting, production dependency audit, and license review.
- **Core:** shared client package typecheck and tests when shared code changes.
- **Quality:** Prisma client/schema checks for the test-only parity oracle, the Sqitch baseline deploy/verify and synthetic legacy-adoption check, Go format/vet/unit/integration/race/native/Linux build plus pinned vulnerability/license scans, TypeScript parity tests, Web lint/typecheck/unit/integration/contract/architecture checks, production build, and route-bundle budgets when web code changes.
- **Browser matrix:** smoke and encrypted workflows for Chromium, plus a production PWA/navigation job for Chromium, when web code changes. Firefox and WebKit are commented out in both CI and Playwright configuration and are not test targets.

Change detection, repository, core, and quality jobs have an eight-minute hard timeout. Browser smoke shards get twelve minutes because Playwright installs operating-system packages from Ubuntu mirrors; encrypted browser workflows and the combined production PWA/navigation job also get twelve minutes for cold browser setup and suite work. These limits are enforced after the work is distributed; they are not a substitute for measuring or fixing slow checks.

The formatting gate applies Prettier to repository-owned JavaScript, TypeScript,
JSON, Markdown, YAML, and CSS files, and applies the Prisma formatter only to the
historical test-oracle schema. New application schema changes use reviewed Sqitch deploy/revert/verify scripts; they are not reformatted by Prettier. The archived passwordless preflight/seed/verification scripts are historical evidence, not an active migration path. The vendored Argon2 C/C++ implementation remains outside this automatic formatter until the project adopts a dedicated, compatible formatter.

The dependency-review job runs on pull requests and rejects newly introduced dependencies with a high or critical advisory. `pnpm audit --prod --audit-level=high`, the JavaScript license policy, `govulncheck` v1.8.0, and `go-licenses` v2.0.1 remain main-push quality steps through `pnpm run verify:api-go`.

## Security automation

- **CodeQL:** JavaScript/TypeScript and Go analysis run on pull requests, `main`, and manual dispatch. The existing `CodeQL JavaScript and TypeScript` status-check name remains stable; Go packages build with the pinned toolchain during the same analysis. Fork analysis runs without uploading results when the token cannot write security events.
- **Secret scanning:** GitHub secret scanning and push protection are enabled for this public repository. The checked-in Gitleaks workflow remains an independent backstop: it scans changed commits on pull requests/pushes and runs a full-history scan on manual or weekly scheduled dispatches, redacting findings in output. Reviewed historical exceptions are documented in [`secret-scan-exceptions.md`](security/secret-scan-exceptions.md) and remain commit-scoped.
- **Repository release evidence/publication:** The manually dispatched `Repository release evidence` workflow accepts an explicit version-specific readiness record and remains evidence-only. The main-push `Repository release publication` workflow skips ordinary merges; it accepts only a dedicated release PR, verifies the exact merge SHA and release-only diff against the pre-merge main SHA, checks version alignment and the reviewed changelog, and runs the complete isolated `pnpm run test:full:container` gate before publication. Candidate readiness records do not gate general CI or this workflow. Verification is read-only; only the final publish job receives `contents: write`. Provenance artifacts contain commit/version/toolchain/check metadata and digests, never service build bundles. The test gate can apply the Sqitch baseline only to its disposable Testcontainers database; the release workflow never migrates an operational database or deploys Vercel.
- **Dependency review:** the pull-request workflow inspects changed dependency manifests and lockfile changes; the main-push quality job also runs the production audit and license policy.
- **Dependabot:** weekly updates cover the root npm/pnpm workspace, `/apps/api` Go Modules, and GitHub Actions. Updates must preserve the single root `pnpm-lock.yaml` boundary for JavaScript dependencies.
- **Action pinning:** third-party actions are pinned to immutable commit SHAs. Dependabot owns their updates.

## Branch protection and required checks

`main` is protected through the GitHub branch-protection API with:

- one pull-request approval before merge;
- stale approval dismissal after new commits;
- required pull-request checks: `Format check`, `CodeQL JavaScript and TypeScript`, `Dependency review`, `Secret scan`, and all CI jobs (`Detect affected packages`, `Repository policy and dependencies`, `Shared client package verification`, `Quality and database test suite`, `Browser smoke (chromium)`, `Browser e2e (chromium)`, and `Production PWA and navigation performance`);
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
pnpm run test:release-process
pnpm run test:full
```

For the browser topology used in CI, run one suite/engine cell at a time. The hosted workflow distributes the explicit smoke allowlist across three Chromium shards and runs real-stack E2E separately; Firefox and WebKit are intentionally commented out:

```bash
CI=true PLAYWRIGHT_WORKERS=1 pnpm run test:browser:smoke --project=chromium --reporter=list
CI=true PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_E2E_WORKERS=2 pnpm run test:browser:e2e --project=chromium --reporter=list
```

`BROWSER_TEST_SEQUENTIAL=1` remains available for constrained local machines, but is not used by the distributed CI workflow.

For local verification, Docker must be running: `pnpm test` and `pnpm run test:full` automatically use disposable Testcontainers PostgreSQL gates. Release PR commands contact GitHub: `pnpm release:patch`, `pnpm release:minor`, or `pnpm release:major` creates the candidate branch and PR from a clean, current `main` checkout; `pnpm release:update` refreshes an existing candidate branch from the latest `origin/main`. The focused equivalents are:

```bash
pnpm run test:integration:container
pnpm run test:container
pnpm run test:full:container
```

The container runner creates PostgreSQL itself, builds and runs the isolated Sqitch migration image to deploy/verify the baseline, materializes the checked-in schema-only legacy fixture in a separate logical database, compares the schema to the fresh baseline, and verifies log-only adoption leaves a sentinel unchanged. It generates Prisma Client for the test-only parity oracle and runs Go and TypeScript integration tests with `REQUIRE_DATABASE_INTEGRATION=1`. It then removes the database container and volume plus the run-owned migration containers/image and verifies cleanup. Because both database URLs are overridden only after the disposable container starts, the development/local database cannot be selected by this command. `pnpm run test:hosted` and `pnpm run test:full:hosted` are the explicit underlying commands for an already-provisioned database. GitHub Actions uses job-scoped PostgreSQL service containers instead of Testcontainers, applies and verifies the same Sqitch baseline before Go and TypeScript persistence tests, then runs the hosted gate with the same strict database-integration policy.

The policy verifier checks the main and pull-request quality triggers, pull-request security triggers, permissions, pinned security actions, fork-safe conditions, and Dependabot coverage. It validates repository policy text; the commands above verify the GitHub-hosted branch protection and secret-scanning settings, while completed workflow runs remain commit-specific evidence.
