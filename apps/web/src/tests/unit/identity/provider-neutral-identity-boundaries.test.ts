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

  it("omits provider-specific sign-in and incomplete identity-linking entry points", () => {
    const removedEntries = [
      "src/app/auth/oidc",
      "src/modules/identity/infrastructure/oidc-client.ts",
      "src/modules/identity/infrastructure/oidc-session-verifier.ts",
      "src/modules/identity/application/identity-linking.ts",
      "../api/src/modules/identity/application/identity-linking.ts",
      "../api/src/modules/identity/infrastructure/prisma-identity-link-repository.ts",
    ];
    for (const path of removedEntries) expect(existsSync(join(process.cwd(), path))).toBe(false);
  });

  it("models External Identity independently from Application User and uniquely by issuer and subject", () => {
    const schema = readFileSync(join(process.cwd(), "../api/prisma/schema.prisma"), "utf8");
    expect(schema).toContain("model ExternalIdentity");
    expect(schema).toContain("@@unique([issuer, subject])");
    expect(schema).toContain("externalIdentities        ExternalIdentity[]");
    expect(schema).not.toMatch(/email\s+String\s+@unique/);
  });
});

function sourceFiles(directory: string): string[] {
  if (statSync(directory).isFile()) return /\.(?:ts|tsx)$/.test(directory) ? [directory] : [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return sourceFiles(path);
  });
}
