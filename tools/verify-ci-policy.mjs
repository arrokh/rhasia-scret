import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    failures.push(`${relativePath} is missing`);
    return "";
  }
  return readFileSync(path, "utf8");
}

function requireText(relativePath, source, pattern, description) {
  if (!pattern.test(source)) failures.push(`${relativePath} must ${description}`);
}

const ci = read(".github/workflows/ci.yml");
const formatWorkflow = read(".github/workflows/format.yml");
const codeql = read(".github/workflows/codeql.yml");
const dependencyReview = read(".github/workflows/dependency-review.yml");
const releaseEvidence = read(".github/workflows/release-evidence.yml");
const secretScan = read(".github/workflows/secret-scan.yml");
const dependabot = read(".github/dependabot.yml");
const monorepo = read("docs/monorepo.md");

requireText(
  ".github/workflows/ci.yml",
  ci,
  /\n\s+push:\s*\n\s+branches:\s+\[main, infra\/chore\/enable-ci-feature-branch\]/,
  "run for main and the explicitly enabled implementation branch",
);
requireText(
  ".github/workflows/ci.yml",
  ci,
  /\n\s+pull_request:\s*\n\s+branches:\s+\[main\]/,
  "run for pull requests targeting main",
);
if (/\n\s+workflow_dispatch:\s*(?:\n|$)/.test(ci))
  failures.push(".github/workflows/ci.yml must not support manual dispatch");
requireText(
  ".github/workflows/ci.yml",
  ci,
  /permissions:\s*\n\s+contents:\s*read/,
  "default to read-only contents permissions",
);
for (const command of [
  "pnpm run test:full:core",
  "pnpm run test:full:mobile",
  "pnpm audit --prod --audit-level=high",
  "pnpm run verify:dependency-licenses",
  "pnpm run format:check",
  "pnpm --filter @rhasia-scret/web run lint",
  "pnpm run typecheck:web",
  "pnpm run test:release-evidence",
  "pnpm run test:web",
  "pnpm run test:architecture",
  "pnpm run build",
  'pnpm run test:browser:${{ matrix.suite }} --project="${{ matrix.browser }}"',
  "pnpm run test:browser:pwa",
  "pnpm run test:performance",
])
  requireText(
    ".github/workflows/ci.yml",
    ci,
    new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `run ${command}`,
  );

requireText(".github/workflows/ci.yml", ci, /suite: \[smoke, e2e\]/, "cover both development browser suites");
requireText(
  ".github/workflows/ci.yml",
  ci,
  /browser:\s*\n\s+- chromium\s*\n\s+# - firefox:\s+intentionally deferred from hosted CI coverage\s*\n\s+# - webkit:\s+intentionally deferred from hosted CI coverage/,
  "focus hosted browser coverage on Chromium with Firefox and WebKit deferred",
);

const ciTimeoutCount = (ci.match(/^\s+timeout-minutes: 8$/gm) ?? []).length;
if (ciTimeoutCount !== 7)
  failures.push(`.github/workflows/ci.yml must enforce eight-minute timeouts for all 7 jobs (found ${ciTimeoutCount})`);
if (/^concurrency:/m.test(ci)) failures.push(".github/workflows/ci.yml must use job-scoped concurrency");
for (const group of [
  "ci-changes-${{ github.workflow }}-${{ github.ref_name }}",
  "ci-repository-${{ github.workflow }}-${{ github.ref_name }}",
  "ci-core-${{ github.workflow }}-${{ github.ref_name }}",
  "ci-web-quality-${{ github.workflow }}-${{ github.ref_name }}",
  "ci-mobile-${{ github.workflow }}-${{ github.ref_name }}",
  "ci-web-browser-${{ github.workflow }}-${{ github.ref_name }}-${{ matrix.suite }}-${{ matrix.browser }}",
  "ci-web-production-${{ github.workflow }}-${{ github.ref_name }}",
]) {
  if (!ci.includes(`group: ${group}`)) failures.push(`.github/workflows/ci.yml must scope concurrency to ${group}`);
}

requireText(
  ".github/workflows/format.yml",
  formatWorkflow,
  /\n\s+pull_request:\s*\n\s+branches:\s+\[main\]/,
  "run formatting checks on pull requests targeting main",
);
requireText(
  ".github/workflows/format.yml",
  formatWorkflow,
  /\n\s+push:\s*\n\s+branches:\s+\[main\]/,
  "run formatting checks on pushes to main",
);
requireText(
  ".github/workflows/format.yml",
  formatWorkflow,
  /permissions:\s*\n\s+contents:\s*read/,
  "default to read-only contents permissions",
);
requireText(
  ".github/workflows/format.yml",
  formatWorkflow,
  /pnpm run format:check/,
  "run the repository formatting check",
);

requireText(
  ".github/workflows/codeql.yml",
  codeql,
  /security-events:\s*write/,
  "grant CodeQL only security event write access",
);
requireText(
  ".github/workflows/codeql.yml",
  codeql,
  /github\.event\.pull_request\.head\.repo\.fork/,
  "handle fork pull requests without assuming write access",
);
requireText(
  ".github/workflows/dependency-review.yml",
  dependencyReview,
  /pull_request:/,
  "run dependency review on pull requests",
);
requireText(
  ".github/workflows/secret-scan.yml",
  secretScan,
  /gitleaks\/gitleaks-action@[0-9a-f]{40}/,
  "pin the secret scanner to an immutable commit",
);
requireText(
  ".github/workflows/secret-scan.yml",
  secretScan,
  /schedule:\s*\n\s+- cron:/,
  "run a scheduled full-history scan",
);
for (const command of [
  "pnpm install --frozen-lockfile",
  "pnpm run verify:release-evidence",
  "pnpm run verify:version-alignment",
  "pnpm run test:full",
]) {
  requireText(
    ".github/workflows/release-evidence.yml",
    releaseEvidence,
    new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `run ${command}`,
  );
}
requireText(
  ".github/dependabot.yml",
  dependabot,
  /package-ecosystem:\s*["']?npm["']?/,
  "update workspace dependencies",
);
requireText(
  ".github/dependabot.yml",
  dependabot,
  /package-ecosystem:\s*["']?github-actions["']?/,
  "update GitHub Actions",
);
if (!/CI quality\/browser jobs also run on pull requests targeting `main`/.test(monorepo))
  failures.push("docs/monorepo.md must describe quality/browser CI on pull requests targeting main");

const workflowPaths = [
  ".github/workflows/ci.yml",
  ".github/workflows/format.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/dependency-review.yml",
  ".github/workflows/release-evidence.yml",
  ".github/workflows/secret-scan.yml",
];
for (const relativePath of workflowPaths) {
  const source = read(relativePath);
  for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
    const reference = match[1];
    if (!/@[0-9a-f]{40}$/.test(reference))
      failures.push(`${relativePath} uses ${reference} without an immutable commit pin`);
  }
}

if (failures.length > 0) {
  console.error("CI policy verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "CI policy verified: main/PR quality gates, affected-package selection, eight-minute job budgets, fork-safe security checks, least privilege, coverage, and immutable action pins are present.",
);
