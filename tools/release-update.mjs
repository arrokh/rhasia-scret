import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseTags } from "./prepare-release.mjs";
import {
  assertReleasePullRequestBodyManaged,
  releasePullRequestMetadata,
  updateReleasePullRequestBody,
} from "./release-pr-metadata.mjs";
import { bumpSemVer, compareSemVer, isStableSemVer } from "./release-version.mjs";
import { verifyReleaseCommit } from "./verify-release-pr-changes.mjs";
import { verifyVersionAlignment } from "./verify-version-alignment.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const requiredNodeVersion = "v24.19.0";
const requiredPnpmVersion = "11.17.0";

export function refreshReleaseChangelog({ changelog, version, mainSha, newSubjects }) {
  if (!isStableSemVer(version)) throw new Error("Release changelog version must be stable SemVer.");
  if (!/^[0-9a-f]{40}$/.test(mainSha)) throw new Error("Release update requires a full origin/main commit SHA.");

  const lines = changelog.split("\n");
  const releaseHeading = `## [${version}]`;
  const releaseStart = lines.findIndex((line) => line.trim() === releaseHeading);
  if (releaseStart < 0) throw new Error(`CHANGELOG.md is missing ${releaseHeading}.`);
  const nextRelease = lines.findIndex((line, index) => index > releaseStart && /^##\s/.test(line));
  const releaseEnd = nextRelease < 0 ? lines.length : nextRelease;
  const markerPattern =
    /^<!-- Draft generated from first-parent history .*; release-base ([0-9a-f]{40})\. Review and curate before publication\. -->$/;
  const markerIndex = lines.findIndex(
    (line, index) => index > releaseStart && index < releaseEnd && markerPattern.test(line),
  );
  if (markerIndex < 0)
    throw new Error(`${releaseHeading} is missing its release update marker; refusing to rewrite curated notes.`);
  const previousMainSha = lines[markerIndex].match(markerPattern)?.[1];
  if (!previousMainSha) throw new Error("Could not read the previous release changelog baseline.");
  if (previousMainSha === mainSha) return { changelog, previousMainSha, mainSha, appendedSubjects: [], changed: false };

  const changesHeading = lines.findIndex(
    (line, index) => index > markerIndex && index < releaseEnd && line.trim() === "### Changes",
  );
  if (changesHeading < 0)
    throw new Error(`${releaseHeading} is missing its ### Changes section; refusing to rewrite curated notes.`);
  const changesEnd = lines.findIndex(
    (line, index) => index > changesHeading && index < releaseEnd && /^#{2,3}\s/.test(line),
  );
  const sectionEnd = changesEnd < 0 ? releaseEnd : changesEnd;
  const existingLines = new Set(lines.slice(changesHeading + 1, sectionEnd).map((line) => line.trim()));
  const appendedSubjects = [];
  for (const subject of newSubjects) {
    if (typeof subject !== "string" || subject.length === 0 || /[\r\n]/.test(subject)) {
      throw new Error("Release update received an invalid first-parent commit subject.");
    }
    if (existingLines.has(`- ${subject}`)) continue;
    existingLines.add(`- ${subject}`);
    appendedSubjects.push(subject);
  }

  const markerPrefix = lines[markerIndex].split("; release-base ")[0];
  const refreshedRange = markerPrefix.replace(/(\.\.|through )([0-9a-f]{40})/, `$1${mainSha}`);
  if (refreshedRange === markerPrefix) throw new Error("Could not refresh the changelog's generated-history range.");
  lines[markerIndex] = `${refreshedRange}; release-base ${mainSha}. Review and curate before publication. -->`;
  if (appendedSubjects.length > 0) {
    let insertionIndex = sectionEnd;
    while (insertionIndex > changesHeading + 1 && lines[insertionIndex - 1] === "") insertionIndex -= 1;
    lines.splice(insertionIndex, 0, ...appendedSubjects.map((subject) => `- ${subject}`));
  }
  return {
    changelog: lines.join("\n"),
    previousMainSha,
    mainSha,
    appendedSubjects,
    changed: true,
  };
}

export function parseReleaseUpdateArguments(args) {
  if (args.length > 0) throw new Error("Usage: pnpm release:update");
  return {};
}

export function updateReleasePullRequest({ root = repositoryRoot } = {}) {
  assertToolchain(root);
  assertRepositoryRoot(root);
  const branch = git(["branch", "--show-current"], root);
  if (!branch || branch === "main") {
    throw new Error("Release update requires a non-main release branch.");
  }
  assertCleanWorktree(root);

  const candidateVersion = branch.match(
    /^infra\/chore\/prepare-release-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/,
  )?.[1];
  if (!candidateVersion) {
    throw new Error("Release update is limited to branches named infra/chore/prepare-release-vX.Y.Z.");
  }

  run("git", ["fetch", "origin", "main", "--tags"], root);
  synchronizeLocalReleaseBranch(root, branch);
  const mainSha = git(["rev-parse", "refs/remotes/origin/main"], root);
  const branchTitle = `[infra][chore] Prepare release v${candidateVersion}`;
  const rootVersion = readJson(root, "package.json").version;
  if (rootVersion !== candidateVersion) {
    throw new Error(`Release branch version ${rootVersion} does not match its branch candidate ${candidateVersion}.`);
  }
  assertCandidateStillCurrent(root, { candidateVersion, mainSha });
  const candidatePullRequest = assertReleaseBranchOrigin(root, { branch, candidateVersion, branchTitle });
  if (candidatePullRequest) {
    const currentPullRequest = readPullRequest(root, branch);
    assertPullRequest(currentPullRequest, { branch, title: branchTitle });
    assertReleasePullRequestBodyManaged(currentPullRequest.body ?? "");
  }

  const changelogPath = resolve(root, "CHANGELOG.md");
  const changelog = readFileSync(changelogPath, "utf8");
  const marker = changelog.match(
    /^<!-- Draft generated from first-parent history .*; release-base ([0-9a-f]{40})\. Review and curate before publication\. -->$/m,
  );
  const previousMainSha = marker?.[1];
  if (!previousMainSha) throw new Error("Release candidate changelog has no valid release update marker.");
  assertAncestor(root, previousMainSha, mainSha);

  const newSubjects =
    previousMainSha === mainSha
      ? []
      : git(["log", "--first-parent", "--reverse", "--format=%s", `${previousMainSha}..${mainSha}`], root)
          .split("\n")
          .filter(Boolean);

  run("git", ["merge", "--no-edit", "origin/main"], root);
  const mergedChangelog = readFileSync(changelogPath, "utf8");
  const refreshed = refreshReleaseChangelog({
    changelog: mergedChangelog,
    version: candidateVersion,
    mainSha,
    newSubjects,
  });
  if (refreshed.changed) {
    writeFileSync(changelogPath, refreshed.changelog);
    assertOnlyChangelogChanged(root);
    run("git", ["add", "--", "CHANGELOG.md"], root);
    run("git", ["diff", "--cached", "--check"], root);
    run("git", ["commit", "-s", "-m", `[infra][chore] Update release v${candidateVersion}`], root);
  }

  assertVersionAlignment(root);
  const sourceSha = git(["rev-parse", "HEAD"], root);
  verifyReleaseCommit({ root, version: candidateVersion, sourceSha, baseSha: mainSha });
  runReleaseChecks(root);
  assertCleanWorktree(root);

  run("git", ["push", "--set-upstream", "origin", branch], root);
  const pullRequest = findPullRequest(root, branch, branchTitle);
  if (!pullRequest) {
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
        branchTitle,
        "--body",
        releasePullRequestMetadata({
          version: candidateVersion,
          baseSha: mainSha,
          sourceSha,
          appendedSubjects: refreshed.appendedSubjects,
        }),
      ],
      root,
    );
  } else {
    const currentPullRequest = readPullRequest(root, branch);
    assertPullRequest(currentPullRequest, { branch, title: branchTitle });
    const updatedBody = updateReleasePullRequestBody(currentPullRequest.body ?? "", {
      version: candidateVersion,
      baseSha: mainSha,
      sourceSha,
      appendedSubjects: refreshed.appendedSubjects,
    });
    run("gh", ["pr", "edit", String(currentPullRequest.number), "--body", updatedBody], root);
  }

  const updatedPullRequest = readPullRequest(root, branch);
  assertPullRequest(updatedPullRequest, { branch, title: branchTitle });
  return {
    version: candidateVersion,
    branch,
    previousMainSha: refreshed.previousMainSha,
    mainSha,
    appendedSubjects: refreshed.appendedSubjects,
    sourceSha,
    pullRequest: updatedPullRequest,
  };
}

