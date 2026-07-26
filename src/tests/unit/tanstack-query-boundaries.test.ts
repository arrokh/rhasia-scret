import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("TanStack Query boundaries", () => {
  it("centralizes browser HTTP transport in the shared API client", () => {
    const fetchFiles = sourceFiles(sourceRoot)
      .filter((path) => !path.includes("/app/") && !path.includes("/tests/"))
      .filter((path) => /\bfetch\(/.test(readFileSync(path, "utf8")))
      .map((path) => relative(process.cwd(), path));

    expect(fetchFiles).toEqual(["src/shared/infrastructure/browser-api-client.ts"]);
  });

  it("keeps every context-owned React Query operation in a presentation hook", () => {
    const queryImports = sourceFiles(join(sourceRoot, "modules"))
      .filter((path) => readFileSync(path, "utf8").includes("@tanstack/react-query"))
      .map((path) => relative(process.cwd(), path));

    expect(queryImports).toEqual([
      "src/modules/authenticator-account/presentation/hooks/use-authenticator-account-mutations.ts",
      "src/modules/identity/presentation/hooks/use-passkey-recovery-status-query.ts",
      "src/modules/identity/presentation/hooks/use-session-mutations.ts",
      "src/modules/otp-runtime/presentation/hooks/use-server-time-query.ts",
      "src/modules/vault-management/presentation/hooks/use-personal-vault-mutations.ts",
      "src/modules/vault-management/presentation/hooks/use-shared-vault-mutations.ts",
      "src/modules/vault-management/presentation/hooks/use-vault-audit-query.ts",
      "src/modules/vault-membership/presentation/hooks/use-vault-participants.ts"
    ]);
  });

  it("installs one root provider without persistence", () => {
    const layout = readFileSync(join(sourceRoot, "app/layout.tsx"), "utf8");
    const provider = readFileSync(join(sourceRoot, "shared/presentation/query-provider.tsx"), "utf8");

    expect(layout).toContain("<QueryProvider>");
    expect(layout).toContain("{children}<AppFooter />");
    expect(provider).toContain("new QueryClient");
    expect(provider).not.toMatch(/persist|localStorage|sessionStorage|indexedDB/i);
  });
});
