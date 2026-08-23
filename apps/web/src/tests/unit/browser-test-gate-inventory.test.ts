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
  "vault-archive-import.spec.ts"
] as const;
const e2eSpecs = ["encrypted-vault-workflows.spec.ts"] as const;
const pwaSpecs = ["offline-pwa.spec.ts"] as const;
const separatelyRunSpecs = ["navigation-performance.spec.ts"] as const;

const browserTestDirectory = resolve(process.cwd(), "src/tests/browser");

function browserSpecFiles(): string[] {
  return readdirSync(browserTestDirectory).filter((file) => file.endsWith(".spec.ts")).sort();
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
    expect(gate).toContain('runStage("smoke"');
    expect(gate).toContain('runStage("e2e"');
    expect(gate).toContain('runStage("pwa"');
  });

  it("keeps navigation performance as the explicit CI performance command", () => {
    const packageJson = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
    expect(packageJson).toContain('"performance": "playwright test --config playwright.performance.config.ts"');
  });
});
