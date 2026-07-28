import "dotenv/config";
import { defineConfig } from "@playwright/test";
import { supportedBrowserProjects } from "./playwright.config";
import { configuredE2eBrowserUsers } from "./src/tests/browser/support/e2e-users";

const browserTestPort = process.env.BROWSER_TEST_PORT ?? "3100";
const browserTestBaseUrl = `http://127.0.0.1:${browserTestPort}`;

export default defineConfig({
  testDir: "src/tests/browser",
  testMatch: "encrypted-vault-workflows.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 15_000 },
  globalSetup: "./src/tests/browser/support/global-setup.ts",
  globalTeardown: "./src/tests/browser/support/global-teardown.ts",
  projects: supportedBrowserProjects,
  use: {
    baseURL: browserTestBaseUrl,
    trace: "retain-on-failure"
  },
  webServer: {
    command: `pnpm exec next dev -p ${browserTestPort}`,
    url: browserTestBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      E2E_BROWSER_TESTS: "1",
      E2E_BROWSER_TEST_USERS: JSON.stringify(configuredE2eBrowserUsers()),
      NEXT_PUBLIC_E2E_BROWSER_TESTS: "1",
      PASSKEY_ORIGIN: browserTestBaseUrl,
      PASSKEY_RP_ID: "127.0.0.1"
    }
  }
});
