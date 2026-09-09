import { config as loadEnvironment } from "dotenv";
import { defineConfig } from "@playwright/test";

loadEnvironment({ path: "../../.env" });
import { supportedBrowserProjects } from "./playwright.config";
import { configuredE2eBrowserUsers } from "./src/tests/browser/support/e2e-users";
import {
  configuredPlaywrightFullyParallel,
  configuredPlaywrightWorkers,
} from "./src/tests/browser/support/playwright-concurrency";

const browserTestPort = process.env.BROWSER_TEST_PORT ?? "3100";
const browserTestBaseUrl = `http://127.0.0.1:${browserTestPort}`;
const e2eUsers = configuredE2eBrowserUsers();
const e2eAuthBackend = process.env.E2E_AUTH_BACKEND ?? "supabase";

export default defineConfig({
  testDir: "src/tests/browser",
  testMatch: "encrypted-vault-workflows.spec.ts",
  fullyParallel: configuredPlaywrightFullyParallel(true),
  workers: configuredPlaywrightWorkers(3),
  timeout: 600_000,
  expect: { timeout: 15_000 },
  globalSetup: "./src/tests/browser/support/global-setup.ts",
  globalTeardown: "./src/tests/browser/support/global-teardown.ts",
  projects: supportedBrowserProjects,
  use: {
    baseURL: browserTestBaseUrl,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec next dev -p ${browserTestPort}`,
    url: browserTestBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      E2E_BROWSER_TESTS: "1",
      E2E_BROWSER_TEST_USERS: JSON.stringify(e2eUsers),
      AUTH_BACKEND: e2eAuthBackend,
      AUTH_ADMITTED_EMAILS: Object.values(e2eUsers)
        .map(({ email }) => email)
        .join(","),
      ...(e2eAuthBackend === "oidc"
        ? {
            OIDC_ISSUER: "https://issuer.browser-e2e.invalid",
            OIDC_CLIENT_ID: "browser-e2e-client",
            OIDC_CLIENT_SECRET: "browser-e2e-server-secret",
            OIDC_REDIRECT_URI: `${browserTestBaseUrl}/auth/oidc/callback`,
            OIDC_SESSION_SECRET: "browser-e2e-session-secret-12345678901234567890",
          }
        : {}),
      NEXT_PUBLIC_E2E_BROWSER_TESTS: "1",
      PASSKEY_ORIGIN: browserTestBaseUrl,
      PASSKEY_RP_ID: "127.0.0.1",
    },
  },
});
