import { defineConfig } from "@playwright/test";
import { loadWorkspaceEnvironment } from "./scripts/load-workspace-environment";

loadWorkspaceEnvironment();
import { supportedBrowserProjects } from "./playwright.config";
import { configuredE2eBrowserUsers } from "./src/tests/browser/support/e2e-users";
import {
  configuredPlaywrightFullyParallel,
  configuredPlaywrightWorkers,
} from "./src/tests/browser/support/playwright-concurrency";

const browserTestPort = process.env.BROWSER_TEST_PORT ?? "3100";
const browserTestBaseUrl = `http://127.0.0.1:${browserTestPort}`;
const e2eUsers = configuredE2eBrowserUsers();
const e2eAuthBackend = process.env.E2E_AUTH_BACKEND ?? "passwordless";

export default defineConfig({
  testDir: "src/tests/browser",
  testMatch: ["encrypted-vault-workflows.spec.ts", "account-deletion.spec.ts"],
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
    command: `pnpm exec tsx scripts/run-browser-server.ts ${browserTestPort}`,
    url: browserTestBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      E2E_BROWSER_TESTS: "1",
      E2E_BROWSER_TEST_USERS: JSON.stringify(e2eUsers),
      AUTH_BACKEND: e2eAuthBackend,
      AUTH_APP_ORIGIN: browserTestBaseUrl,
      AUTH_MAGIC_LINK_SECRET: "browser-e2e-magic-link-secret-12345678901234567890",
      AUTH_SESSION_SECRET: "browser-e2e-session-secret-12345678901234567890",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      AUTH_EMAIL_FROM: "no-reply@browser-e2e.invalid",
      AUTH_EMAIL_FROM_NAME: "rhasia-scret",
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
