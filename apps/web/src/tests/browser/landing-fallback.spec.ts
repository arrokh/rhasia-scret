import { expect, test } from "@playwright/test";

test("uses the styled fallback when a phone iframe stylesheet fails", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = "/__landing_stylesheet_fixture.css";
        document.head.append(stylesheet);
      },
      { once: true },
    );
  });
  let blockedStylesheets = 0;
  await page.route("**/__landing_stylesheet_fixture.css", (route) => {
    if (route.request().frame().parentFrame()) {
      blockedStylesheets += 1;
      return route.abort();
    }
    return route.fulfill({ contentType: "text/css", body: "/* synthetic stylesheet fixture */" });
  });
  await page.goto("/landing");
  const scene = page.locator("[data-landing-desktop-scene]:visible");
  await expect(scene).toHaveAttribute("data-input-ready", "true");
  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "unlocked", { timeout: 20_000 });
  await expect(page.locator("[data-landing-primary-phone] [class*=__phoneFallbackFrame]")).toBeVisible();
  expect(blockedStylesheets).toBeGreaterThan(0);
});

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`finishes an early unlock and keeps navigation available when models fail (${reducedMotion})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/models/landing/*.glb", (route) => route.abort());
    await page.goto("/landing");
    const scene = page.locator("[data-landing-desktop-scene]:visible");
    await expect(scene).toHaveAttribute("data-input-ready", "true");
    await page.keyboard.press("PageDown");
    await expect(scene).toHaveAttribute("data-scene-step", "unlocked", { timeout: 20_000 });
    const fallback = page.locator("[data-landing-primary-phone] [class*=__phoneFallbackFrame]");
    await expect(fallback).toBeVisible();
    expect(await fallback.evaluate((element) => getComputedStyle(element).transform)).not.toBe("none");
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(async () => {
          const frame = await fallback.boundingBox();
          return Boolean(
            frame &&
            frame.x >= 0 &&
            frame.y >= 0 &&
            frame.x + frame.width <= viewport.width &&
            frame.y + frame.height <= viewport.height,
          );
        })
        .toBe(true);
    }

    await page.keyboard.press("PageDown");
    await expect(scene).toHaveAttribute("data-scene-step", "devices", { timeout: 20_000 });
    await expect(scene).toHaveAttribute("aria-busy", "false");
    await expect(scene.locator('a[href="/local?from=landing"]')).toBeVisible();
    await page.keyboard.press("PageDown");
    await expect(scene).toHaveAttribute("data-scene-step", "settled", { timeout: 20_000 });
  });
}
