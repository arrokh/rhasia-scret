import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
