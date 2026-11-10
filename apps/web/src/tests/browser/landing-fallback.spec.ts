import { expect, test } from "@playwright/test";

test("keeps local-vault navigation usable by keyboard when landing models fail", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  let failedModelRequests = 0;
  await page.route("**/models/landing/*.glb", (route) => {
    failedModelRequests += 1;
    return route.abort();
  });

  await page.goto("/landing");
  const scene = page.locator("[data-landing-desktop-scene]:visible");
  await expect(scene).toHaveAttribute("data-input-ready", "true");
  await expect(scene.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(scene.locator('a[href="/local?from=landing"]')).toBeVisible();
  await expect(scene.locator('a[href="/sign-in"]')).toBeVisible();
  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "unlocked", { timeout: 20_000 });
  await expect(page.locator("[data-landing-primary-phone] [data-landing-phone-fallback-frame]")).toBeVisible();
  expect(failedModelRequests).toBeGreaterThan(0);

  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "devices", { timeout: 20_000 });
  const localVaultLink = scene.locator('a[href="/local?from=landing"]');
  await expect(localVaultLink).toBeVisible();
  await localVaultLink.focus();
  await expect(localVaultLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/local\?from=landing$/);
});

test("enters Local Vault without starting the intro", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/landing");
  const scene = page.locator("[data-landing-desktop-scene]");
  await expect(scene).toHaveAttribute("data-scene-step", "locked");
  const localVault = scene.getByRole("link", { name: "Coba Local Vault", exact: true });
  await expect(localVault).toBeVisible();
  await localVault.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/local\?from=landing$/);
});

test("can skip a running intro and read the journey when models fail", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/models/landing/*.glb", (route) => route.abort());
  await page.goto("/landing");
  const scene = page.locator("[data-landing-desktop-scene]");
  await expect(scene).toHaveAttribute("data-input-ready", "true");
  await page.getByRole("button", { name: "Jelajahi demo", exact: true }).click();
  await expect(scene).toHaveAttribute("data-scene-step", "unlocking");
  await page.locator("[data-landing-header]").getByRole("button", { name: "Pilih bahasa" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Lewati intro", exact: true }).click();
  await expect(scene).toHaveAttribute("data-scene-step", "settled");
  await expect(page.locator("#landing-journey-title")).toBeFocused();
  await expect(page.locator('[data-landing-primary-phone] [data-landing-phone-screen-entry="accounts"]')).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await expect(scene).toHaveAttribute("data-scene-step", "settled");
});
