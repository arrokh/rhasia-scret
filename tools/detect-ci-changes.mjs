import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const allChecks = () => ({ core: true, web: true, mobile: true });
const documentationFiles = new Set([
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "ROADMAP.md",
  "SUPPORT.md",
  "GOVERNANCE.md",
  "CODE_OF_CONDUCT.md",
  "DCO.md",
  "LICENSE",
]);

export function affectedChecks(paths) {
  const checks = { core: false, web: false, mobile: false };
  for (const path of paths) {
    if (path.startsWith("apps/web/")) checks.web = true;
    else if (path.startsWith("apps/mobile/")) checks.mobile = true;
    // Shared packages affect both clients. Unknown packages/configuration run
    // everything rather than silently missing a new dependency or workspace.
    else if (path.startsWith("docs/adr/") || path.startsWith("docs/security/")) return allChecks();
    else if (path.startsWith("docs/") || documentationFiles.has(path)) continue;
    else return allChecks();
  }
  return checks;
}

export function detectAffectedChecks({ before, after, cwd = process.cwd() }) {
  const commit = /^[0-9a-f]{40}$/;
  if (!commit.test(before ?? "") || !commit.test(after ?? "") || /^0+$/.test(before)) return allChecks();
  try {
    // Compare the complete push, including deletions and both sides of moves.
    // NUL separation preserves paths containing whitespace or newlines.
    const paths = execFileSync(
      "git",
      ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", before, after, "--"],
      { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    return affectedChecks(paths.split("\0").filter(Boolean));
  } catch {
    // Initial/force pushes and unavailable history must never suppress checks.
    console.warn("CI change comparison unavailable; running every package check.");
    return allChecks();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checks = detectAffectedChecks({ before: process.env.CI_BASE_SHA, after: process.env.GITHUB_SHA });
  const output = Object.entries(checks)
    .map(([name, affected]) => `${name}=${affected}\n`)
    .join("");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  console.info(output.trim());
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Affected packages\n\n| Checks | Selected |\n| --- | --- |\n${Object.entries(checks)
        .map(([name, affected]) => `| ${name} | ${affected} |`)
        .join("\n")}\n\nRepository policy, formatting, and dependency checks always run.\n`,
    );
  }
}
