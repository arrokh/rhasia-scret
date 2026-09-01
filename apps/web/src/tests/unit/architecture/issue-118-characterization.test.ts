import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = join(process.cwd(), "../..");
const source = (path: string) => readFileSync(join(repositoryRoot, path), "utf8");

describe("issue 118 seam characterization", () => {
  it("keeps account routes behind the authenticated execution seam", () => {
    for (const path of [
      "apps/web/src/app/api/vaults/[vaultId]/accounts/route.ts",
      "apps/web/src/app/api/shared-vaults/[vaultId]/accounts/route.ts"
    ]) {
      const route = source(path);
      expect(route).not.toContain("loadApplicationUser");
      expect(route).not.toContain("canAccessApplication");
      expect(route).not.toContain("rateLimitApplicationUser");
      expect(route).toContain('operation: "account_mutation"');
    }
  });

  it("keeps web and native account adapters behind the shared hosted protocol", () => {
    const browser = source("apps/web/src/modules/authenticator-account/infrastructure/browser-authenticator-account-client.ts");
    const native = source("apps/mobile/src/infrastructure/mobile-authenticator-account.ts");
    expect(browser).toContain("HostedAuthenticatorAccountTransport");
    expect(native).toContain("HostedAuthenticatorAccountTransport");
    expect(browser).not.toContain("/api/vaults/");
    expect(native).not.toContain("/api/vaults/");
  });

  it("keeps conditional offline-bundle retrieval behind one shared protocol", () => {
    for (const path of [
      "apps/web/src/modules/sync/infrastructure/browser-offline-sync-client.ts",
      "apps/mobile/src/infrastructure/mobile-vault-workspace.ts"
    ]) {
      const implementation = source(path);
      expect(implementation).toContain("AuthorizedOfflineBundleTransport");
      expect(implementation).not.toContain('url: "/api/sync/offline-bundle"');
      expect(implementation).not.toContain('"if-none-match"');
    }
  });

  it("keeps native workspace lifecycle policy behind the shared controller", () => {
    const native = source("apps/mobile/src/presentation/mobile-personal-vault.tsx");
    expect(native).toContain("useMobileWorkspaceLifecycle");
    expect(native).not.toContain("AppState.addEventListener");
    expect(native).not.toContain("clearUnlockedVaultWorkspace");
    expect(native).not.toContain("refreshMobileVaultWorkspace");
  });

  it("keeps each Local Vault surface behind an independently scoped session", () => {
    for (const path of [
      "apps/web/src/modules/local-vault/presentation/local-vault-page.tsx",
      "apps/web/src/modules/local-vault/presentation/local-vault-copy-panel.tsx"
    ]) {
      const presentation = source(path);
      expect(presentation).toContain("useLocalVaultSession");
      expect(presentation).not.toContain("readLocalVaultRecord");
      expect(presentation).not.toContain("unlockLocalVault");
      expect(presentation).not.toContain("clearUnlockedLocalVault");
    }
  });
});
