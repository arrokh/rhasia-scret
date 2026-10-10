import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { isValidSemVer, bumpSemVer, compareSemVer } from "./release-version.mjs";
import { versionedPackageFiles, verifyVersionAlignment } from "./verify-version-alignment.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const initialCommit = "d067b7efafa4bcddb2955f682e14b83bef9ed01d";

export function prepareRelease({ root = repositoryRoot, bump, initialCommitSha = initialCommit } = {}) {
  const baseSha = requireCurrentMain(root);
  const packageJson = readJson(root, "package.json");
  const currentVersion = packageJson.version;
  if (typeof currentVersion !== "string" || !isValidSemVer(currentVersion)) {
    throw new Error("The root package version must be valid SemVer before release preparation.");
  }

  const alignment = verifyVersionAlignment(root);
  if (!alignment.valid) {
    throw new Error(`Release preparation requires aligned package versions:\n${alignment.failures.join("\n")}`);
  }

  const tags = releaseTags(root);
  const bootstrap = tags.length === 0;
  const targetVersion = selectTargetVersion(currentVersion, bump, tags, bootstrap);
  const changelogPath = "CHANGELOG.md";
  const changelog = readText(root, changelogPath);
  const draft = createChangelogDraft({ root, baseSha, targetVersion, tags, bootstrap, initialCommitSha, changelog });
  const packageUpdates = versionedPackageFiles(root).map((path) => [
    path,
    updateJsonVersion(readText(root, path), path, targetVersion),
  ]);
  const changes = new Map([...packageUpdates, [changelogPath, draft]]);
  const originalContents = new Map(
    [...changes.keys()].map((path) => [path, existsSync(resolve(root, path)) ? readText(root, path) : undefined]),
  );
  const changedPaths = [...changes]
    .filter(([path, contents]) => originalContents.get(path) !== contents)
    .map(([path]) => path);

  for (const [path, contents] of changes) writeFileSync(resolve(root, path), contents);

  const updatedAlignment = verifyVersionAlignment(root);
  if (!updatedAlignment.valid) {
    throw new Error(`Release preparation produced misaligned versions:\n${updatedAlignment.failures.join("\n")}`);
  }

  const start = bootstrap
    ? `first-parent history beginning at ${initialCommitSha} (inclusive) through ${baseSha}`
    : `${tags.at(-1)}..${baseSha} (first-parent, exclusive of tag)`;
  return {
    baseSha,
    currentVersion,
    targetVersion,
    range: start,
    changedPaths,
  };
}

export function selectTargetVersion(currentVersion, bump, tags, bootstrap = tags.length === 0) {
  if (bootstrap) {
    if (bump !== undefined) throw new Error("The first release uses the existing version; do not specify a bump.");
    if (currentVersion !== "0.1.0")
      throw new Error("The first repository release must use the existing 0.1.0 version.");
    if (tags.length > 0) throw new Error("Bootstrap release preparation requires no prior v* release tags.");
    return currentVersion;
  }

  if (bump !== "patch" && bump !== "minor" && bump !== "major") {
    throw new Error("After the first release, specify exactly one of: patch, minor, major.");
  }
  const latestVersion = tags.at(-1)?.slice(1);
  if (!latestVersion || !isValidSemVer(latestVersion) || currentVersion !== latestVersion) {
    throw new Error(
      "The root package version must match the latest published vX.Y.Z tag before preparing another release.",
    );
  }
  return bumpSemVer(currentVersion, bump);
}

function requireCurrentMain(root) {
  const branch = git(["branch", "--show-current"], root);
  if (branch !== "main")
    throw new Error(`Release preparation requires the main branch; current branch is ${branch || "detached"}.`);
  const status = git(["status", "--porcelain", "--untracked-files=all"], root);
  if (status !== "")
    throw new Error("Release preparation requires a clean working tree, including no staged or untracked files.");
  const head = git(["rev-parse", "HEAD"], root);
  const originMain = git(["rev-parse", "refs/remotes/origin/main"], root, { allowFailure: true });
  if (!originMain || head !== originMain) {
    throw new Error(
      "Update origin/main locally before preparing a release; this command does not fetch or contact remotes.",
    );
  }
  return head;
}

