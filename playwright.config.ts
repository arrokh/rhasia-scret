import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "src/tests/browser",
  use: { baseURL: "http://127.0.0.1:3000", ...devices["Desktop Chrome"] },
  webServer: { command: "pnpm run dev", url: "http://127.0.0.1:3000", reuseExistingServer: !process.env.CI }
});
