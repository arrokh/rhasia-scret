import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidSemVer } from "./release-version.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

export function versionedPackageFiles(root = repositoryRoot) {
  const files = ["package.json"];
  for (const parent of ["apps", "packages"]) {
    const directory = resolve(root, parent);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relativePath = `${parent}/${entry.name}/package.json`;
      if (existsSync(resolve(root, relativePath))) files.push(relativePath);
    }
  }
  return files.sort((left, right) =>
    left === "package.json" ? -1 : right === "package.json" ? 1 : left.localeCompare(right),
  );
}

export function verifyVersionAlignment(root = repositoryRoot) {
  const failures = [];
  const versions = [];
  for (const relativePath of versionedPackageFiles(root)) {
    let packageJson;
    try {
      packageJson = JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
    } catch {
      failures.push(`${relativePath} must contain valid JSON.`);
      continue;
    }
    if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) {
      failures.push(`${relativePath} must contain a JSON object.`);
      continue;
    }
    versions.push([relativePath, packageJson.version]);
  }

  const sourcePath = versions.find(([path]) => path === "package.json")?.[0] ?? "package.json";
  const sourceVersion = versions.find(([path]) => path === sourcePath)?.[1];
  if (typeof sourceVersion !== "string" || !isValidSemVer(sourceVersion)) {
    failures.push(`${sourcePath} must define a valid SemVer release version.`);
  }

  for (const [path, version] of versions) {
    if (typeof version !== "string" || !isValidSemVer(version)) {
      failures.push(`${path} must define a valid SemVer release version.`);
      continue;
    }
    if (typeof sourceVersion === "string" && version !== sourceVersion) {
      failures.push(`${path}=${version} does not match root release version ${sourceVersion}.`);
    }
  }

  return { valid: failures.length === 0, sourceVersion, versions, failures };
}

function main() {
  const result = verifyVersionAlignment();
  if (!result.valid) {
    console.error("Release version alignment verification failed:");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.info(
    `Release version ${result.sourceVersion} is aligned across ${result.versions.length} workspace manifests.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
