import { defineConfig } from "tsup";

const buildTarget = process.env.API_BUILD_TARGET ?? "node";
if (buildTarget !== "node" && buildTarget !== "vercel")
  throw new Error(`API_BUILD_TARGET must be node or vercel, received ${buildTarget}.`);

export default defineConfig({
  entry: [buildTarget === "vercel" ? "src/vercel.ts" : "src/node.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  splitting: false,
  noExternal: ["@rhasia-scret/api-contract", "@rhasia-scret/client-vault-core"],
});