function assertCandidateStillCurrent(root, { candidateVersion, mainSha }) {
  const mainManifest = JSON.parse(git(["show", `${mainSha}:package.json`], root));
  const mainVersion = mainManifest.version;
  const tags = releaseTags(root);
  const latestVersion = tags.at(-1)?.slice(1) ?? "0.1.0";
  if (mainVersion !== latestVersion) {
    throw new Error(
      `origin/main version ${mainVersion} does not match latest release ${latestVersion}; refresh is unsafe.`,
    );
  }
  const validNextVersions = ["patch", "minor", "major"].map((bump) => bumpSemVer(latestVersion, bump));
  if (!validNextVersions.includes(candidateVersion)) {
    throw new Error(
      `Candidate v${candidateVersion} is not a single SemVer bump from current release v${latestVersion}.`,
    );
  }
  if (compareSemVer(candidateVersion, latestVersion) <= 0) {
    throw new Error(`Candidate v${candidateVersion} must advance beyond current release v${latestVersion}.`);
  }
  if (git(["tag", "--list", `v${candidateVersion}`], root) === `v${candidateVersion}`) {
    throw new Error(`Candidate tag v${candidateVersion} already exists; refusing to update a published release.`);
  }
}

function assertReleaseBranchOrigin(root, { branch, candidateVersion, branchTitle }) {
  const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
  if (!changelog.includes(`## [${candidateVersion}]`)) {
    throw new Error("This branch has no release changelog section; run a release command to create its candidate.");
  }
  const commits = git(["log", "--format=%s", "origin/main..HEAD"], root).split("\n").filter(Boolean);
  if (!commits.includes(branchTitle)) {
    throw new Error(`Branch ${branch} has no release-preparation commit; it was not created by a release command.`);
  }
  const pullRequests = JSON.parse(
    capture(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "all",
        "--head",
        branch,
        "--json",
        "number,title,baseRefName,headRefName,state,isDraft,url",
      ],
      root,
    ),
  );
  const titleMatch = pullRequests.find((pullRequest) => pullRequest.title === branchTitle);
  const otherCandidate = JSON.parse(
    capture("gh", ["pr", "list", "--state", "all", "--base", "main", "--json", "number,title,headRefName,url"], root),
  ).find((pullRequest) => pullRequest.title === branchTitle && pullRequest.headRefName !== branch);
  if (otherCandidate) throw new Error(`Candidate PR already exists on another branch: ${otherCandidate.url}.`);
  if (pullRequests.length > 1)
    throw new Error(`Multiple PRs target release branch ${branch}; refusing an ambiguous update.`);
  if (titleMatch) {
    if (
      titleMatch.baseRefName !== "main" ||
      titleMatch.headRefName !== branch ||
      titleMatch.state !== "OPEN" ||
      titleMatch.isDraft
    ) {
      throw new Error("Release update requires the matching non-draft release PR to be open and based on main.");
    }
    return titleMatch;
  }
  if (pullRequests.length > 0) {
    throw new Error("This branch has a pull request, but its title does not match the release candidate.");
  }
  return undefined;
}

