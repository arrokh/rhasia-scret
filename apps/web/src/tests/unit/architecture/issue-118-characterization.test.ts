import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = join(process.cwd(), "../..");
const source = (path: string) => readFileSync(join(repositoryRoot, path), "utf8");

describe("issue 118 seam characterization", () => {
  it("records the repeated authenticated mutation sequence", () => {
    for (const path of [
      "apps/web/src/app/api/vaults/[vaultId]/accounts/route.ts",
      "apps/web/src/app/api/shared-vaults/[vaultId]/accounts/route.ts"
    ]) {
      const route = source(path);
      expect(route).toContain("loadApplicationUser");
      expect(route).toContain("canAccessApplication");
      expect(route).toContain('rateLimitApplicationUser("account_mutation"');
    }
  });

  it("records identical hosted account endpoint selection on web and native", () => {
    const browser = source("apps/web/src/modules/authenticator-account/infrastructure/browser-authenticator-account-client.ts");
    const native = source("apps/mobile/src/infrastructure/mobile-authenticator-account.ts");
    for (const implementation of [browser, native]) {
      expect(implementation).toContain("/api/vaults/");
      expect(implementation).toContain("/api/shared-vaults/");
      expect(implementation).toContain("/accounts");
    }
  });

  it("records native presentation-owned workspace lifecycle policy", () => {
    const native = source("apps/mobile/src/presentation/mobile-personal-vault.tsx");
    expect(native).toContain("AppState.addEventListener");
    expect(native).toContain("clearUnlockedVaultWorkspace");
    expect(native).toContain("refreshMobileVaultWorkspace");
  });

  it("records duplicated Local Vault session ownership by consuming surface", () => {
    for (const path of [
      "apps/web/src/modules/local-vault/presentation/local-vault-page.tsx",
      "apps/web/src/modules/local-vault/presentation/local-vault-copy-panel.tsx"
    ]) {
      const presentation = source(path);
      expect(presentation).toContain("readLocalVaultRecord");
      expect(presentation).toContain("unlockLocalVault");
      expect(presentation).toContain("clearUnlockedLocalVault");
    }
  });
});
