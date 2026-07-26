import { defineConfig } from "@playwright/test";
import { supportedBrowserProjects } from "./playwright.config";

export default defineConfig({
  testDir: "src/tests/browser",
  testMatch: "offline-pwa.spec.ts",
  fullyParallel: true,
  timeout: 60_000,
  projects: supportedBrowserProjects,
  use: { baseURL: "http://127.0.0.1:3000" },
  webServer: {
    command: "pnpm run build && pnpm run start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 180_000
  }
});
