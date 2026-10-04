import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidSemVer } from "./release-version.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serviceRoots = {
  api: "apps/api",
  web: "apps/web",
};
const sharedBuildPaths = [
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tools/vercel-ignore.mjs",
  "patches",
];
const serviceConfigPaths = {
  api: ["apps/api/vercel.json"],
  web: ["vercel.json"],
};

export function workspacePackages(root = repositoryRoot) {
  const packages = new Map();
  for (const parent of ["apps", "packages"]) {
    const directory = resolve(root, parent);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packagePath = resolve(directory, entry.name);
      const manifestPath = resolve(packagePath, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (typeof manifest.name === "string") packages.set(manifest.name, { manifest, path: packagePath });
    }
  }
  return packages;
}

export function serviceScopePaths(service, root = repositoryRoot) {
  assertService(service);
  const packages = workspacePackages(root);
  const appPath = resolve(root, serviceRoots[service]);
  const appManifest = JSON.parse(readFileSync(resolve(appPath, "package.json"), "utf8"));
  const scopes = new Set([serviceRoots[service], ...sharedBuildPaths, ...serviceConfigPaths[service]]);
  const pending = [appManifest];
  const visited = new Set();

  while (pending.length > 0) {
    const manifest = pending.pop();
    if (!manifest || typeof manifest.name !== "string" || visited.has(manifest.name)) continue;
    visited.add(manifest.name);
    const workspacePackage = packages.get(manifest.name);
    if (workspacePackage) scopes.add(toRepositoryPath(root, workspacePackage.path));

    for (const dependencyName of workspaceDependencyNames(manifest)) {
      const dependency = packages.get(dependencyName);
      if (dependency && !visited.has(dependencyName)) pending.push(dependency.manifest);
    }
  }

  return [...scopes].sort();
}

export function isServiceAffected(service, changedPaths, root = repositoryRoot) {
  const scopes = serviceScopePaths(service, root);
  return changedPaths.some((changedPath) => scopes.some((scope) => isWithinScope(changedPath, scope)));
}

export function changedPathsBetween(previousSha, currentSha, cwd = repositoryRoot) {
  return execFileSync(
    "git",
    ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", previousSha, currentSha, "--"],
    { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 30_000 },
  )
    .split("\0")
    .filter(Boolean);
}

export function filterVersionOnlyManifestChanges(previousSha, currentSha, changedPaths, cwd = repositoryRoot) {
  return changedPaths.filter((changedPath) => {
    if (changedPath !== "package.json" && !/^(?:apps|packages)\/[^/]+\/package\.json$/.test(changedPath)) return true;
    return !isVersionOnlyManifestChange(previousSha, currentSha, changedPath, cwd);
  });
}

export function isVersionOnlyManifestChange(previousSha, currentSha, manifestPath, cwd = repositoryRoot) {
  const previous = readManifestAtRevision(previousSha, manifestPath, cwd);
  const current = readManifestAtRevision(currentSha, manifestPath, cwd);
  if (
    !previous ||
    !current ||
    typeof previous.version !== "string" ||
    typeof current.version !== "string" ||
    !isValidSemVer(previous.version) ||
    !isValidSemVer(current.version)
  ) {
    throw new Error(`Cannot safely compare product versions in ${manifestPath}.`);
  }
  if (previous.version === current.version) return false;

  delete previous.version;
  delete current.version;
  return isDeepStrictEqual(previous, current);
}

export function shouldIgnoreDeployment(service, changedPaths, root = repositoryRoot) {
  return !isServiceAffected(service, changedPaths, root);
}

export function shouldBuildForProductVersionChange(
  service,
  previousSha,
  currentSha,
  changedPaths,
  cwd = repositoryRoot,
) {
  assertService(service);
  return (
    service === "web" &&
    changedPaths.includes("package.json") &&
    isVersionOnlyManifestChange(previousSha, currentSha, "package.json", cwd)
  );
}

function readManifestAtRevision(revision, manifestPath, cwd) {
  const source = execFileSync("git", ["show", `${revision}:${manifestPath}`], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  const manifest = JSON.parse(source);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  return structuredClone(manifest);
}

function workspaceDependencyNames(manifest) {
  return Object.keys({
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  });
}

function isWithinScope(changedPath, scope) {
  return changedPath === scope || changedPath.startsWith(`${scope}/`);
}

function toRepositoryPath(root, absolutePath) {
  return relative(root, absolutePath).split("\\").join("/");
}

function assertService(value) {
  if (value !== "api" && value !== "web") throw new Error(`Unknown Vercel service: ${value}`);
}

function isSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

function run() {
  const service = process.argv[2];
  assertService(service);

  const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA;
  const currentSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (!isSha(previousSha) || (!isSha(currentSha) && currentSha !== undefined)) {
    console.info(`[vercel-ignore] ${service}: no reliable previous deployment commit; building.`);
    return 1;
  }

  const targetSha = currentSha ?? "HEAD";
  let changedPaths;
  try {
    changedPaths = changedPathsBetween(previousSha, targetSha);
  } catch {
    console.warn(`[vercel-ignore] ${service}: could not compare deployment commits; building.`);
    return 1;
  }

  try {
    const effectivePaths = filterVersionOnlyManifestChanges(previousSha, targetSha, changedPaths);
    if (shouldBuildForProductVersionChange(service, previousSha, targetSha, changedPaths)) {
      console.info(
        `[vercel-ignore] ${service}: product version changed; building to update the compiled footer version.`,
      );
      return 1;
    }
    if (shouldIgnoreDeployment(service, effectivePaths)) {
      console.info(`[vercel-ignore] ${service}: no affected files; skipping deployment.`);
      return 0;
    }
  } catch {
    console.warn(`[vercel-ignore] ${service}: could not inspect workspace dependencies; building.`);
    return 1;
  }
  console.info(`[vercel-ignore] ${service}: affected files found; building.`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run();
}
