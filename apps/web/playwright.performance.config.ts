import { config as loadEnvironment } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

loadEnvironment({ path: "../../.env" });
loadEnvironment({ path: ".env" });
loadEnvironment({ path: ".env.local" });
import { configuredE2eBrowserUsers } from "./src/tests/browser/support/e2e-users";

const externalServer = process.env.PERFORMANCE_EXTERNAL_SERVER === "1";
const baseURL = process.env.PERFORMANCE_BASE_URL ?? "http://127.0.0.1:3001";

export default defineConfig({
  testDir: "src/tests/browser",
  testMatch: "navigation-performance.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 30_000 },
  globalSetup: "./src/tests/browser/support/global-setup.ts",
  globalTeardown: "./src/tests/browser/support/global-teardown.ts",
  projects: [{ name: "chromium-performance", use: { ...devices["Desktop Chrome"] } }],
  use: { baseURL, trace: "off", screenshot: "off", video: "off" },
  webServer: externalServer
    ? undefined
    : {
        command: "pnpm exec next dev -p 3001",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          ...process.env,
          E2E_BROWSER_TESTS: "1",
          E2E_BROWSER_TEST_USERS: JSON.stringify(configuredE2eBrowserUsers()),
          NEXT_PUBLIC_E2E_BROWSER_TESTS: "1",
          PERFORMANCE_DIAGNOSTICS: "1",
          PASSKEY_ORIGIN: baseURL,
          PASSKEY_RP_ID: new URL(baseURL).hostname,
        },
      },
});
