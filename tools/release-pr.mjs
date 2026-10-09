import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareRelease, releaseTags, selectTargetVersion } from "./prepare-release.mjs";
import { releasePullRequestMetadata } from "./release-pr-metadata.mjs";
import { verifyReleaseCommit } from "./verify-release-pr-changes.mjs";
import { verifyVersionAlignment } from "./verify-version-alignment.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const requiredNodeVersion = "v24.19.0";
const requiredPnpmVersion = "11.17.0";

export function parseReleasePrArguments(args) {
  if (args.length !== 1 || !["patch", "minor", "major"].includes(args[0])) {
    throw new Error("Usage: pnpm release:patch | pnpm release:minor | pnpm release:major");
  }
  return { bump: args[0] };
}

export function releaseBranchName(version) {
  return `infra/chore/prepare-release-v${version}`;
}

export function createReleasePullRequest({ root = repositoryRoot, bump } = {}) {
  if (!["patch", "minor", "major"].includes(bump)) {
    throw new Error("Choose one explicit release bump: patch, minor, or major.");
  }
  assertToolchain(root);
  assertRepositoryRoot(root);
  assertCurrentBranch(root, "main");
  assertCleanWorktree(root);

  run("git", ["fetch", "origin", "main", "--tags"], root);
  const headSha = git(["rev-parse", "HEAD"], root);
  const mainSha = git(["rev-parse", "refs/remotes/origin/main"], root);
  if (headSha !== mainSha) {
    throw new Error("Update local main to exactly match origin/main before creating a release PR.");
  }

  run("gh", ["auth", "status"], root);
  const rootManifest = readJson(root, "package.json");
  const tags = releaseTags(root);
  const targetVersion = selectTargetVersion(rootManifest.version, bump, tags, tags.length === 0);
  const tag = `v${targetVersion}`;
  const branch = releaseBranchName(targetVersion);
  const title = `[infra][chore] Prepare release ${tag}`;

  assertBranchDoesNotExist(root, branch);
  assertCandidateDoesNotExist(root, { branch, tag, title });

  const result = prepareRelease({ root, bump });
  if (result.targetVersion !== targetVersion) {
    throw new Error(`Prepared version ${result.targetVersion} does not match expected candidate ${targetVersion}.`);
  }

  // Move the generated changes off main before running checks or staging files.
  run("git", ["switch", "--create", branch], root);
  assertReleasePaths(result.changedPaths);
  assertVersionAlignment(root);
  run("git", ["diff", "--check"], root);
  stageReleaseFiles(root, result.changedPaths);
  run("git", ["commit", "-s", "-m", title], root);

  const sourceSha = git(["rev-parse", "HEAD"], root);
  verifyReleaseCommit({ root, version: targetVersion, sourceSha, baseSha: result.baseSha });
  runReleaseChecks(root);
  assertCleanWorktree(root);

  run("git", ["push", "--set-upstream", "origin", branch], root);
  run(
    "gh",
    [
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      title,
      "--body",
      releasePullRequestMetadata({
        version: targetVersion,
        baseSha: result.baseSha,
        sourceSha,
      }),
    ],
    root,
  );

  const pullRequest = readPullRequest(root, branch);
  assertPullRequest(pullRequest, { branch, title });
  return { version: targetVersion, branch, baseSha: result.baseSha, sourceSha, pullRequest };
}

function assertToolchain(root) {
  if (process.env.CI === "true") {
    throw new Error("Release commands must run locally; CI would route the complete gate to a hosted database.");
  }
  if (process.version !== requiredNodeVersion) {
    throw new Error(`Release commands require Node.js ${requiredNodeVersion}; found ${process.version}.`);
  }
  const actualPnpmVersion = capture("pnpm", ["--version"], root);
  if (actualPnpmVersion !== requiredPnpmVersion) {
    throw new Error(`Release commands require pnpm ${requiredPnpmVersion}; found ${actualPnpmVersion}.`);
  }
}

function assertRepositoryRoot(root) {
  const topLevel = realpathSync(capture("git", ["rev-parse", "--show-toplevel"], root));
  if (topLevel !== realpathSync(root)) throw new Error("Run release commands from the repository root.");
}

function assertCurrentBranch(root, expected) {
  const branch = git(["branch", "--show-current"], root);
  if (branch !== expected)
    throw new Error(`Release creation requires ${expected}; current branch is ${branch || "detached"}.`);
}

