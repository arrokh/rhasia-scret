import { expect, test } from "@playwright/test";

test("keeps the Vault shell stable while only the selected async tab shows a placeholder", async ({ page }) => {
  let participantsRoute: Parameters<Parameters<typeof page.route>[1]>[0] | undefined;
  let auditRoute: Parameters<Parameters<typeof page.route>[1]>[0] | undefined;
  await page.route("**/api/shared-vaults/shared-preview/participants**", async (route) => {
    participantsRoute = route;
  });
  await page.route("**/api/vaults/shared-preview/audit-events**", async (route) => {
    auditRoute = route;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ui-preview/vaults");

  await page.getByRole("tab", { name: "Undangan" }).click();
  await expect(page.getByRole("status", { name: "Memuat pengguna…" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Brankas" })).toBeVisible();
  await expect(page.getByText("Undang melalui email")).toBeVisible();
  await participantsRoute?.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      owner: { id: "owner-preview", email: "owner@local.invalid" },
      vaultDefaultAccountPermissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false },
      vaultDefaultAccountPermissionsRevision: 1,
      participants: [],
      nextCursor: null,
    }),
  });
  await expect(page.getByText("Belum ada pengguna yang diundang.")).toBeVisible();

  await page.getByRole("tab", { name: "Audit" }).click();
  await expect(page.getByRole("status", { name: "Memuat riwayat audit…" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Brankas" })).toBeVisible();
  await auditRoute?.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ events: [], nextCursor: null }),
  });
  await expect(page.getByText("Belum ada aktivitas")).toBeVisible();
});
