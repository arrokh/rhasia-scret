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
const codeql = read(".github/workflows/codeql.yml");
const dependencyReview = read(".github/workflows/dependency-review.yml");
const releaseEvidence = read(".github/workflows/release-evidence.yml");
const secretScan = read(".github/workflows/secret-scan.yml");
const dependabot = read(".github/dependabot.yml");
const monorepo = read("docs/monorepo.md");

requireText(".github/workflows/ci.yml", ci, /\n\s+push:\s*\n\s+branches:\s+\[main\]/, "run only for pushes to main");
if (/\n\s+pull_request:\s*(?:\n|$)/.test(ci)) failures.push(".github/workflows/ci.yml must not run for pull requests");
if (/\n\s+workflow_dispatch:\s*(?:\n|$)/.test(ci)) failures.push(".github/workflows/ci.yml must not support manual dispatch");
requireText(".github/workflows/ci.yml", ci, /permissions:\s*\n\s+contents:\s*read/, "default to read-only contents permissions");
for (const command of [
  "pnpm run test:full:core",
  "pnpm run test:full:mobile",
  "pnpm audit --prod --audit-level=high",
  "pnpm run verify:dependency-licenses",
  "pnpm run lint",
  "pnpm run typecheck",
  "pnpm run test",
  "pnpm run test:architecture",
  "pnpm run build",
  "pnpm run test:browser",
  "pnpm run test:performance",
]) requireText(".github/workflows/ci.yml", ci, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `run ${command}`);

requireText(".github/workflows/codeql.yml", codeql, /security-events:\s*write/, "grant CodeQL only security event write access");
requireText(".github/workflows/codeql.yml", codeql, /github\.event\.pull_request\.head\.repo\.fork/, "handle fork pull requests without assuming write access");
requireText(".github/workflows/dependency-review.yml", dependencyReview, /pull_request:/, "run dependency review on pull requests");
requireText(".github/workflows/secret-scan.yml", secretScan, /gitleaks\/gitleaks-action@[0-9a-f]{40}/, "pin the secret scanner to an immutable commit");
requireText(".github/workflows/secret-scan.yml", secretScan, /schedule:\s*\n\s+- cron:/, "run a scheduled full-history scan");
for (const command of ["pnpm install --frozen-lockfile", "pnpm run verify:release-evidence", "pnpm run verify:version-alignment", "pnpm run test:full"]) {
  requireText(".github/workflows/release-evidence.yml", releaseEvidence, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `run ${command}`);
}
requireText(".github/dependabot.yml", dependabot, /package-ecosystem:\s*["']?npm["']?/, "update workspace dependencies");
requireText(".github/dependabot.yml", dependabot, /package-ecosystem:\s*["']?github-actions["']?/, "update GitHub Actions");
if (/quality\/database and browser jobs for pull requests|quality and browser checks scoped to pull requests/.test(monorepo)) failures.push("docs/monorepo.md must describe quality/browser CI as main-push-only");

const workflowPaths = [".github/workflows/ci.yml", ".github/workflows/codeql.yml", ".github/workflows/dependency-review.yml", ".github/workflows/release-evidence.yml", ".github/workflows/secret-scan.yml"];
for (const relativePath of workflowPaths) {
  const source = read(relativePath);
  for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
    const reference = match[1];
    if (!/@[0-9a-f]{40}$/.test(reference)) failures.push(`${relativePath} uses ${reference} without an immutable commit pin`);
  }
}

if (failures.length > 0) {
  console.error("CI policy verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("CI policy verified: main-push quality gate, fork-safe PR security checks, least privilege, coverage, and immutable action pins are present.");
