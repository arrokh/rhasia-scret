import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const approvedProviderPaths = [
  join(process.cwd(), "src/modules/identity"),
  join(process.cwd(), "src/app/auth/confirm"),
];
const forbiddenProviderImports = /from ["'](?:openid-client|jose)|require\(["'](?:openid-client|jose)/;

describe("provider-neutral identity boundaries", () => {
  it("keeps provider SDK and protocol imports in Identity infrastructure or auth entry points", () => {
    const violations: string[] = [];
    for (const root of ["src/app", "src/modules", "src/proxy.ts"].map((path) => join(process.cwd(), path))) {
      for (const file of sourceFiles(root)) {
        if (approvedProviderPaths.some((allowed) => file.startsWith(`${allowed}/`))) continue;
        if (forbiddenProviderImports.test(readFileSync(file, "utf8"))) violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  it("retires the TypeScript API and active Prisma schema while preserving read-only history", () => {
    for (const path of ["../api/src", "../api/prisma/schema.prisma", "../api/prisma.config.ts"]) {
      expect(existsSync(join(process.cwd(), path))).toBe(false);
    }
    expect(existsSync(join(process.cwd(), "../api/prisma/archive"))).toBe(true);
    const apiTools = JSON.parse(readFileSync(join(process.cwd(), "../api/package.json"), "utf8")) as {
      name: string;
      dependencies?: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(apiTools.name).toBe("@rhasia-scret/api-test-tools");
    expect(apiTools.dependencies).toBeUndefined();
    expect(Object.keys(apiTools.devDependencies)).not.toContain("hono");
    expect(Object.keys(apiTools.devDependencies)).not.toContain("prisma");
    expect(Object.keys(apiTools.devDependencies)).not.toContain("@prisma/client");
  });

  it("keeps External Identity unique by issuer and subject in the Sqitch schema", () => {
    const schema = readFileSync(join(process.cwd(), "../api/db/sqitch/deploy/init.sql"), "utf8");
    expect(schema).toContain("CREATE TABLE public.external_identities");
    expect(schema).toContain("CREATE UNIQUE INDEX external_identities_issuer_subject_key");
    expect(schema).not.toMatch(/CREATE UNIQUE INDEX [^;]*external_identities[^;]*email/);
  });

  it("keeps Go authentication passwordless and rejects unsupported identity providers", () => {
    const apiRoot = join(process.cwd(), "../api");
    const authConfiguration = readFileSync(join(apiRoot, "internal/adapter/identity/auth_configuration.go"), "utf8");
    const authTests = readFileSync(join(apiRoot, "internal/adapter/identity/auth_configuration_test.go"), "utf8");
    expect(authConfiguration).toContain('AuthBackendPasswordless AuthBackend = "passwordless"');
    expect(authConfiguration).toContain("AUTH_BACKEND must be none or passwordless");
    expect(authTests).toContain('AuthBackend = "oidc"');
  });
});

function sourceFiles(directory: string): string[] {
  if (statSync(directory).isFile()) return /\.(?:ts|tsx)$/.test(directory) ? [directory] : [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return sourceFiles(path);
  });
}
