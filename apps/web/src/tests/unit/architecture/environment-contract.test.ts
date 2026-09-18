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

  it("keeps API-only variables out of every local web runtime", () => {
    const webLaunchers = [
      join(repositoryRoot, "tools", "run-local-dev.mjs"),
      join(repositoryRoot, "apps", "web", "scripts", "run-browser-server.ts"),
    ].map((path) => readFileSync(path, "utf8"));

    for (const launcher of webLaunchers) {
      expect(launcher).toContain("WEB_BLOCKED_ENVIRONMENT_KEYS");
      for (const key of [
        "DATABASE_URL",
        "SMTP_PASSWORD",
        "AUTH_EMAIL_FROM",
        "AUTH_ADMITTED_EMAILS",
        "TURNSTILE_SECRET_KEY",
      ])
        expect(launcher).toContain(`"${key}"`);
      expect(launcher).toContain("createScopedEnvironment");
    }

    const nextConfig = readFileSync(join(repositoryRoot, "apps", "web", "next.config.ts"), "utf8");
    const deploymentConfig = readFileSync(
      join(repositoryRoot, "apps", "web", "scripts", "verify-deployment-config.ts"),
      "utf8",
    );
    const environmentLoader = readFileSync(
      join(repositoryRoot, "apps", "web", "scripts", "load-workspace-environment.ts"),
      "utf8",
    );
    expect(nextConfig).toContain("allowedKeys: WEB_RUNTIME_ENVIRONMENT_KEYS");
    expect(deploymentConfig).toContain("API_ONLY_ENVIRONMENT_KEYS");
    expect(deploymentConfig).toContain('"SMTP_PASSWORD"');
    expect(environmentLoader).not.toContain('"SMTP_PASSWORD"');
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
