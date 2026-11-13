import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const apiRoot = resolve(repositoryRoot, "apps/api");
const generatedPath = resolve(apiRoot, "internal/httpapi/openapi.gen.go");
const original = readFileSync(generatedPath);
const result = spawnSync("go", ["generate", "./..."], {
  cwd: apiRoot,
  encoding: "utf8",
});

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}

const regenerated = readFileSync(generatedPath);
if (!original.equals(regenerated)) {
  throw new Error(
    "Generated Go API transport is stale; run `cd apps/api && go generate ./...` with the pinned Go toolchain.",
  );
}

console.log("Generated Go Echo transport is current (oapi-codegen v2.8.2)");
