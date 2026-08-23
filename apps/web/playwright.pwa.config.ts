import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";
import { defineConfig } from "@playwright/test";

loadEnvironment({ path: "../../.env" });
import { supportedBrowserProjects } from "./playwright.config";
import { configuredPlaywrightWorkers } from "./src/tests/browser/support/playwright-concurrency";

const browserTestPort = process.env.BROWSER_TEST_PORT ?? "3100";
const browserTestBaseUrl = `http://127.0.0.1:${browserTestPort}`;
const reuseProductionBuild = process.env.BROWSER_TEST_REUSE_BUILD === "1";
if (reuseProductionBuild && !existsSync(resolve(".next/BUILD_ID"))) {
  throw new Error("BROWSER_TEST_REUSE_BUILD=1 requires a completed production build in apps/web/.next.");
}
const productionServerCommand = reuseProductionBuild ? "" : "pnpm run build && ";

export default defineConfig({
  testDir: "src/tests/browser",
  testMatch: "offline-pwa.spec.ts",
  fullyParallel: true,
  workers: configuredPlaywrightWorkers(undefined),
  timeout: 60_000,
  projects: supportedBrowserProjects,
  use: { baseURL: browserTestBaseUrl },
  webServer: {
    command: `${productionServerCommand}pnpm exec next start -p ${browserTestPort}`,
    url: browserTestBaseUrl,
    reuseExistingServer: false,
    timeout: 180_000
  }
});
