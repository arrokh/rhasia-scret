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
  it.each(protectedPages)("sends unauthorized server rendering in %s to sign in", (path) => {
    const page = readFileSync(resolve(process.cwd(), path), "utf8");

    expect(page).toContain('redirect("/sign-in")');
    expect(page).not.toContain('redirect("/")');
  });
});
