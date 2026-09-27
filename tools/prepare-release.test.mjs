import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { prepareRelease, selectTargetVersion } from "./prepare-release.mjs";

const initialVersion = "0.1.0";

test("prepares the inaugural v0.1.0 draft without bumping versions or replacing Unreleased", () => {
  const fixture = createReleaseFixture();
  try {
    const initialSha = fixture.initialSha;
    commit(fixture.root, "[infra] chore: add release fixture baseline");
    updateOriginMain(fixture.root);
    const originalChangelog = readFileSync(join(fixture.root, "CHANGELOG.md"), "utf8");
    const originalUnreleased = originalChangelog.slice(originalChangelog.indexOf("## [Unreleased]")).trimEnd();

    const result = prepareRelease({ root: fixture.root, initialCommitSha: initialSha });

    assert.equal(result.targetVersion, "0.1.0");
    assert.equal(result.currentVersion, "0.1.0");
    assert.equal(result.baseSha, git(fixture.root, ["rev-parse", "HEAD"]));
    assert.equal(result.readinessRecord, "docs/release-readiness/v0.1.0.md");
    assert.equal(result.createdReadinessRecord, true);
    assert.ok(result.changedPaths.includes("CHANGELOG.md"));
    assert.ok(result.changedPaths.includes("docs/release-readiness/v0.1.0.md"));
    assert.match(result.range, /first-parent history beginning at .*inclusive/);

    const changelog = readFileSync(join(fixture.root, "CHANGELOG.md"), "utf8");
    const unreleasedOffset = changelog.indexOf("## [Unreleased]");
    const releaseOffset = changelog.indexOf("## [0.1.0]");
    assert.ok(unreleasedOffset < releaseOffset, "Unreleased must stay above the new version section");
    assert.match(changelog, /chore: add release fixture baseline/);
    assert.match(changelog, /chore: add release fixture initial/);
    assert.equal(changelog.slice(unreleasedOffset, releaseOffset).trimEnd(), originalUnreleased);
    assert.equal(readJson(fixture.root, "package.json").version, "0.1.0");
    assert.equal(readJson(fixture.root, "package.json").nested.version, "9.9.9");
    assert.equal(readJson(fixture.root, "apps/api/package.json").version, "0.1.0");
    assert.equal(readJson(fixture.root, "packages/shared/package.json").version, "0.1.0");
    assert.match(readText(fixture.root, "apps/mobile/app.config.ts"), /version: "0\.1\.0"/);

    const record = readText(fixture.root, result.readinessRecord);
    assert.match(record, /\*\*HOLD\*\*/);
    assert.match(record, /Not Verifiable/);
    assert.doesNotMatch(record, /\bPass\b|READY FOR HUMAN RELEASE REVIEW/);
    assert.equal(git(fixture.root, ["branch", "--show-current"]), "main");
    assert.equal(git(fixture.root, ["tag", "--list", "v*"]), "");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("prepares explicit semver bumps from the latest release and only first-parent subjects", () => {
  const fixture = createReleaseFixture();
  try {
    const releaseSha = fixture.initialSha;
    git(fixture.root, ["tag", "v0.1.0", releaseSha]);
    commit(fixture.root, "[web] feat: main-line improvement");
    git(fixture.root, ["branch", "release-test-topic"]);
    git(fixture.root, ["checkout", "release-test-topic"]);
    writeFileSync(join(fixture.root, "topic.txt"), "topic change\n");
    commit(fixture.root, "[api] feat: topic-only change");
    git(fixture.root, ["checkout", "main"]);
    commit(fixture.root, "[infra] chore: main continuation");
    git(fixture.root, ["merge", "--no-ff", "release-test-topic", "-m", "Merge topic after main continuation"]);
    git(fixture.root, ["branch", "-D", "release-test-topic"]);
    updateOriginMain(fixture.root);

    const result = prepareRelease({ root: fixture.root, bump: "patch", initialCommitSha: releaseSha });
    assert.equal(result.currentVersion, "0.1.0");
    assert.equal(result.targetVersion, "0.1.1");
    assert.equal(result.readinessRecord, "docs/release-readiness/v0.1.1.md");
    assert.match(result.range, /v0\.1\.0\.\.[0-9a-f]{40} \(first-parent, exclusive of tag\)/);

    const changelog = readText(fixture.root, "CHANGELOG.md");
    assert.match(changelog, /main-line improvement/);
    assert.match(changelog, /main continuation/);
    assert.match(changelog, /Merge topic after main continuation/);
    assert.doesNotMatch(changelog, /topic-only change/);
    for (const path of [
      "package.json",
      "apps/api/package.json",
      "apps/web/package.json",
      "apps/mobile/package.json",
      "packages/shared/package.json",
    ]) {
      assert.equal(readJson(fixture.root, path).version, "0.1.1", `${path} must update`);
      const after = readJson(fixture.root, path);
      const before = JSON.parse(fixture.initialManifests.get(path));
      delete after.version;
      delete before.version;
      assert.deepEqual(after, before, `${path} may only change its top-level version field`);
    }
    assert.match(readText(fixture.root, "apps/mobile/app.config.ts"), /version: "0\.1\.1"/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("inserts a later release after Unreleased and before older release notes", () => {
  const fixture = createReleaseFixture();
  try {
    git(fixture.root, ["tag", "v0.1.0", fixture.initialSha]);
    writeText(
      fixture.root,
      "CHANGELOG.md",
      "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Keep this unreleased fix.\n\n## [0.1.0]\n\n### Changes\n\n- Preserve this published note.\n",
    );
    commit(fixture.root, "record previously published changelog");
    updateOriginMain(fixture.root);

    prepareRelease({ root: fixture.root, bump: "patch", initialCommitSha: fixture.initialSha });

    const changelog = readText(fixture.root, "CHANGELOG.md");
    const unreleasedOffset = changelog.indexOf("## [Unreleased]");
    const newReleaseOffset = changelog.indexOf("## [0.1.1]");
    const previousReleaseOffset = changelog.indexOf("## [0.1.0]");
    assert.ok(unreleasedOffset < newReleaseOffset);
    assert.ok(newReleaseOffset < previousReleaseOffset);
    assert.match(changelog.slice(unreleasedOffset, newReleaseOffset), /Keep this unreleased fix/);
    assert.match(changelog.slice(previousReleaseOffset), /Preserve this published note/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("refuses dirty trees and stale origin/main before editing any file", () => {
  const fixture = createReleaseFixture();
  try {
    writeFileSync(join(fixture.root, "dirty.txt"), "user data\n");
    assert.throws(
      () => prepareRelease({ root: fixture.root, initialCommitSha: fixture.initialSha }),
      /clean working tree/,
    );
    assert.equal(readJson(fixture.root, "package.json").version, initialVersion);
    rmSync(join(fixture.root, "dirty.txt"));

    commit(fixture.root, "unpublished main advancement");
    assert.throws(
      () => prepareRelease({ root: fixture.root, initialCommitSha: fixture.initialSha }),
      /Update origin\/main/,
    );
    assert.equal(readJson(fixture.root, "package.json").version, initialVersion);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("refuses a non-main checkout, a missing bump, and an incorrect bootstrap version", () => {
  const fixture = createReleaseFixture();
  try {
    git(fixture.root, ["checkout", "-b", "feature"]);
    assert.throws(
      () => prepareRelease({ root: fixture.root, initialCommitSha: fixture.initialSha }),
      /requires the main branch/,
    );
    git(fixture.root, ["checkout", "main"]);
    git(fixture.root, ["tag", "v0.1.0", fixture.initialSha]);
    updateOriginMain(fixture.root);
    assert.throws(
      () => prepareRelease({ root: fixture.root, initialCommitSha: fixture.initialSha }),
      /specify exactly one/,
    );
    assert.throws(() => selectTargetVersion("0.2.0", undefined, [], true), /must use the existing 0.1.0/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("does not overwrite an existing candidate record or its readiness decision", () => {
  const fixture = createReleaseFixture();
  try {
    const recordPath = join(fixture.root, "docs/release-readiness/v0.1.0.md");
    mkdirSync(dirname(recordPath), { recursive: true });
    const record = "# Candidate\n\nCandidate version: `0.1.0`\n\n**READY FOR HUMAN RELEASE REVIEW**\n";
    writeFileSync(recordPath, record);
    commit(fixture.root, "add existing candidate readiness record");
    updateOriginMain(fixture.root);

    const result = prepareRelease({ root: fixture.root, initialCommitSha: fixture.initialSha });
    assert.equal(result.createdReadinessRecord, false);
    assert.equal(readText(fixture.root, result.readinessRecord), record);
    assert.ok(!result.changedPaths.includes(result.readinessRecord));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function createReleaseFixture() {
  const root = mkdtempSync(join(tmpdir(), "rhasia-release-prepare-"));
  git(root, ["init", "--quiet", "--initial-branch=main"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  const manifests = [
    ["package.json", { name: "fixture-root", nested: { version: "9.9.9" }, version: initialVersion }],
    [
      "apps/api/package.json",
      { name: "@fixture/api", version: initialVersion, dependencies: { "@fixture/shared": "workspace:*" } },
    ],
    [
      "apps/web/package.json",
      { name: "@fixture/web", version: initialVersion, dependencies: { "@fixture/shared": "workspace:*" } },
    ],
    ["apps/mobile/package.json", { name: "@fixture/mobile", version: initialVersion }],
    [
      "packages/shared/package.json",
      { name: "@fixture/shared", version: initialVersion, dependencies: { "@fixture/shared": "workspace:*" } },
    ],
  ];
  for (const [path, contents] of manifests) writeJson(root, path, contents);
  writeText(root, "apps/mobile/app.config.ts", 'export default {\n  version: "0.1.0",\n};\n');
  writeText(root, "CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Keep this section.\n");
  writeText(root, "tools/fixture.mjs", "export const fixture = true;\n");
  mkdirSync(join(root, "docs/release-readiness"), { recursive: true });
  const initialSha = commit(root, "[infra] chore: add release fixture initial");
  updateOriginMain(root);
  return {
    root,
    initialSha,
    initialManifests: new Map(manifests.map(([path, contents]) => [path, JSON.stringify(contents)])),
  };
}

function updateOriginMain(root) {
  git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
}

function commit(root, message) {
  const nextCommit = Number(git(root, ["rev-list", "--count", "--all"])) + 1;
  writeText(root, `.fixture-commits/${nextCommit}.txt`, `${message}\n`);
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

function readJson(root, path) {
  return JSON.parse(readText(root, path));
}

function readText(root, path) {
  return readFileSync(join(root, path), "utf8");
}