function assertCleanWorktree(root) {
  const status = git(["status", "--porcelain", "--untracked-files=all"], root);
  if (status !== "")
    throw new Error("Release commands require a clean worktree, including no staged or untracked files.");
}

function assertBranchDoesNotExist(root, branch) {
  if (git(["branch", "--list", branch], root) !== "") {
    throw new Error(`Release branch ${branch} already exists locally; refusing to overwrite it.`);
  }
  if (capture("git", ["ls-remote", "--heads", "origin", `refs/heads/${branch}`], root) !== "") {
    throw new Error(`Release branch ${branch} already exists on origin; refusing to overwrite it.`);
  }
}

function assertCandidateDoesNotExist(root, { branch, tag, title }) {
  const existingPullRequests = JSON.parse(
    capture("gh", ["pr", "list", "--state", "all", "--base", "main", "--json", "number,title,headRefName,url"], root),
  );
  const matchingPullRequest = existingPullRequests.find(
    (pullRequest) => pullRequest.title === title || pullRequest.headRefName === branch,
  );
  if (matchingPullRequest) {
    throw new Error(`Release PR already exists: ${matchingPullRequest.url ?? `#${matchingPullRequest.number}`}.`);
  }

  const existingReleases = JSON.parse(capture("gh", ["release", "list", "--limit", "1000", "--json", "tagName"], root));
  if (existingReleases.some((release) => release.tagName === tag) || git(["tag", "--list", tag], root) === tag) {
    throw new Error(`Release ${tag} already exists; refusing to prepare a duplicate candidate.`);
  }
}

function assertReleasePaths(paths) {
  if (!paths.includes("CHANGELOG.md")) throw new Error("Release preparation must update CHANGELOG.md.");
  const invalidPaths = paths.filter(
    (path) =>
      path !== "CHANGELOG.md" &&
      !/^(?:package\.json|apps\/[^/]+\/package\.json|packages\/[^/]+\/package\.json)$/.test(path),
  );
  if (invalidPaths.length > 0)
    throw new Error(`Release preparation changed out-of-scope paths: ${invalidPaths.join(", ")}.`);
}

function assertVersionAlignment(root) {
  const alignment = verifyVersionAlignment(root);
  if (!alignment.valid) throw new Error(`Release package versions are not aligned:\n${alignment.failures.join("\n")}`);
}

function stageReleaseFiles(root, paths) {
  run("git", ["add", "--", ...paths], root);
  const stagedPaths = git(["diff", "--cached", "--name-only"], root).split("\n").filter(Boolean);
  const expectedPaths = [...paths].sort();
  if (JSON.stringify(stagedPaths.sort()) !== JSON.stringify(expectedPaths)) {
    throw new Error(`Staged release paths differ from the reviewed set: ${stagedPaths.join(", ")}.`);
  }
  run("git", ["diff", "--cached", "--check"], root);
}

function runReleaseChecks(root) {
  run("pnpm", ["run", "test:release-process"], root);
  run("pnpm", ["run", "verify:ci-policy"], root);
  run("pnpm", ["run", "verify:version-alignment"], root);
  run("pnpm", ["run", "format:check"], root);
  run("pnpm", ["run", "test:full"], root);
}

function readPullRequest(root, branch) {
  const source = capture(
    "gh",
    ["pr", "view", branch, "--json", "number,title,baseRefName,headRefName,isDraft,url,body"],
    root,
  );
  return JSON.parse(source);
}

function assertPullRequest(pullRequest, { branch, title }) {
  if (pullRequest.title !== title || pullRequest.baseRefName !== "main" || pullRequest.headRefName !== branch) {
    throw new Error("Created PR does not match the required release title, branch, or main base.");
  }
  if (pullRequest.isDraft) throw new Error("Release PR was unexpectedly created as a draft.");
}

function readJson(root, path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function capture(command, args, root) {
  try {
    return execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  } catch (error) {
    throw new Error(`${command} ${args.join(" ")} failed.`, { cause: error });
  }
}

function run(command, args, root) {
  try {
    execFileSync(command, args, { cwd: root, stdio: "inherit" });
  } catch (error) {
    throw new Error(`${command} ${args.join(" ")} failed.`, { cause: error });
  }
}

function git(args, root) {
  return capture("git", args, root);
}

function main() {
  const { bump } = parseReleasePrArguments(process.argv.slice(2));
  const result = createReleasePullRequest({ bump });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