export function releaseTags(root = repositoryRoot) {
  const tags = git(["tag", "--list", "v*"], root)
    .split("\n")
    .filter(Boolean)
    .sort((left, right) => {
      if (!left.startsWith("v") || !right.startsWith("v")) return left.localeCompare(right);
      if (!isValidSemVer(left.slice(1))) return left.localeCompare(right);
      if (!isValidSemVer(right.slice(1))) return left.localeCompare(right);
      return compareSemVer(left.slice(1), right.slice(1));
    });
  const malformedTags = tags.filter((tag) => !/^v\d+\.\d+\.\d+$/.test(tag) || !isValidSemVer(tag.slice(1)));
  if (malformedTags.length > 0)
    throw new Error(`Found non-release tags in the reserved v* namespace: ${malformedTags.join(", ")}.`);
  return tags;
}

function createChangelogDraft({ root, baseSha, targetVersion, tags, bootstrap, initialCommitSha, changelog }) {
  const heading = `## [${targetVersion}]`;
  if (changelog.split("\n").some((line) => line.trim() === heading)) {
    throw new Error(`CHANGELOG.md already contains a ${heading} section.`);
  }
  const unreleasedHeading = "## [Unreleased]";
  const unreleasedOffset = changelog.indexOf(unreleasedHeading);
  if (unreleasedOffset < 0) throw new Error("CHANGELOG.md must retain an ## [Unreleased] section.");

  const afterUnreleased = changelog.slice(unreleasedOffset + unreleasedHeading.length);
  const followingSectionOffset = afterUnreleased.search(/^## \[/m);
  const insertionOffset =
    followingSectionOffset < 0
      ? changelog.length
      : unreleasedOffset + unreleasedHeading.length + followingSectionOffset;
  const history = commitSubjects(root, baseSha, tags.at(-1), bootstrap, initialCommitSha);
  if (history.subjects.length === 0)
    throw new Error("No first-parent commit subjects were found for the changelog draft.");
  const range = bootstrap
    ? `first-parent history beginning at ${initialCommitSha} (inclusive) through ${baseSha}`
    : `${tags.at(-1)}..${baseSha} (first-parent, exclusive of tag)`;
  const section = [
    heading,
    "",
    `<!-- Draft generated from first-parent history ${range}; release-base ${baseSha}. Review and curate before publication. -->`,
    "",
    "### Changes",
    ...history.subjects.map((subject) => `- ${subject}`),
    "",
  ].join("\n");
  const prefix = changelog.slice(0, insertionOffset);
  const suffix = changelog.slice(insertionOffset);
  const separator = prefix.endsWith("\n\n") ? "" : prefix.endsWith("\n") ? "\n" : "\n\n";
  return `${prefix}${separator}${section}${suffix}`;
}

function commitSubjects(root, baseSha, latestTag, bootstrap, initialCommitSha) {
  if (!bootstrap) {
    const output = git(["log", "--first-parent", "--reverse", "--format=%s", `${latestTag}..${baseSha}`], root);
    return { subjects: output.split("\n").filter(Boolean) };
  }

  const log = git(["log", "--first-parent", "--reverse", "--format=%H%x00%s", baseSha], root);
  const entries = log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("\0");
      return { sha: line.slice(0, separator), subject: line.slice(separator + 1) };
    });
  const initialIndex = entries.findIndex(({ sha }) => sha === initialCommitSha || sha.startsWith(initialCommitSha));
  if (initialIndex < 0) throw new Error(`Initial commit ${initialCommitSha} is not on main's first-parent history.`);
  return { subjects: entries.slice(initialIndex).map(({ subject }) => subject) };
}

function updateJsonVersion(source, path, version) {
  const parsed = JSON.parse(source);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.version !== "string") {
    throw new Error(`${path} must contain a top-level version string.`);
  }
  const matcher = /^( {2}"version"\s*:\s*")[^"]+("\s*,?\s*)$/m;
  const matches = [...source.matchAll(/^ {2}"version"\s*:\s*"[^"]+"\s*,?\s*$/gm)];
  if (matches.length !== 1) throw new Error(`${path} must have exactly one top-level version field.`);
  const updated = source.replace(matcher, (_, prefix, suffix) => `${prefix}${version}${suffix}`);
  if (updated === source && parsed.version !== version)
    throw new Error(`Could not update the top-level version field in ${path}.`);
  return updated;
}

function readJson(root, path) {
  return JSON.parse(readText(root, path));
}

function readText(root, path) {
  return readFileSync(resolve(root, path), "utf8");
}

function git(args, root, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
  } catch (error) {
    if (allowFailure) return "";
    throw new Error(`git ${args.join(" ")} failed while preparing release.`, { cause: error });
  }
}
