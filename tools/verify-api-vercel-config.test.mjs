import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiVercelConfig = JSON.parse(readFileSync(resolve(repositoryRoot, "apps/api/vercel.json"), "utf8"));

test("API Vercel skips the Node build script, auto-detects Go functions, and keeps main-only deployment", () => {
  assert.equal(apiVercelConfig.framework, null);
  assert.equal(apiVercelConfig.buildCommand, "true");
  assert.deepEqual(apiVercelConfig.git.deploymentEnabled, { main: true, "**": false });
  assert.ok(apiVercelConfig.functions["api/index.go"]);
  assert.ok(apiVercelConfig.functions["api/health/index.go"]);
  assert.ok(apiVercelConfig.functions["api/time/index.go"]);
});

test("API deployment is a Go runtime with Node limited to test tooling", () => {
  const apiRoot = resolve(repositoryRoot, "apps/api");
  const apiPackage = JSON.parse(readFileSync(resolve(apiRoot, "package.json"), "utf8"));
  const dockerfile = readFileSync(resolve(apiRoot, "Dockerfile"), "utf8");

  assert.equal(apiPackage.name, "@rhasia-scret/api-test-tools");
  assert.equal(apiPackage.dependencies, undefined);
  assert.equal(existsSync(resolve(apiRoot, "src")), false);
  assert.equal(existsSync(resolve(apiRoot, "prisma/schema.prisma")), false);
  assert.equal(existsSync(resolve(apiRoot, "prisma/archive")), true);
  assert.match(dockerfile, /^FROM --platform=\$BUILDPLATFORM golang:/m);
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/api"\]/);
  assert.doesNotMatch(dockerfile, /^FROM\s+(?:node|oven\/bun)(?:\s|:)/im);
});
