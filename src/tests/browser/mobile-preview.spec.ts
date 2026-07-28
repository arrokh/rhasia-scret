import { expect, test } from "@playwright/test";

test("renders the ciphertext-free vault layout at a mobile viewport", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ui-preview");
  await expect(page.getByRole("heading", { level: 1, name: "Akun autentikator" })).toBeVisible();
  const accountMenuTrigger = page.getByLabel("Pengaturan akun");
  await accountMenuTrigger.click();
  await expect(page.getByText("preview@local.invalid")).toBeVisible();
  const triggerBox = await accountMenuTrigger.boundingBox();
  const menuBox = await page.locator('[data-slot="dropdown-menu-content"]').boundingBox();
  expect(Math.abs((triggerBox?.x ?? 0) + (triggerBox?.width ?? 0) - ((menuBox?.x ?? 0) + (menuBox?.width ?? 0)))).toBeLessThan(8);
  await page.keyboard.press("Escape");
  await expect(page.getByText("preview@local.invalid")).toBeHidden();
  await accountMenuTrigger.click();
  await expect(page.getByRole("button", { name: "Keluar" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Brankas" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tambahkan akun autentikator" })).toBeVisible();
  await expect(page.getByText("Brankas Pribadi")).toBeVisible();
  await expect(page.getByText("Tim Operasional")).toBeVisible();
  await expect(page.getByText(/Tidak ada materi akun, passphrase, OTP, atau kunci/)).toBeVisible();
  await expect(page.locator("footer")).toHaveText(/rhasia-scretoleharrokh/);
  const developerLink = page.locator("footer").getByRole("link", { name: "arrokh" });
  await expect(developerLink).toHaveAttribute("href", "https://github.com/arrokh");
  await expect(developerLink).toHaveAttribute("target", "_blank");
  await expect(developerLink).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.locator("footer img")).toHaveCount(0);
  expect(pageErrors).toEqual([]);

  const touchTargets = page.locator("main button, main a");
  for (let index = 0; index < await touchTargets.count(); index += 1) {
    const box = await touchTargets.nth(index).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

test("uses dedicated, consistent Vault navigation and management tabs", async ({ page }) => {
  const pageErrors: Error[] = [];
  let invitationBody: Record<string, unknown> | undefined;
  let defaultPermissionsBody: Record<string, unknown> | undefined;
  let memberPermissionsBody: Record<string, unknown> | undefined;
  let cancelledInvitation = false;
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("**/api/vaults/shared-preview/audit-events**", (route) => {
    const nextPage = new URL(route.request().url()).searchParams.has("cursor");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [{ id: nextPage ? "event-2" : "event-1", eventType: "ACCOUNT_ACCESSED", targetId: "opaque-account-1", actorUserId: "viewer-preview", actorEmail: "viewer@local.invalid", createdAt: nextPage ? "2026-07-26T13:27:00.000Z" : "2026-07-26T13:28:00.000Z" }], nextCursor: nextPage ? null : "audit-page-2" }) });
  });
  await page.route("**/api/shared-vaults/shared-preview/participants**", (route) => {
    const nextPage = new URL(route.request().url()).searchParams.has("cursor");
    const participants = nextPage
      ? [{ key: "invitation:pending-preview", email: "pending@local.invalid", kind: "INVITATION", userId: null, invitationId: "pending-preview", invitedAt: "2026-07-26T12:01:00.000Z" }]
      : [{ key: "member:viewer-preview", email: "viewer@local.invalid", kind: "MEMBER", userId: "viewer-preview", invitationId: null, invitedAt: "2026-07-26T12:00:00.000Z", permissionOverrides: { canAddAccounts: null, canEditAccounts: true, canDeleteAccounts: false }, effectiveAccountPermissions: { permissions: { canAddAccounts: false, canEditAccounts: true, canDeleteAccounts: false }, sources: { canAddAccounts: "VAULT", canEditAccounts: "MEMBER", canDeleteAccounts: "MEMBER" } }, permissionsRevision: 2 }];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owner: { id: "owner-preview", email: "owner@local.invalid" }, vaultDefaultAccountPermissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false }, vaultDefaultAccountPermissionsRevision: 1, participants, nextCursor: nextPage ? null : "participants-page-2" }) });
  });
  await page.route("**/api/shared-vaults/shared-preview/member-permissions", async (route) => {
    defaultPermissionsBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ vaultDefaultAccountPermissions: { canAddAccounts: true, canEditAccounts: false, canDeleteAccounts: false }, vaultDefaultAccountPermissionsRevision: 2 }) });
  });
  await page.route("**/api/shared-vaults/shared-preview/members/viewer-preview", async (route) => {
    memberPermissionsBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ permissionOverrides: { canAddAccounts: null, canEditAccounts: true, canDeleteAccounts: true }, effectiveAccountPermissions: { permissions: { canAddAccounts: false, canEditAccounts: true, canDeleteAccounts: true }, sources: { canAddAccounts: "VAULT", canEditAccounts: "MEMBER", canDeleteAccounts: "MEMBER" } }, permissionsRevision: 3 }) });
  });
  await page.route("**/api/shared-vaults/shared-preview/share-links", async (route) => {
    invitationBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "invitation-preview" }) });
  });
  await page.route("**/api/shared-vaults/shared-preview/share-links/pending-preview", async (route) => {
    cancelledInvitation = true;
    await route.fulfill({ status: 204 });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ui-preview/vaults");

  await expect(page.getByRole("heading", { level: 1, name: "Brankas" })).toBeVisible();
  await expect(page.getByLabel("Kembali ke pratinjau akun")).toBeVisible();
  const vaultLinks = page.locator('[aria-label="Daftar brankas"] li > a');
  await expect(vaultLinks.nth(0)).toContainText("Brankas Pribadi");
  await expect(vaultLinks.nth(0)).toHaveAttribute("href", "/vaults/manage/personal");
  await expect(vaultLinks.nth(1)).toContainText("Tim Operasional");
  await expect(page.getByText("owner@local.invalid")).toBeVisible();
  await expect(page.getByText("Izin akun bawaan anggota")).toBeVisible();
  await page.locator("#vault-default-canAddAccounts").click();
  await page.getByRole("button", { name: "Simpan bawaan anggota" }).click();
  await expect.poll(() => defaultPermissionsBody).toEqual({ expectedRevision: 1, canAddAccounts: true, canEditAccounts: false, canDeleteAccounts: false });
  await page.getByLabel("Lihat audit Layanan contoh viewer@local.invalid").click();
  await expect(page.getByText("Filter: Layanan contoh · viewer@local.invalid")).toBeVisible();
  await expect(page.getByText("Akun autentikator disalin")).toBeVisible();
  await expect(page.getByText(/viewer@local\.invalid · 26 Jul 2026, 20\.28/)).toBeVisible();
  await page.getByRole("button", { name: "Muat lebih banyak aktivitas" }).click();
  await expect(page.getByText("Semua aktivitas telah dimuat.")).toBeVisible();
  await expect(page.getByText(/viewer@local\.invalid · 26 Jul 2026, 20\.27/)).toBeVisible();
  await page.getByRole("tab", { name: "Undangan" }).click();
  await expect(page.getByText("viewer@local.invalid")).toBeVisible();
  await page.getByLabel("Atur izin akun untuk viewer@local.invalid").click();
  await expect(page.getByRole("heading", { name: "Izin akun anggota" })).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(3);
  await page.getByLabel("Hapus akun").click();
  await page.getByRole("option", { name: "Izinkan" }).click();
  await page.getByRole("button", { name: "Simpan izin anggota" }).click();
  await expect.poll(() => memberPermissionsBody).toEqual({ expectedRevision: 2, canAddAccounts: null, canEditAccounts: true, canDeleteAccounts: true });
  await expect(page.getByText("pending@local.invalid")).toHaveCount(0);
  await page.getByRole("button", { name: "Muat lebih banyak pengguna" }).click();
  await expect(page.getByText("pending@local.invalid")).toBeVisible();
  await expect(page.getByText("Semua pengguna telah dimuat.")).toBeVisible();
  await page.getByLabel("Email penerima").fill("viewer@example.test");
  await page.getByRole("button", { name: "Buat undangan" }).click();
  const secureLink = page.getByLabel("Tautan undangan aman");
  await expect(secureLink).toHaveText(/^http:\/\/127\.0\.0\.1:3000\/vaults\/invitations\/redeem#[A-Za-z0-9_-]+$/);
  expect(invitationBody).toEqual({ recipientEmail: "viewer@example.test", linkVerifier: expect.any(String), encryptedPackage: expect.any(String) });
  expect(JSON.stringify(invitationBody)).not.toContain((await secureLink.textContent())?.split("#")[1]);
  await page.getByLabel("Lihat audit viewer@local.invalid").click();
  await expect(page.getByText("Filter: viewer@local.invalid")).toBeVisible();
  await page.getByRole("tab", { name: "Undangan" }).click();
  await page.getByLabel("Hapus pending@local.invalid").click();
  await page.getByRole("button", { name: "Hapus undangan" }).click();
  await expect.poll(() => cancelledInvitation).toBe(true);
  await page.getByRole("tab", { name: "Audit" }).click();
  await expect(page.getByText(/^viewer@local\.invalid ·/)).toBeVisible();
  await expect(page.locator("footer")).toHaveText(/rhasia-scretoleharrokh/);
  const footerDeveloperLink = page.locator("footer").getByRole("link", { name: "arrokh" });
  await expect(footerDeveloperLink).toHaveAttribute("href", "https://github.com/arrokh");
  await expect(footerDeveloperLink).toHaveAttribute("target", "_blank");
  await expect(footerDeveloperLink).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.locator("footer img")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("aligns the shared header action and sticky footer on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/ui-preview/vaults");
  const headerLead = page.locator("main > header > div").first();
  const settings = page.getByLabel("Pengaturan akun");
  const leadBox = await headerLead.boundingBox();
  const settingsBox = await settings.boundingBox();
  expect(Math.abs((leadBox?.y ?? 0) + (leadBox?.height ?? 0) / 2 - ((settingsBox?.y ?? 0) + (settingsBox?.height ?? 0) / 2))).toBeLessThan(2);
  const footerBox = await page.locator("footer").boundingBox();
  expect(Math.abs((footerBox?.y ?? 0) + (footerBox?.height ?? 0) - 900)).toBeLessThan(2);
});

test("requires explicit confirmation for destructive Personal Vault reset", async ({ page }) => {
  let submittedBody: unknown;
  await page.route("**/api/personal-vault/destructive-reset", async (route) => {
    submittedBody = route.request().postDataJSON();
    await route.fulfill({ status: 204 });
  });
  await page.goto("/ui-preview/recovery");

  await expect(page.getByRole("heading", { name: "Hapus data terenkripsi dan mulai ulang" })).toBeVisible();
  await expect(page.getByText(/Brankas Bersama milik orang lain dan data anggotanya tidak akan dihapus/)).toBeVisible();
  const confirmation = page.getByLabel(/Ketik HAPUS DATA BRANKAS/);
  await confirmation.pressSequentially("HAPUS DATA BRANKAS", { delay: 5 });
  await expect(confirmation).toHaveValue("HAPUS DATA BRANKAS");
  await confirmation.press("Tab");
  await page.getByRole("button", { name: "Hapus data dan atur ulang brankas" }).click();

  await expect(page.getByRole("heading", { name: "Atur ulang Brankas Pribadi?" })).toBeVisible();
  expect(submittedBody).toBeUndefined();
  await page.getByRole("button", { name: "Hapus dan atur ulang" }).click();
  await expect.poll(() => submittedBody).toEqual({ confirmation: "HAPUS DATA BRANKAS" });
});
