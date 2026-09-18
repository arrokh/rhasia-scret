import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = join(process.cwd(), "../..");
const rootExample = join(repositoryRoot, ".env.example");

describe("workspace environment contract", () => {
  it("keeps one root example with explicit service sections", () => {
    const example = readFileSync(rootExample, "utf8");

    expect(existsSync(join(repositoryRoot, "apps", "web", ".env.example"))).toBe(false);
    expect(existsSync(join(repositoryRoot, "apps", "mobile", ".env.example"))).toBe(false);
    expect(example).toContain("# Hosted API service: self-managed passwordless authentication (server-only)");
    expect(example).toContain("# Native mobile build: public values only (Expo embeds these in the client)");
    expect(example).toContain("# Docker Compose: database bootstrap and published web port");
    expect(example).toContain("AUTH_BACKEND=passwordless");
    expect(example).toContain("EXPO_PUBLIC_API_URL=");
  });

  it("keeps server-only variables out of the browser test web child", () => {
    const browserServer = readFileSync(join(repositoryRoot, "apps", "web", "scripts", "run-browser-server.ts"), "utf8");

    expect(browserServer).toContain("WEB_BLOCKED_ENVIRONMENT_KEYS");
    for (const key of ["DATABASE_URL", "SMTP_PASSWORD", "AUTH_EMAIL_FROM", "TURNSTILE_SECRET_KEY"])
      expect(browserServer).toContain(`"${key}"`);
    expect(browserServer).toContain("createScopedEnvironment");
  });

  it("does not load app-local environment files", () => {
    const sourceFiles = [
      join(repositoryRoot, "apps", "web", "scripts", "load-workspace-environment.ts"),
      join(repositoryRoot, "apps", "web", "next.config.ts"),
      join(repositoryRoot, "apps", "web", "playwright.config.ts"),
      join(repositoryRoot, "apps", "web", "playwright.e2e.config.ts"),
      join(repositoryRoot, "apps", "web", "playwright.pwa.config.ts"),
      join(repositoryRoot, "apps", "web", "playwright.performance.config.ts"),
      join(repositoryRoot, "apps", "web", "vitest.config.ts"),
      join(repositoryRoot, "apps", "mobile", "app.config.ts"),
    ];

    for (const path of sourceFiles) expect(readFileSync(path, "utf8")).not.toMatch(/\.env\.local|apps\/web\/\.env/);

    for (const path of sourceFiles.slice(1, -1)) {
      expect(readFileSync(path, "utf8")).toContain("loadWorkspaceEnvironment");
    }
  });
});
