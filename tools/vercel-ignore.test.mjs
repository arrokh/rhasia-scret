import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { isServiceAffected, serviceScopePaths } from "./vercel-ignore.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("restricts both Vercel projects to main and configures path-aware ignore commands", () => {
  const web = JSON.parse(readFileSync(join(repositoryRoot, "vercel.json"), "utf8"));
  const api = JSON.parse(readFileSync(join(repositoryRoot, "apps/api/vercel.json"), "utf8"));
  assert.deepEqual(web.git?.deploymentEnabled, { main: true, "**": false });
  assert.equal(web.ignoreCommand, "node tools/vercel-ignore.mjs web");
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
