import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const protectedPages = [
  "src/app/vaults/page.tsx",
  "src/app/vaults/accounts/new/page.tsx",
  "src/app/vaults/backup/page.tsx",
  "src/app/vaults/import/page.tsx",
  "src/app/vaults/invitations/redeem/page.tsx",
  "src/app/vaults/manage/page.tsx",
  "src/app/vaults/manage/new/page.tsx",
  "src/app/vaults/manage/personal/page.tsx",
  "src/app/vaults/manage/[vaultId]/page.tsx",
  "src/app/vaults/recovery/page.tsx"
] as const;

describe("sign-in routing inventory", () => {
  it.each(protectedPages)("routes authorization in %s through the protected Vault page context", (path) => {
    const page = readFileSync(resolve(process.cwd(), path), "utf8");

    expect(page).toContain("loadVaultPageContext");
    expect(page).not.toContain('redirect("/")');
  });

  it("redirects missing or inactive protected context to sign in", () => {
    const loader = readFileSync(resolve(process.cwd(), "src/app/vaults/load-vault-page-context.ts"), "utf8");
    expect(loader).toContain('redirect("/sign-in")');
  });
});
