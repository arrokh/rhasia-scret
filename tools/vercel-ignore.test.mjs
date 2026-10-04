import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  filterVersionOnlyManifestChanges,
  isServiceAffected,
  serviceScopePaths,
  shouldBuildForProductVersionChange,
  shouldIgnoreDeployment,
} from "./vercel-ignore.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("restricts both Vercel projects to main and configures path-aware ignore commands", () => {
  const web = JSON.parse(readFileSync(join(repositoryRoot, "vercel.json"), "utf8"));
  const api = JSON.parse(readFileSync(join(repositoryRoot, "apps/api/vercel.json"), "utf8"));
  assert.deepEqual(web.git?.deploymentEnabled, { main: true, "**": false });
  assert.equal(web.ignoreCommand, "node ../../tools/vercel-ignore.mjs web");
  assert.deepEqual(api.git?.deploymentEnabled, { main: true, "**": false });
  assert.equal(api.ignoreCommand, "node ../../tools/vercel-ignore.mjs api");
});

test("follows each app's workspace dependency graph", () => {
  const apiScopes = serviceScopePaths("api", repositoryRoot);
  const webScopes = serviceScopePaths("web", repositoryRoot);

  assert.ok(apiScopes.includes("apps/api"));
  assert.ok(apiScopes.includes("packages/api-contract"));
  assert.ok(apiScopes.includes("packages/client-vault-core"));
  assert.ok(!apiScopes.includes("packages/api-client"));

  assert.ok(webScopes.includes("apps/web"));
  assert.ok(webScopes.includes("packages/api-contract"));
  assert.ok(webScopes.includes("packages/client-vault-core"));
  assert.ok(!webScopes.includes("packages/api-client"));
});

test("selects only the Vercel service affected by app or shared-package changes", () => {
  assert.equal(isServiceAffected("api", ["apps/api/src/routes/v1.ts"]), true);
  assert.equal(isServiceAffected("api", ["apps/web/src/app/page.tsx"]), false);
  assert.equal(isServiceAffected("api", ["packages/api-contract/src/index.ts"]), true);
  assert.equal(isServiceAffected("api", ["packages/api-client/src/index.ts"]), false);

  assert.equal(isServiceAffected("web", ["apps/web/src/app/page.tsx"]), true);
  assert.equal(isServiceAffected("web", ["apps/api/src/routes/v1.ts"]), false);
  assert.equal(isServiceAffected("web", ["packages/client-vault-core/src/index.ts"]), true);
  assert.equal(isServiceAffected("web", ["packages/api-client/src/index.ts"]), false);
});

test("includes install and service configuration changes in the affected service", () => {
  assert.equal(isServiceAffected("api", ["pnpm-lock.yaml"]), true);
  assert.equal(isServiceAffected("api", ["vercel.json"]), false);
  assert.equal(isServiceAffected("web", ["vercel.json"]), true);
  assert.equal(isServiceAffected("web", ["apps/api/vercel.json"]), false);
  assert.equal(isServiceAffected("api", ["tools/vercel-ignore.mjs"]), true);
  assert.equal(isServiceAffected("web", ["tools/vercel-ignore.mjs"]), true);
});

