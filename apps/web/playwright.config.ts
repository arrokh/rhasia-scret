import { defineConfig, devices } from "@playwright/test";
import {
  configuredPlaywrightFullyParallel,
  configuredPlaywrightWorkers,
} from "./src/tests/browser/support/playwright-concurrency";
import { loadWorkspaceEnvironment } from "./scripts/load-workspace-environment";

loadWorkspaceEnvironment();

const browserTestPort = process.env.BROWSER_TEST_PORT ?? "3100";
const browserTestBaseUrl = `http://127.0.0.1:${browserTestPort}`;

export const supportedBrowserProjects = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  // { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  // { name: "webkit", use: { ...devices["Desktop Safari"] } },
];

export default defineConfig({
  testDir: "src/tests/browser",
  testIgnore: [
    "offline-pwa.spec.ts",
    "encrypted-vault-workflows.spec.ts",
    "account-deletion.spec.ts",
    "navigation-performance.spec.ts",
  ],
  fullyParallel: configuredPlaywrightFullyParallel(false),
  workers: configuredPlaywrightWorkers(3),
  timeout: 60_000,
  projects: supportedBrowserProjects,
  use: { baseURL: browserTestBaseUrl },
  webServer: {
    command: `pnpm exec tsx scripts/run-browser-server.ts ${browserTestPort}`,
    url: browserTestBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      AUTH_BACKEND: "passwordless",
      AUTH_APP_ORIGIN: browserTestBaseUrl,
      AUTH_MAGIC_LINK_SECRET: "browser-smoke-magic-link-secret-12345678901234567890",
      AUTH_SESSION_SECRET: "browser-smoke-session-secret-12345678901234567890",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      AUTH_EMAIL_FROM: "no-reply@browser-smoke.invalid",
      AUTH_EMAIL_FROM_NAME: "rhasia-scret",
      PASSKEY_ORIGIN: browserTestBaseUrl,
      PASSKEY_RP_ID: "127.0.0.1",
    },
  },
});
