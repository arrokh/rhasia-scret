import { defineConfig, devices } from "@playwright/test";

export const supportedBrowserProjects = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } }
];

export default defineConfig({
  testDir: "src/tests/browser",
  testIgnore: "offline-pwa.spec.ts",
  fullyParallel: false,
  workers: 3,
  timeout: 60_000,
  projects: supportedBrowserProjects,
  use: { baseURL: "http://127.0.0.1:3000" },
  webServer: {
    command: "pnpm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
