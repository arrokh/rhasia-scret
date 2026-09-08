# Continuous integration and security automation

GitHub Actions provides a main-push quality gate and fork-safe pull-request security checks. The workflows use only synthetic database/authentication values and do not require deployment, signing, provider, or production database secrets.

## Events and permissions

The quality and browser verification workflow runs only for pushes to `main`. The security workflows run on their appropriate public events:

- CodeQL and secret scanning: pull requests targeting `main`, pushes to `main`, manual dispatch, and (for secret scanning) the weekly schedule;
- dependency review: pull requests targeting `main`; and
- Dependabot: weekly dependency and GitHub Actions update proposals.

Workflows declare least-privilege read access by default. CodeQL receives `security-events: write` only for its analysis job so results can be uploaded when GitHub permits it; fork pull requests still execute analysis but do not receive repository secrets or write access.

Do not add secrets to pull-request jobs. GitHub does not expose repository secrets to fork workflows, and the security jobs must continue to work without provider, deployment, signing, or database secrets. Full quality and browser verification runs on the subsequent push to `main`.

## Required verification coverage

The quality job covers:

1. frozen-lockfile installation with Node.js `24.19.0` and pnpm `11.17.0`;
2. product-version alignment across the root, web, mobile, core, and Expo configuration;
3. shared client package verification;
4. Expo mobile JavaScript verification;
5. production dependency audit and dependency-license review;
6. Prisma generation, schema validation, migrations, and provider-neutral identity backfill;
7. lint, strict typechecking, unit/integration/contract tests, architecture checks, and production build;
8. client build-output and route-bundle checks.

The browser job covers Playwright smoke, encrypted workflow, PWA, security-header, localization, archive, and performance coverage through `pnpm run test:browser` and `pnpm run test:performance`. The mobile verification job intentionally does not claim native compilation or real-device evidence; those remain release checks in [`mobile-release-configuration.md`](mobile-release-configuration.md).

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
- required pull-request checks: `CodeQL JavaScript and TypeScript`, `Dependency review`, and `Secret scan`; quality and browser verification run on pushes to `main`;
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
pnpm run verify:ci-policy
pnpm run test:full
```

For the browser topology used in CI:

```bash
CI=true \
BROWSER_TEST_SEQUENTIAL=1 \
PLAYWRIGHT_SMOKE_WORKERS=1 \
PLAYWRIGHT_E2E_WORKERS=1 \
pnpm run test:browser
```

The policy verifier checks the main-push quality trigger, pull-request security triggers, permissions, pinned security actions, fork-safe conditions, and Dependabot coverage. It validates repository policy text; the commands above verify the GitHub-hosted branch protection and secret-scanning settings, while completed workflow runs remain commit-specific evidence.
