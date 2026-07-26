import { expect, test } from "@playwright/test";

test("renders the ciphertext-free vault layout at a mobile viewport", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: "Brankas Bersama" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tambahkan akun autentikator" })).toBeVisible();
  await expect(page.getByText("Brankas Pribadi")).toBeVisible();
  await expect(page.getByText("Tim Operasional")).toBeVisible();
  await expect(page.getByText(/Tidak ada materi akun, passphrase, OTP, atau kunci/)).toBeVisible();

  const touchTargets = page.locator("main button, main a");
  for (let index = 0; index < await touchTargets.count(); index += 1) {
    const box = await touchTargets.nth(index).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
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
  await page.getByLabel(/Ketik HAPUS DATA BRANKAS/).fill("HAPUS DATA BRANKAS");
  await page.getByRole("button", { name: "Hapus data dan atur ulang brankas" }).click();

  await expect(page.getByRole("heading", { name: "Atur ulang Brankas Pribadi?" })).toBeVisible();
  expect(submittedBody).toBeUndefined();
  await page.getByRole("button", { name: "Hapus dan atur ulang" }).click();
  await expect.poll(() => submittedBody).toEqual({ confirmation: "HAPUS DATA BRANKAS" });
});
