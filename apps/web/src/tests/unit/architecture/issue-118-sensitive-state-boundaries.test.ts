import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("issue 118 architecture and sensitive-state boundaries", () => {
  it("keeps the Local Vault session application seam platform-neutral", () => {
    const session = read("src/modules/local-vault/application/local-vault-session.ts");
    expect(session).not.toMatch(
      /from ["'](?:next|react|react-native|expo|@prisma|@supabase)|\bwindow\b|\bdocument\b|\bnavigator\b|indexedDB|localStorage|sessionStorage/,
    );
  });

  it("keeps Local Vault plaintext state outside Query and persistent caches", () => {
    const localVaultSources = [
      "src/modules/local-vault/application/local-vault-session.ts",
      "src/modules/local-vault/infrastructure/browser-local-vault-session.ts",
      "src/modules/local-vault/presentation/use-local-vault-session.ts",
      "src/modules/local-vault/presentation/local-vault-page.tsx",
      "src/modules/local-vault/presentation/local-vault-copy-panel.tsx",
    ]
      .map(read)
      .join("\n");
    expect(localVaultSources).not.toMatch(/@tanstack\/react-query|useQuery|useMutation|queryClient/i);
    expect(localVaultSources).not.toMatch(/localStorage|sessionStorage|CacheStorage|caches\.|console\./i);
  });

  it("keeps presentation free of direct hosted transport calls", () => {
    const presentationSources = [
      "src/modules/authenticator-account/presentation/personal-vault-accounts.tsx",
      "src/modules/local-vault/presentation/local-vault-page.tsx",
      "src/modules/local-vault/presentation/local-vault-copy-panel.tsx",
      "../mobile/src/presentation/mobile-personal-vault.tsx",
      "../mobile/src/presentation/mobile-authenticator-accounts.tsx",
    ]
      .map(read)
      .join("\n");
    expect(presentationSources).not.toMatch(
      /\.request\s*\(|browserApiClient\.(?:get|post|put|patch|delete)\s*\(|\bfetch\s*\(/,
    );
  });

  it("keeps lifecycle and Local Vault cleanup explicit", () => {
    const nativeLifecycle = read("../mobile/src/infrastructure/mobile-workspace-lifecycle.ts");
    const localSession = read("src/modules/local-vault/application/local-vault-session.ts");
    expect(nativeLifecycle).toContain("clearUnlockedVaultWorkspace");
    expect(nativeLifecycle).toContain("WorkspaceLifecycleCancelledError");
    expect(localSession).toContain("this.ports.clearVault(previous)");
    expect(localSession).toContain("this.clearCurrentVault()");
  });
});
