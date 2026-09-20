import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/node.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  noExternal: ["@rhasia-scret/api-contract", "@rhasia-scret/client-vault-core"],
});
