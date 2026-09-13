import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const smokeSpecs = [
  "granular-loading.spec.ts",
  "mobile-preview.spec.ts",
  "remembered-browser.spec.ts",
  "security-headers.spec.ts",
  "smoke.spec.ts",
  "vault-archive-backup.spec.ts",
  "vault-archive-import.spec.ts",
] as const;
const e2eSpecs = ["encrypted-vault-workflows.spec.ts"] as const;
const pwaSpecs = ["offline-pwa.spec.ts"] as const;
const separatelyRunSpecs = ["navigation-performance.spec.ts"] as const;

const browserTestDirectory = resolve(process.cwd(), "src/tests/browser");

function browserSpecFiles(): string[] {
  return readdirSync(browserTestDirectory)
    .filter((file) => file.endsWith(".spec.ts"))
    .sort();
}

describe("browser test gate inventory", () => {
  it("keeps every browser spec assigned to exactly one gate or the separate performance check", () => {
    const expected = [...smokeSpecs, ...e2eSpecs, ...pwaSpecs, ...separatelyRunSpecs].sort();
    expect(browserSpecFiles()).toEqual(expected);
    expect(new Set(expected).size).toBe(expected.length);
  });

  it("runs the two development suites in isolated directories and ports before the PWA suite", () => {
    const runner = readFileSync(resolve(process.cwd(), "scripts/run-browser-suite.ts"), "utf8");
    const gate = readFileSync(resolve(process.cwd(), "scripts/run-browser-gate.ts"), "utf8");

    expect(runner).toContain('distDir: ".next/browser-smoke"');
    expect(runner).toContain('distDir: ".next/browser-e2e"');
    expect(runner).toContain("portOffset: 1");
    expect(runner).toContain("PLAYWRIGHT_SMOKE_WORKERS");
    expect(runner).toContain("PLAYWRIGHT_E2E_WORKERS");
    expect(runner).toContain("...process.argv.slice(3)");
    expect(gate).toContain('runStage("smoke"');
    expect(gate).toContain('runStage("e2e"');
    expect(gate).toContain('runStage("pwa"');
  });

  it("distributes each development suite across the explicitly supported Chromium CI target", () => {
    const workflow = readFileSync(resolve(process.cwd(), "../../.github/workflows/ci.yml"), "utf8");
    const gate = readFileSync(resolve(process.cwd(), "scripts/run-browser-gate.ts"), "utf8");
    const playwrightConfig = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");

    expect(workflow).toContain("suite: [smoke, e2e]");
    expect(workflow).toContain(
      "browser:\n          - chromium\n          # - firefox: intentionally deferred from hosted CI coverage\n          # - webkit: intentionally deferred from hosted CI coverage",
    );
    expect(workflow).toContain('pnpm run test:browser:${{ matrix.suite }} --project="${{ matrix.browser }}"');
    expect(workflow).toContain("PLAYWRIGHT_WORKERS: 1");
    expect(workflow).toContain("PLAYWRIGHT_E2E_WORKERS: 2");
    expect(workflow).toContain("restore-keys:");
    expect(workflow).toContain("pnpm run test:browser:pwa --project=chromium");
    expect(workflow).not.toContain("BROWSER_TEST_SEQUENTIAL: 1");
    expect(workflow).not.toContain("browser: [chromium, firefox, webkit]");
    expect(playwrightConfig).toContain('// { name: "firefox", use: { ...devices["Desktop Firefox"] } }');
    expect(playwrightConfig).toContain('// { name: "webkit", use: { ...devices["Desktop Safari"] } }');
    expect(gate).toContain('process.env.BROWSER_TEST_SEQUENTIAL === "1"');
    expect(gate).toContain('"sequential-dev-suites-then-production-pwa"');
  });

  it("keeps the complete web gate deterministic while allowing an explicit parallel override", () => {
    const packageJson = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
    expect(packageJson).toContain('"performance": "playwright test --config playwright.performance.config.ts"');
    expect(packageJson).toContain('BROWSER_TEST_SEQUENTIAL=\\"${BROWSER_TEST_SEQUENTIAL:-1}\\"');
  });
});
