import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } };
const test = { globals: true, clearMocks: true, restoreMocks: true };

export default defineConfig({
  resolve,
  test: {
    projects: [
      { resolve, test: { ...test, name: "unit", include: ["src/tests/unit/**/*.test.ts"], environment: "node" } },
      { resolve, test: { ...test, name: "integration", include: ["src/tests/integration/**/*.test.ts"], environment: "node" } },
      { resolve, test: { ...test, name: "contract", include: ["src/tests/contract/**/*.test.ts"], environment: "node" } }
    ]
  }
});
