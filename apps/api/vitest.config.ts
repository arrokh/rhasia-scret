import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import { loadWorkspaceEnvironment } from "./scripts/load-workspace-environment";

loadWorkspaceEnvironment();

export default defineConfig({
  resolve: {
    alias: {
      "@api": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
