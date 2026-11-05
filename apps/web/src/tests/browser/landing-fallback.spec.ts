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
