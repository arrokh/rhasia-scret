import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isStableSemVer } from "./release-version.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

export function verifyReleaseCommit({ root = repositoryRoot, version, sourceSha, baseSha = undefined }) {
  if (!isStableSemVer(version))
    throw new Error(`Release commit requires a stable SemVer version; received ${String(version)}.`);
  if (!/^[0-9a-f]{40}$/.test(sourceSha))
    throw new Error("Release source must be a full 40-character lowercase commit SHA.");
  const firstParent = git(["rev-parse", `${sourceSha}^1`], root);
  const diffBase = baseSha ?? firstParent;
  if (!/^[0-9a-f]{40}$/.test(diffBase)) throw new Error("Release PR base must be a full commit SHA.");
  git(["merge-base", "--is-ancestor", diffBase, sourceSha], root);
  const changedPaths = git(["diff", "--name-only", "-z", diffBase, sourceSha], root).split("\0").filter(Boolean);
  if (!changedPaths.includes("CHANGELOG.md")) throw new Error("Dedicated release commit must update CHANGELOG.md.");
  const readinessPath = `docs/release-readiness/v${version}.md`;
  git(["cat-file", "-e", `${sourceSha}:${readinessPath}`], root);

  const invalidPaths = changedPaths.filter((path) => !isAllowedReleasePath(path, readinessPath));
  if (invalidPaths.length > 0)
    throw new Error(`Release commit contains non-release changes: ${invalidPaths.join(", ")}.`);
  for (const path of changedPaths.filter(isWorkspaceManifest))
    verifyManifestVersionOnly({ root, baseSha: diffBase, sourceSha, path, version });
  if (changedPaths.includes("apps/mobile/app.config.ts"))
    verifyExpoVersionOnly({ root, baseSha: diffBase, sourceSha, version });
  return { baseSha: diffBase, changedPaths };
}

function isAllowedReleasePath(path, readinessPath) {
  return (
    path === "CHANGELOG.md" ||
    path === readinessPath ||
    isWorkspaceManifest(path) ||
    path === "apps/mobile/app.config.ts"
  );
}

function isWorkspaceManifest(path) {
  return path === "package.json" || /^(?:apps|packages)\/[^/]+\/package\.json$/.test(path);
}

function verifyManifestVersionOnly({ root, baseSha, sourceSha, path, version }) {
  const before = JSON.parse(git(["show", `${baseSha}:${path}`], root));
  const after = JSON.parse(git(["show", `${sourceSha}:${path}`], root));
  if (!isStableSemVer(before.version) || after.version !== version) {
    throw new Error(`${path} must change only its top-level version to ${version}.`);
  }
  delete before.version;
  delete after.version;
  if (!deepEqual(before, after)) throw new Error(`${path} contains changes beyond its top-level version field.`);
}

function verifyExpoVersionOnly({ root, baseSha, sourceSha, version }) {
  const before = git(["show", `${baseSha}:apps/mobile/app.config.ts`], root);
  const after = git(["show", `${sourceSha}:apps/mobile/app.config.ts`], root);
  const versionPattern = /^(\s*version:\s*")[^"\r\n]+("\s*,?\s*)$/m;
  const beforeMatch = before.match(versionPattern);
  const afterMatch = after.match(versionPattern);
  const beforeVersion = beforeMatch?.[0].match(/"([^"]+)"/)?.[1];
  const afterVersion = afterMatch?.[0].match(/"([^"]+)"/)?.[1];
  if (!isStableSemVer(beforeVersion) || afterVersion !== version) {
    throw new Error(`apps/mobile/app.config.ts must change only its Expo version to ${version}.`);
  }
  if (before.replace(versionPattern, "$1<version>$2") !== after.replace(versionPattern, "$1<version>$2")) {
    throw new Error("apps/mobile/app.config.ts contains changes beyond its Expo version field.");
  }
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) return false;
  return leftKeys.every((key) => deepEqual(left[key], right[key]));
}

function git(args, root) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).replace(
    /\n$/,
    "",
  );
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--sha" || argument === "--version" || argument === "--base") {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      options[argument === "--sha" ? "sourceSha" : argument === "--version" ? "version" : "baseSha"] = value;
      index += 1;
      continue;
    }
    if (argument === "--help") {
      console.log(
        "Usage: node tools/verify-release-pr-changes.mjs --version X.Y.Z --sha <full-commit-sha> [--base <first-pr-commit-parent>]",
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.sourceSha || !options.version) throw new Error("--version and --sha are required.");
  return options;
}

function main() {
  const result = verifyReleaseCommit(parseArguments(process.argv.slice(2)));
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
