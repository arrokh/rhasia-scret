import { defineConfig, devices } from "@playwright/test";

const browserTestPort = process.env.BROWSER_TEST_PORT ?? "3100";
const browserTestBaseUrl = `http://127.0.0.1:${browserTestPort}`;

export const supportedBrowserProjects = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } }
];

export default defineConfig({
  testDir: "src/tests/browser",
  testIgnore: ["offline-pwa.spec.ts", "encrypted-vault-workflows.spec.ts", "navigation-performance.spec.ts"],
  fullyParallel: false,
  workers: 3,
  timeout: 60_000,
  projects: supportedBrowserProjects,
  use: { baseURL: browserTestBaseUrl },
  webServer: {
    command: `pnpm exec next dev -p ${browserTestPort}`,
    url: browserTestBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
