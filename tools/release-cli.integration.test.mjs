import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createReleasePullRequest } from "./release-pr.mjs";
import { updateReleasePullRequest } from "./release-update.mjs";

const initialVersion = "0.2.0";

test("release commands create a PR and update it with newly merged main commits", () => {
  const fixture = createRepositoryFixture();
  const originalPath = process.env.PATH;
  const originalStatePath = process.env.GH_TEST_STATE;
  const originalGateLogPath = process.env.PNPM_TEST_LOG;
  const originalCi = process.env.CI;
  try {
    process.env.PATH = `${fixture.binDirectory}${process.platform === "win32" ? ";" : ":"}${originalPath ?? ""}`;
    process.env.GH_TEST_STATE = fixture.ghStatePath;
    process.env.PNPM_TEST_LOG = fixture.pnpmLogPath;
    process.env.CI = "true";
    assert.throws(
      () => createReleasePullRequest({ root: fixture.root, bump: "patch" }),
      /must run locally.*hosted database/,
    );
    assert.throws(() => updateReleasePullRequest({ root: fixture.root }), /must run locally.*hosted database/);
    process.env.CI = "false";

    const created = createReleasePullRequest({ root: fixture.root, bump: "patch" });
    assert.equal(created.version, "0.2.1");
    assert.equal(created.branch, "infra/chore/prepare-release-v0.2.1");
    assert.equal(created.pullRequest.title, "[infra][chore] Prepare release v0.2.1");
    assert.equal(created.pullRequest.baseRefName, "main");
    assert.equal(created.pullRequest.isDraft, false);
    assert.equal(git(fixture.root, ["branch", "--show-current"]), created.branch);
    assertReleaseChecksRun(fixture.pnpmLogPath, 1);
    assert.throws(() => createReleasePullRequest({ root: fixture.root, bump: "patch" }), /requires main/);

    git(fixture.root, ["switch", "main"]);
    writeText(fixture.root, "apps/web/new-release-feature.txt", "synthetic main change\n");
    const mainChangelog = readText(fixture.root, "CHANGELOG.md").replace(
      "- Keep this synthetic unreleased note.",
      "- Keep this synthetic unreleased note.\n- Add a synthetic main changelog note.",
    );
    writeText(fixture.root, "CHANGELOG.md", mainChangelog);
    commit(fixture.root, "[web] add synthetic release feature");
    git(fixture.root, ["push", "origin", "main"]);
    git(fixture.root, ["switch", created.branch]);

    const githubState = JSON.parse(readFileSync(fixture.ghStatePath, "utf8"));
    const initialPullRequestBody = githubState.pullRequests[0].body;
    const candidateSha = git(fixture.root, ["rev-parse", "HEAD"]);
    const remoteCandidateSha = remoteBranchSha(fixture.root, created.branch);
    githubState.pullRequests[0].body = "Maintainer-authored replacement description";
    writeFileSync(fixture.ghStatePath, JSON.stringify(githubState));
    assert.throws(() => updateReleasePullRequest({ root: fixture.root }), /missing its automation markers/);
    assert.equal(git(fixture.root, ["rev-parse", "HEAD"]), candidateSha);
    assert.equal(remoteBranchSha(fixture.root, created.branch), remoteCandidateSha);
    assert.equal(git(fixture.root, ["status", "--porcelain", "--untracked-files=all"]), "");
    assertReleaseChecksRun(fixture.pnpmLogPath, 1);

    githubState.pullRequests[0].body = initialPullRequestBody;
    writeFileSync(fixture.ghStatePath, JSON.stringify(githubState));
    const updated = updateReleasePullRequest({ root: fixture.root });
    assert.equal(updated.version, "0.2.1");
    assert.deepEqual(updated.appendedSubjects, ["[web] add synthetic release feature"]);
    assert.equal(updated.pullRequest.number, created.pullRequest.number);
    assert.equal(updated.pullRequest.headRefName, created.branch);
    assert.ok(updated.pullRequest.body.includes(updated.mainSha));
    assert.ok(updated.pullRequest.body.includes("Newly appended first-parent commits: 1"));

    const changelog = readText(fixture.root, "CHANGELOG.md");
    assert.match(changelog, /- \[web\] add synthetic release feature/);
    assert.match(changelog, /- Add a synthetic main changelog note\./);
    assert.match(changelog, new RegExp(`release-base ${updated.mainSha}`));
    assert.equal(readText(fixture.root, "apps/web/new-release-feature.txt"), "synthetic main change\n");
    assert.equal(git(fixture.root, ["status", "--porcelain", "--untracked-files=all"]), "");
    assertReleaseChecksRun(fixture.pnpmLogPath, 2);
    git(fixture.root, ["switch", "main"]);
    assert.throws(() => updateReleasePullRequest({ root: fixture.root }), /non-main release branch/);

    git(fixture.root, ["switch", created.branch]);
    const updatedCandidateSha = git(fixture.root, ["rev-parse", "HEAD"]);
    githubState.pullRequests[0].isDraft = true;
    writeFileSync(fixture.ghStatePath, JSON.stringify(githubState));
    assert.throws(() => updateReleasePullRequest({ root: fixture.root }), /matching non-draft release PR/);
    assert.equal(git(fixture.root, ["rev-parse", "HEAD"]), updatedCandidateSha);
    assertReleaseChecksRun(fixture.pnpmLogPath, 2);

    githubState.pullRequests[0].isDraft = false;
    githubState.pullRequests = [];
    writeFileSync(fixture.ghStatePath, JSON.stringify(githubState));
    const recreated = updateReleasePullRequest({ root: fixture.root });
    assert.equal(recreated.pullRequest.number, 2);
    assert.equal(recreated.pullRequest.headRefName, created.branch);
    assertReleaseChecksRun(fixture.pnpmLogPath, 3);

    git(fixture.root, ["switch", "main"]);
    const manualBranch = "infra/chore/prepare-release-v0.3.0";
    git(fixture.root, ["switch", "--create", manualBranch]);
    const mainSha = git(fixture.root, ["rev-parse", "HEAD"]);
    for (const path of [
      "package.json",
      "apps/api/package.json",
      "apps/web/package.json",
      "packages/shared/package.json",
    ]) {
      const manifest = JSON.parse(readText(fixture.root, path));
      manifest.version = "0.3.0";
      writeJson(fixture.root, path, manifest);
    }
    const releaseHeading = `## [0.3.0]\n\n<!-- Draft generated from first-parent history v0.2.0..${mainSha} (first-parent, exclusive of tag); release-base ${mainSha}. Review and curate before publication. -->\n\n### Changes\n\n- Synthetic manual candidate.`;
    writeText(
      fixture.root,
      "CHANGELOG.md",
      readText(fixture.root, "CHANGELOG.md").replace("## [0.2.0]", `${releaseHeading}\n\n## [0.2.0]`),
    );
    commit(fixture.root, "Manually created release candidate");
    git(fixture.root, ["push", "--set-upstream", "origin", manualBranch]);
    const updatedGithubState = JSON.parse(readFileSync(fixture.ghStatePath, "utf8"));
    updatedGithubState.pullRequests.push({
      number: 3,
      title: "[infra][chore] Prepare release v0.3.0",
      baseRefName: "main",
      headRefName: manualBranch,
      state: "OPEN",
      isDraft: false,
      url: "https://example.invalid/pull/3",
    });
    writeFileSync(fixture.ghStatePath, JSON.stringify(updatedGithubState));
    assert.throws(
      () => updateReleasePullRequest({ root: fixture.root }),
      /no release-preparation commit.*not created by a release command/,
    );
    assertReleaseChecksRun(fixture.pnpmLogPath, 3);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalStatePath === undefined) delete process.env.GH_TEST_STATE;
    else process.env.GH_TEST_STATE = originalStatePath;
    if (originalGateLogPath === undefined) delete process.env.PNPM_TEST_LOG;
    else process.env.PNPM_TEST_LOG = originalGateLogPath;
    if (originalCi === undefined) delete process.env.CI;
    else process.env.CI = originalCi;
    rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

function remoteBranchSha(root, branch) {
  return git(root, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split("\t")[0];
}

function assertReleaseChecksRun(path, expectedRuns) {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  for (const command of [
    "run test:release-process",
    "run verify:ci-policy",
    "run verify:version-alignment",
    "run format:check",
    "run test:full",
  ]) {
    assert.equal(
      lines.filter((line) => line === command).length,
      expectedRuns,
      `${command} should run ${expectedRuns} time(s)`,
    );
  }
}

function createRepositoryFixture() {
  const root = mkdtempSync(join(tmpdir(), "rhasia-release-cli-"));
  const bareRemote = join(root, "remote.git");
  const worktree = join(root, "repo");
  const binDirectory = join(root, "bin");
  const ghStatePath = join(root, "gh-state.json");
  const pnpmLogPath = join(root, "pnpm.log");
  mkdirSync(worktree, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });
  git(root, ["init", "--quiet", "--bare", bareRemote]);
  git(worktree, ["init", "--quiet", "--initial-branch=main"]);
  git(worktree, ["config", "user.name", "Release Test"]);
  git(worktree, ["config", "user.email", "release-test@example.invalid"]);

  for (const [path, name] of [
    ["package.json", "fixture-root"],
    ["apps/api/package.json", "@fixture/api"],
    ["apps/web/package.json", "@fixture/web"],
    ["packages/shared/package.json", "@fixture/shared"],
  ]) {
    writeJson(worktree, path, { name, version: initialVersion, private: true });
  }
  writeText(
    worktree,
    "CHANGELOG.md",
    "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Keep this synthetic unreleased note.\n\n## [0.2.0]\n\n### Changes\n\n- Previous release.\n",
  );
  commit(worktree, "synthetic release fixture baseline");
  git(worktree, ["tag", "v0.2.0"]);
  writeText(worktree, "baseline.txt", "synthetic release baseline\n");
  commit(worktree, "[infra] record synthetic release baseline");
  git(worktree, ["remote", "add", "origin", bareRemote]);
  git(worktree, ["push", "--set-upstream", "origin", "main", "--tags"]);
  git(worktree, ["fetch", "origin", "main", "--tags"]);
  writeJson(root, "gh-state.json", { pullRequests: [], nextNumber: 1 });
  writeExecutable(
    join(binDirectory, "pnpm"),
    '#!/bin/sh\nif [ "$1" = "--version" ]; then printf \'11.17.0\\n\'; exit 0; fi\nprintf \'%s\\n\' "$*" >> "$PNPM_TEST_LOG"\nexit 0\n',
  );
  writeExecutable(join(binDirectory, "gh"), fakeGitHubCli());
  return { root: worktree, fixtureRoot: root, binDirectory, ghStatePath, pnpmLogPath };
}

function fakeGitHubCli() {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const statePath = process.env.GH_TEST_STATE;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
const group = args[0];
const action = args[1];
const value = (flag) => args[args.indexOf(flag) + 1];
if (group === "auth" && action === "status") process.exit(0);
if (group === "release" && action === "list") { process.stdout.write("[]\\n"); process.exit(0); }
if (group === "pr" && action === "list") { process.stdout.write(JSON.stringify(state.pullRequests) + "\\n"); process.exit(0); }
if (group === "pr" && action === "create") {
  const pullRequest = { number: state.nextNumber++, title: value("--title"), baseRefName: value("--base"), headRefName: value("--head"), state: "OPEN", isDraft: false, url: "https://example.invalid/pull/1", body: value("--body") };
  state.pullRequests.push(pullRequest);
  fs.writeFileSync(statePath, JSON.stringify(state));
  process.stdout.write(pullRequest.url + "\\n");
  process.exit(0);
}
if (group === "pr" && action === "view") {
  const pullRequest = state.pullRequests.find((item) => item.headRefName === args[2]);
  if (!pullRequest) process.exit(1);
  process.stdout.write(JSON.stringify(pullRequest) + "\\n");
  process.exit(0);
}
if (group === "pr" && action === "edit") {
  const pullRequest = state.pullRequests.find((item) => String(item.number) === args[2]);
  if (!pullRequest) process.exit(1);
  pullRequest.body = value("--body");
  fs.writeFileSync(statePath, JSON.stringify(state));
  process.exit(0);
}
process.stderr.write("Unsupported synthetic gh invocation.\\n");
process.exit(2);
`;
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function commit(root, message) {
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-s", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function writeJson(root, path, value) {
  writeText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(root, path, contents) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function readText(root, path) {
  return readFileSync(join(root, path), "utf8");
}