function findPullRequest(root, branch, title) {
  const prs = JSON.parse(
    capture(
      "gh",
      ["pr", "list", "--state", "all", "--head", branch, "--json", "number,title,baseRefName,headRefName,state,url"],
      root,
    ),
  );
  if (prs.length === 0) return undefined;
  if (prs.length !== 1 || prs[0].title !== title || prs[0].baseRefName !== "main" || prs[0].state !== "OPEN") {
    throw new Error("Release branch PR changed or no longer matches the expected open release candidate.");
  }
  return prs[0];
}

function synchronizeLocalReleaseBranch(root, branch) {
  const remoteBranch = capture("git", ["ls-remote", "--heads", "origin", `refs/heads/${branch}`], root);
  if (!remoteBranch) return;
  run("git", ["fetch", "origin", `refs/heads/${branch}:refs/remotes/origin/${branch}`], root);
  const localSha = git(["rev-parse", "HEAD"], root);
  const remoteSha = git(["rev-parse", `refs/remotes/origin/${branch}`], root);
  if (localSha === remoteSha || isAncestor(root, remoteSha, localSha)) return;
  if (!isAncestor(root, localSha, remoteSha)) {
    throw new Error("Local release branch and origin branch have diverged; resolve the branch without force-pushing.");
  }
  run("git", ["merge", "--ff-only", `refs/remotes/origin/${branch}`], root);
}

function assertAncestor(root, ancestor, descendant) {
  if (!isAncestor(root, ancestor, descendant)) {
    throw new Error(
      "The recorded release baseline is not an ancestor of origin/main; refusing to rewrite the changelog.",
    );
  }
}

function isAncestor(root, ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function assertOnlyChangelogChanged(root) {
  const changedPaths = [
    ...git(["diff", "--name-only"], root).split("\n"),
    ...git(["diff", "--cached", "--name-only"], root).split("\n"),
    ...git(["ls-files", "--others", "--exclude-standard"], root).split("\n"),
  ].filter(Boolean);
  const invalidPaths = changedPaths.filter((path) => path !== "CHANGELOG.md");
  if (invalidPaths.length > 0) throw new Error(`Release update changed unexpected paths: ${invalidPaths.join(", ")}.`);
}

function assertVersionAlignment(root) {
  const alignment = verifyVersionAlignment(root);
  if (!alignment.valid) throw new Error(`Release package versions are not aligned:\n${alignment.failures.join("\n")}`);
}

function runReleaseChecks(root) {
  run("pnpm", ["run", "test:release-process"], root);
  run("pnpm", ["run", "verify:ci-policy"], root);
  run("pnpm", ["run", "verify:version-alignment"], root);
  run("pnpm", ["run", "format:check"], root);
  run("pnpm", ["run", "test:full"], root);
}

function readPullRequest(root, branch) {
  return JSON.parse(
    capture("gh", ["pr", "view", branch, "--json", "number,title,baseRefName,headRefName,isDraft,url,body"], root),
  );
}

function assertPullRequest(pullRequest, { branch, title }) {
  if (pullRequest.title !== title || pullRequest.baseRefName !== "main" || pullRequest.headRefName !== branch) {
    throw new Error("Release PR does not match the required title, branch, or main base.");
  }
  if (pullRequest.isDraft) throw new Error("Release update requires a non-draft release PR.");
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

function assertCleanWorktree(root) {
  if (git(["status", "--porcelain", "--untracked-files=all"], root) !== "") {
    throw new Error("Release update requires a clean worktree; commit or resolve local changes first.");
  }
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
  parseReleaseUpdateArguments(process.argv.slice(2));
  const result = updateReleasePullRequest();
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
