import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { loadWorkspaceEnvironment } from "./scripts/load-workspace-environment";

loadWorkspaceEnvironment();

const resolve = {
  alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
  },
};
const test = { globals: true, clearMocks: true, restoreMocks: true };

export default defineConfig({
  resolve,
  test: {
    projects: [
      {
        resolve,
        test: {
          ...test,
          name: "unit",
          include: ["src/tests/unit/**/*.test.ts"],
          environment: "node",
          testTimeout: 15_000,
          setupFiles: ["src/tests/setup.ts"],
        },
      },
      {
        resolve,
        test: {
          ...test,
          name: "integration",
          include: ["src/tests/integration/**/*.test.ts"],
          environment: "node",
          testTimeout: 15_000,
        },
      },
      {
        resolve,
        test: {
          ...test,
          name: "contract",
          include: ["src/tests/contract/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
