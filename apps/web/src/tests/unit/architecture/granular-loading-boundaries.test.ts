import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const granularVaultPages = [
  "src/app/vaults/accounts/new/page.tsx",
  "src/app/vaults/backup/page.tsx",
  "src/app/vaults/import/page.tsx",
  "src/app/vaults/invitations/redeem/page.tsx",
  "src/app/vaults/manage/page.tsx",
  "src/app/vaults/manage/new/page.tsx",
  "src/app/vaults/manage/personal/page.tsx",
  "src/app/vaults/manage/[vaultId]/page.tsx",
  "src/app/vaults/recovery/page.tsx"
];

describe("granular loading boundaries", () => {
  it.each(granularVaultPages)("keeps the stable page frame outside protected asynchronous content in %s", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("<VaultPageFrame");
    expect(source).toMatch(/async function \w+Content/);
    expect(source).toContain("loadVaultPageContext()");
  });

  it("scopes action and body fallbacks to independent Suspense boundaries", () => {
    const source = readFileSync("src/modules/vault-management/presentation/vault-page-frame.tsx", "utf8");
    expect(source.match(/<Suspense/g)).toHaveLength(2);
    expect(source).toContain("<ActionLoadingPlaceholder");
    expect(source).toContain("<SectionLoadingPlaceholder");
  });

  it("uses exact-region placeholders for permission defaults, participants, and audit history", () => {
    const membership = readFileSync("src/modules/vault-membership/presentation/vault-membership-owner-panel.tsx", "utf8");
    const audit = readFileSync("src/modules/audit/presentation/vault-audit-history.tsx", "utf8");
    expect(membership).toContain("defaults.isPending");
    expect(membership).toContain("<FormLoadingPlaceholder");
    expect(membership).toContain("<SectionLoadingPlaceholder rows={2}");
    expect(audit).toContain("<SectionLoadingPlaceholder rows={3}");
  });
});
