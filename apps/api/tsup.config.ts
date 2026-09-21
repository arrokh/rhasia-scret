import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/node.ts", "src/vercel.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  splitting: false,
  noExternal: ["@rhasia-scret/api-contract", "@rhasia-scret/client-vault-core"],
});
