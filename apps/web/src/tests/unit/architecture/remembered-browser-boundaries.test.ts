import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Remembered Browser production boundaries", () => {
  it("wires online unlock through fresh authorization while preserving the passphrase fallback", () => {
    const unlock = source("src/modules/authenticator-account/presentation/vault-workspace-unlock.tsx");
    const workspace = source(
      "../../packages/client-vault-core/src/modules/authenticator-account/application/vault-workspace.ts",
    );
    expect(unlock).toContain("loadUnlockedVaultWorkspaceWithRememberedBrowser");
    expect(unlock).toContain('t("localVerification")');
    expect(unlock).toContain('t("passphrase")');
    expect(workspace).toMatch(
      /fetchMeasuredAuthorizedOfflineBundle\(\{ personalVaultId \}, ports\)[\s\S]+ports\.crypto\.recoverUserRootKeyWithRememberedBrowser/,
    );
  });

  it("offers enrollment only inside an online Unlocked Vault Session security surface", () => {
    const accounts = source("src/modules/authenticator-account/presentation/personal-vault-accounts.tsx");
    const enrollment = source("src/modules/crypto/presentation/remembered-browser-enrollment.tsx");
    expect(accounts).toContain("workspace.userRootKey");
    expect(accounts).toContain("RememberedBrowserEnrollment");
    expect(enrollment).toContain("useOnlineStatus");
    expect(enrollment).toContain('useTranslations("Crypto.rememberedBrowser")');
    expect(source("messages/id.json")).toContain("WebAuthn PRF");
    expect(enrollment).not.toMatch(/@tanstack\/react-query|localStorage|sessionStorage/);
  });

  it("clears application-owned packages on logout, reset, and explicit device removal", () => {
    const logout = source("src/modules/identity/infrastructure/browser-session-client.ts");
    const reset = source("src/modules/vault-management/presentation/destructive-personal-vault-reset-form.tsx");
    const offline = source("src/modules/sync/presentation/offline-vault-shell.tsx");
    expect(logout).toContain("clearAllOfflineVaultData()");
    expect(logout.indexOf("requestLocalVaultLock()")).toBeLessThan(logout.indexOf("clearAllOfflineVaultData()"));
    expect(logout.indexOf("clearAllOfflineVaultData()")).toBeLessThan(logout.indexOf('post("/auth/logout")'));
    expect(reset).toContain("clearAllOfflineVaultData()");
    expect(offline).toContain("repository.clearAll()");
  });

  it("keeps its interactive test harness unavailable in production", () => {
    const preview = source("src/app/ui-preview/remembered-browser/page.tsx");
    expect(preview).toContain('process.env.NODE_ENV === "production"');
    expect(preview).toContain("notFound()");
  });
});
