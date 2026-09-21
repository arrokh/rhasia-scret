import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

type PackageManifest = { dependencies?: Record<string, string> };

const packageManifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as PackageManifest;
const buildTarget = process.env.API_BUILD_TARGET ?? "node";
if (buildTarget !== "node" && buildTarget !== "vercel")
  throw new Error(`API_BUILD_TARGET must be node or vercel, received ${buildTarget}.`);

const workspaceDependencies = ["@rhasia-scret/api-contract", "@rhasia-scret/client-vault-core"];
// Vercel loads dist/vercel.js through a runtime dynamic import, so bundle every direct dependency into the artifact.
const vercelDependencies = Object.keys(packageManifest.dependencies ?? {});

export default defineConfig({
  entry: buildTarget === "vercel" ? ["src/vercel.ts", "src/vercel-health.ts", "src/vercel-time.ts"] : ["src/node.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  splitting: true,
  noExternal: buildTarget === "vercel" ? vercelDependencies : workspaceDependencies,
});
