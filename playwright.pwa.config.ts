import { defineConfig } from "@playwright/test";
import { supportedBrowserProjects } from "./playwright.config";

const browserTestPort = process.env.BROWSER_TEST_PORT ?? "3100";
const browserTestBaseUrl = `http://127.0.0.1:${browserTestPort}`;

export default defineConfig({
  testDir: "src/tests/browser",
  testMatch: "offline-pwa.spec.ts",
  fullyParallel: true,
  timeout: 60_000,
  projects: supportedBrowserProjects,
  use: { baseURL: browserTestBaseUrl },
  webServer: {
    command: `pnpm run build && pnpm exec next start -p ${browserTestPort}`,
    url: browserTestBaseUrl,
    reuseExistingServer: false,
    timeout: 180_000
  }
});
