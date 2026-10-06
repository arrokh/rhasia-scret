import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareSemVer, isStableSemVer, isValidSemVer } from "./release-version.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const initialReleaseVersion = "0.1.0";

export function validateReleaseVersion(version, tags, existingTag = undefined) {
  if (!isStableSemVer(version))
    throw new Error(`Repository publication requires a stable X.Y.Z version; received ${String(version)}.`);
  const invalidTags = tags.filter(
    (tag) => tag.startsWith("v") && (!/^v\d+\.\d+\.\d+$/.test(tag) || !isValidSemVer(tag.slice(1))),
  );
  if (invalidTags.length > 0) throw new Error(`Found malformed release tags: ${invalidTags.join(", ")}.`);
  const releaseVersions = tags.filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag)).map((tag) => tag.slice(1));
  if (releaseVersions.length === 0) {
    if (version !== initialReleaseVersion) {
      throw new Error(`The inaugural repository release must be v${initialReleaseVersion}; received v${version}.`);
    }
    return { tag: `v${version}`, latestTag: null };
  }

  const sortedVersions = releaseVersions.sort(compareSemVer);
  const latestVersion = sortedVersions.at(-1);
  const matchingTag = `v${version}`;
  if (releaseVersions.includes(version)) {
    if (latestVersion !== version) throw new Error(`Release tag v${version} is not the latest repository release tag.`);
    if (!existingTag)
      throw new Error(`Release tag ${matchingTag} already exists; exact-source retry verification is required.`);
    existingTagAction({ tag: matchingTag, ...existingTag });
    return { tag: matchingTag, latestTag: matchingTag };
  }
  if (compareSemVer(version, latestVersion) <= 0) {
    throw new Error(`Release version v${version} must advance beyond latest tag v${latestVersion}.`);
  }
  return { tag: matchingTag, latestTag: `v${latestVersion}` };
}

export function extractReleaseNotes(changelog, version, sourceSha) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha))
    throw new Error("Release source SHA must be a full 40-character lowercase commit hash.");
  const heading = `## [${version}]`;
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) throw new Error(`CHANGELOG.md is missing the reviewed ${heading} release section.`);
  const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  const section = lines.slice(start + 1, end < 0 ? lines.length : end);
  const body = section
    .join("\n")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .trim();
  if (!body || !/^###\s+\S/m.test(body)) throw new Error(`${heading} must contain reviewed release notes.`);
  const dockerImageNotes = [
    "### Docker Hub images",
    "",
    `- Web/PWA: [arrokh/rhasia-scret](https://hub.docker.com/r/arrokh/rhasia-scret) — \`docker pull arrokh/rhasia-scret:v${version}\``,
    `- API: [arrokh/rhasia-scret-api](https://hub.docker.com/r/arrokh/rhasia-scret-api) — \`docker pull arrokh/rhasia-scret-api:v${version}\``,
    `- One-off API migration: [arrokh/rhasia-scret-api-migrate](https://hub.docker.com/r/arrokh/rhasia-scret-api-migrate) — \`docker pull arrokh/rhasia-scret-api-migrate:v${version}\``,
  ].join("\n");
  return `${body}\n\n---\nSource commit: ${sourceSha}\n\n${dockerImageNotes}\n`;
}

export function existingTagAction({ tag, sourceSha, existingTargetSha, annotated }) {
  if (!existingTargetSha) return "create";
  if (existingTargetSha !== sourceSha) {
    throw new Error(`${tag} already points to ${existingTargetSha}, not tested source commit ${sourceSha}.`);
  }
  if (!annotated) throw new Error(`${tag} already exists as a lightweight tag; refusing to replace it.`);
  return "reuse";
}

export function inspectReleaseCandidate({ root = repositoryRoot, sourceSha }) {
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const version = packageJson.version;
  const tags = git(["tag", "--list", "v*"], root).split("\n").filter(Boolean);
  const matchingTag = `v${version}`;
  const existingTag = tags.includes(matchingTag)
    ? {
        sourceSha,
        existingTargetSha: git(["rev-parse", `${matchingTag}^{commit}`], root),
        annotated: git(["cat-file", "-t", matchingTag], root) === "tag",
      }
    : undefined;
  const release = validateReleaseVersion(version, tags, existingTag);
  const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
  const notes = extractReleaseNotes(changelog, version, sourceSha);
  return { version, tag: release.tag, latestTag: release.latestTag, sourceSha, notes };
}

function git(args, root) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function parseArguments(args) {
  let sourceSha;
  let notesFile;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--sha") {
      sourceSha = args[index + 1];
      index += 1;
      continue;
    }
    if (args[index] === "--notes-file") {
      notesFile = args[index + 1];
      index += 1;
      continue;
    }
    if (args[index] === "--help") {
      console.log("Usage: node tools/release-publication.mjs --sha <full-commit-sha> [--notes-file path]");
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (!sourceSha) throw new Error("--sha requires the full tested source commit SHA.");
  return { sourceSha, notesFile };
}

function main() {
  const { sourceSha, notesFile } = parseArguments(process.argv.slice(2));
  const candidate = inspectReleaseCandidate({ sourceSha });
  if (notesFile) writeFileSync(resolve(notesFile), candidate.notes);
  console.log(JSON.stringify({ ...candidate, notes: undefined, notesFile }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