test("filters version-only changes to root, app, and shared workspace manifests", () => {
  const root = createGitFixture();
  try {
    const baseSha = commitAll(root, "baseline");
    for (const manifestPath of [
      "package.json",
      "apps/api/package.json",
      "apps/web/package.json",
      "packages/shared/package.json",
    ]) {
      const manifest = JSON.parse(readFileSync(join(root, manifestPath), "utf8"));
      manifest.version = "0.1.1";
      writeFileSync(join(root, manifestPath), JSON.stringify(manifest, null, 2));
    }
    const currentSha = commitAll(root, "version synchronization");
    const changedPaths = changedPathsIn(root, baseSha, currentSha);
    assert.equal(changedPaths.length, 4);
    const effectivePaths = filterVersionOnlyManifestChanges(baseSha, currentSha, changedPaths, root);
    assert.deepEqual(effectivePaths, []);
    assert.equal(isServiceAffected("api", effectivePaths, root), false);
    assert.equal(isServiceAffected("web", effectivePaths, root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rebuilds Web but skips API for a root product-version-only release change", () => {
  const root = createGitFixture();
  try {
    const baseSha = commitAll(root, "baseline");
    for (const manifestPath of [
      "package.json",
      "apps/api/package.json",
      "apps/web/package.json",
      "packages/shared/package.json",
    ]) {
      const manifest = JSON.parse(readFileSync(join(root, manifestPath), "utf8"));
      manifest.version = "0.1.1";
      writeFileSync(join(root, manifestPath), JSON.stringify(manifest, null, 2));
    }
    const currentSha = commitAll(root, "product version release");
    const changedPaths = changedPathsIn(root, baseSha, currentSha);
    const effectivePaths = filterVersionOnlyManifestChanges(baseSha, currentSha, changedPaths, root);

    assert.deepEqual(effectivePaths, []);
    assert.equal(shouldBuildForProductVersionChange("web", baseSha, currentSha, changedPaths, root), true);
    assert.equal(shouldBuildForProductVersionChange("api", baseSha, currentSha, changedPaths, root), false);
    assert.equal(shouldIgnoreDeployment("api", effectivePaths, root), true);
    assert.equal(
      shouldBuildForProductVersionChange(
        "web",
        baseSha,
        currentSha,
        changedPaths.filter((changedPath) => changedPath !== "package.json"),
        root,
      ),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps service, dependency, and non-version manifest changes as deployment inputs", () => {
  const root = createGitFixture();
  try {
    const baseSha = commitAll(root, "baseline");
    const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    rootManifest.scripts = { build: "node build.js" };
    writeFileSync(join(root, "package.json"), JSON.stringify(rootManifest, null, 2));
    const apiManifest = JSON.parse(readFileSync(join(root, "apps/api/package.json"), "utf8"));
    apiManifest.scripts = { test: "node test.js" };
    writeFileSync(join(root, "apps/api/package.json"), JSON.stringify(apiManifest, null, 2));
    const sharedManifest = JSON.parse(readFileSync(join(root, "packages/shared/package.json"), "utf8"));
    sharedManifest.dependencies = { added: "1.0.0" };
    writeFileSync(join(root, "packages/shared/package.json"), JSON.stringify(sharedManifest, null, 2));
    mkdirSync(join(root, "apps/api/src"), { recursive: true });
    writeFileSync(join(root, "apps/api/src/index.js"), "export const changed = true;\n");
    const currentSha = commitAll(root, "build inputs");
    const changedPaths = changedPathsIn(root, baseSha, currentSha);
    const effectivePaths = filterVersionOnlyManifestChanges(baseSha, currentSha, changedPaths, root);
    assert.deepEqual(effectivePaths, changedPaths);
    assert.equal(isServiceAffected("api", effectivePaths, root), true);
    assert.equal(isServiceAffected("web", effectivePaths, root), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not suppress version-only changes to nested non-workspace manifests", () => {
  const root = createGitFixture();
  try {
    writeFixtureFile(root, "apps/api/src/plugin/package.json", {
      name: "@fixture/api-plugin",
      version: "0.1.0",
    });
    const baseSha = commitAll(root, "baseline");
    const nestedManifest = JSON.parse(readFileSync(join(root, "apps/api/src/plugin/package.json"), "utf8"));
    nestedManifest.version = "0.1.1";
    writeFileSync(join(root, "apps/api/src/plugin/package.json"), `${JSON.stringify(nestedManifest, null, 2)}\n`);
    const currentSha = commitAll(root, "nested package version change");
    const changedPaths = changedPathsIn(root, baseSha, currentSha);
    const effectivePaths = filterVersionOnlyManifestChanges(baseSha, currentSha, changedPaths, root);
    assert.deepEqual(effectivePaths, ["apps/api/src/plugin/package.json"]);
    assert.equal(isServiceAffected("api", effectivePaths, root), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed when a changed package manifest cannot be parsed", () => {
  const root = createGitFixture();
  try {
    const baseSha = commitAll(root, "baseline");
    writeFileSync(join(root, "apps/api/package.json"), "not json");
    const currentSha = commitAll(root, "malformed manifest");
    assert.throws(() => filterVersionOnlyManifestChanges(baseSha, currentSha, ["apps/api/package.json"], root), /JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discovers workspace packages from the configured workspace roots", () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-vercel-ignore-"));
  try {
    mkdirSync(join(root, "apps/api"), { recursive: true });
    mkdirSync(join(root, "apps/web"), { recursive: true });
    mkdirSync(join(root, "packages/api-contract"), { recursive: true });
    mkdirSync(join(root, "packages/client-vault-core"), { recursive: true });
    mkdirSync(join(root, "packages/api-client"), { recursive: true });
    writeFileSync(
      join(root, "apps/api/package.json"),
      JSON.stringify({ name: "api", dependencies: { "@rhasia-scret/api-contract": "workspace:*" } }),
    );
    writeFileSync(join(root, "apps/web/package.json"), JSON.stringify({ name: "web" }));
    writeFileSync(
      join(root, "packages/api-contract/package.json"),
      JSON.stringify({
        name: "@rhasia-scret/api-contract",
        dependencies: { "@rhasia-scret/client-vault-core": "workspace:*" },
      }),
    );
    writeFileSync(
      join(root, "packages/client-vault-core/package.json"),
      JSON.stringify({ name: "@rhasia-scret/client-vault-core" }),
    );
    writeFileSync(join(root, "packages/api-client/package.json"), JSON.stringify({ name: "@rhasia-scret/api-client" }));

    assert.deepEqual(serviceScopePaths("api", root), [
      ".npmrc",
      "apps/api",
      "apps/api/vercel.json",
      "package.json",
      "packages/api-contract",
      "packages/client-vault-core",
      "patches",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tools/vercel-ignore.mjs",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createGitFixture() {
  const root = mkdtempSync(join(tmpdir(), "rhasia-vercel-ignore-git-"));
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  writeFixtureFile(root, "package.json", { name: "fixture-root", version: "0.1.0" });
  writeFixtureFile(root, "apps/api/package.json", {
    name: "@fixture/api",
    version: "0.1.0",
    dependencies: { "@fixture/shared": "workspace:*" },
  });
  writeFixtureFile(root, "apps/web/package.json", {
    name: "@fixture/web",
    version: "0.1.0",
    dependencies: { "@fixture/shared": "workspace:*" },
  });
  writeFixtureFile(root, "packages/shared/package.json", { name: "@fixture/shared", version: "0.1.0" });
  return root;
}

function writeFixtureFile(root, relativePath, value) {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function commitAll(root, message) {
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", message], { cwd: root });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function changedPathsIn(root, previousSha, currentSha) {
  return execFileSync("git", ["diff", "--name-only", "-z", previousSha, currentSha], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}
