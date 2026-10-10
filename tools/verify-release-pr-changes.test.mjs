import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { verifyReleaseCommit } from "./verify-release-pr-changes.mjs";

const version = "0.1.1";

test("accepts a dedicated release diff with aligned version metadata and changelog only", (t) => {
  const fixture = createFixture(t);
  prepareCandidate(fixture.root);
  const sourceSha = commit(fixture.root, "prepare release candidate");

  const result = verifyReleaseCommit({ root: fixture.root, version, sourceSha });
  assert.equal(result.baseSha, fixture.baseSha);
  assert.ok(result.changedPaths.includes("CHANGELOG.md"));
  assert.ok(result.changedPaths.includes("apps/api/package.json"));
});

test("checks the complete multi-commit release PR instead of only the final commit", (t) => {
  const fixture = createFixture(t);
  const rootManifest = JSON.parse(readFileSync(join(fixture.root, "package.json"), "utf8"));
  rootManifest.version = version;
  rootManifest.scripts.extra = "unrelated-change";
  writeJson(fixture.root, "package.json", rootManifest);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "--quiet", "-m", "add unrelated earlier manifest change"]);
  prepareCandidate(fixture.root, fixture.baseSha);
  const sourceSha = commit(fixture.root, "finish candidate release metadata");

  assert.throws(
    () => verifyReleaseCommit({ root: fixture.root, version, sourceSha, baseSha: fixture.baseSha }),
    /changes beyond its top-level version field/,
  );
});

test("rejects a stale changelog baseline until the release branch is refreshed", (t) => {
  const fixture = createFixture(t);
  git(fixture.root, ["switch", "--quiet", "-c", "release"]);
  prepareCandidate(fixture.root);
  commit(fixture.root, "prepare release candidate");

  git(fixture.root, ["switch", "--quiet", "main"]);
  writeText(fixture.root, "apps/web/src/main-only-change.ts", "export const mainOnlyChange = true;\n");
  const preMergeMainSha = commit(fixture.root, "land unrelated main change while release PR is open");

  git(fixture.root, ["switch", "--quiet", "release"]);
  git(fixture.root, ["merge", "--quiet", "--no-ff", "-m", "update release branch from main", "main"]);
  const staleSourceSha = git(fixture.root, ["rev-parse", "HEAD"]);
  assert.throws(
    () => verifyReleaseCommit({ root: fixture.root, version, sourceSha: staleSourceSha, baseSha: preMergeMainSha }),
    /does not match release PR base/,
  );

  const refreshedChangelog = readFile(fixture.root, "CHANGELOG.md")
    .replaceAll(fixture.baseSha, preMergeMainSha)
    .replace("- Reviewed change.", "- Reviewed change.\n- land unrelated main change while release PR is open");
  writeText(fixture.root, "CHANGELOG.md", refreshedChangelog);
  commit(fixture.root, "refresh release changelog baseline");
  git(fixture.root, ["switch", "--quiet", "main"]);
  git(fixture.root, ["merge", "--quiet", "--no-ff", "-m", "merge dedicated release PR", "release"]);
  const sourceSha = git(fixture.root, ["rev-parse", "HEAD"]);

  const result = verifyReleaseCommit({ root: fixture.root, version, sourceSha, baseSha: preMergeMainSha });
  assert.equal(result.baseSha, preMergeMainSha);
  assert.ok(!result.changedPaths.includes("apps/web/src/main-only-change.ts"));
});

test("rejects candidate readiness files from the automated release PR scope", (t) => {
  const fixture = createFixture(t);
  prepareCandidate(fixture.root);
  writeText(fixture.root, "docs/release-readiness/v0.1.1.md", "Candidate record is outside release scope.\n");
  const sourceSha = commit(fixture.root, "add candidate readiness record to release PR");

  assert.throws(
    () => verifyReleaseCommit({ root: fixture.root, version, sourceSha }),
    /non-release changes: docs\/release-readiness\/v0\.1\.1\.md/,
  );
});

test("rejects dependency or script changes hidden in workspace manifests", (t) => {
  const fixture = createFixture(t);
  prepareCandidate(fixture.root);
  writeJson(fixture.root, "apps/api/package.json", {
    name: "@fixture/api",
    version,
    scripts: { test: "changed-command" },
  });
  const sourceSha = commit(fixture.root, "change release candidate manifest inputs");
  assert.throws(
    () => verifyReleaseCommit({ root: fixture.root, version, sourceSha }),
    /changes beyond its top-level version field/,
  );
});

test("rejects unrelated application changes from release PRs", (t) => {
  const unrelated = createFixture(t);
  prepareCandidate(unrelated.root);
  writeText(unrelated.root, "apps/web/src/page.tsx", "export const page = true;\n");
  const unrelatedSha = commit(unrelated.root, "mix app work into release PR");
  assert.throws(
    () => verifyReleaseCommit({ root: unrelated.root, version, sourceSha: unrelatedSha }),
    /non-release changes/,
  );
});

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "rhasia-release-pr-diff-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ["init", "--quiet", "--initial-branch=main"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  for (const [path, name] of [
    ["package.json", "fixture-root"],
    ["apps/api/package.json", "@fixture/api"],
    ["apps/web/package.json", "@fixture/web"],
    ["packages/shared/package.json", "@fixture/shared"],
  ]) {
    writeJson(root, path, { name, version: "0.1.0", scripts: { test: "node test.js" } });
  }
  writeText(root, "CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Keep future notes.\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", "baseline"]);
  return { root, baseSha: git(root, ["rev-parse", "HEAD"]) };
}

function prepareCandidate(root, baseSha = git(root, ["rev-parse", "HEAD"])) {
  for (const path of [
    "package.json",
    "apps/api/package.json",
    "apps/web/package.json",
    "packages/shared/package.json",
  ]) {
    const manifest = JSON.parse(readFile(root, path));
    manifest.version = version;
    writeJson(root, path, manifest);
  }
  writeText(
    root,
    "CHANGELOG.md",
    `# Changelog\n\n## [0.1.1]\n\n<!-- Draft generated from first-parent history v0.1.0..${baseSha} (first-parent, exclusive of tag); release-base ${baseSha}. Review and curate before publication. -->\n\n### Changes\n\n- Reviewed change.\n\n## [Unreleased]\n\n### Added\n\n- Keep future notes.\n`,
  );
}

function commit(root, message) {
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function writeJson(root, path, value) {
  writeText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(root, path, text) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, text);
}

function readFile(root, path) {
  return readFileSync(join(root, path), "utf8");
}
