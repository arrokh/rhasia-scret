import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`keeps the journey separate from the final CTA and recovers on reverse at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/landing");
    const scene = page.locator("[data-landing-desktop-scene]");
    await expect(scene).toHaveAttribute("data-input-ready", "true");
    for (const step of ["unlocked", "devices", "settled"]) {
      await page.keyboard.press("PageDown");
      await expect(scene).toHaveAttribute("data-scene-step", step, { timeout: 20_000 });
    }
    const phone = page.locator('[data-landing-primary-phone] iframe[data-device-kind="phone"]');
    const finalCta = page.locator('[data-slot="landing-final-cta"]');
    for (const topOffset of [0, 100, 300]) {
      await finalCta.evaluate((element, offset) => {
        window.scrollTo({
          top: window.scrollY + element.getBoundingClientRect().top - window.innerHeight + 200 + offset,
          behavior: "instant",
        });
      }, topOffset);
      await expect
        .poll(async () => {
          if (!(await phone.isVisible())) return true;
          const frame = await phone.boundingBox();
          const card = await finalCta.boundingBox();
          if (!frame || !card) return true;
          return frame.y + frame.height <= card.y;
        })
        .toBe(true);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect(scene).toHaveAttribute("data-scene-step", "settled");
    await page.keyboard.press("PageUp");
    await expect(scene).toHaveAttribute("data-scene-step", "devices", { timeout: 20_000 });
    await page.keyboard.press("PageUp");
    await expect(scene).toHaveAttribute("data-scene-step", "unlocked", { timeout: 20_000 });
    await expect
      .poll(async () => {
        const bounds = await phone.boundingBox();
        return Boolean(
          bounds &&
          bounds.y >= 0 &&
          bounds.y + bounds.height <= viewport.height &&
          bounds.x >= 0 &&
          bounds.x + bounds.width <= viewport.width,
        );
      })
      .toBe(true);
    await expect(phone.contentFrame().locator("[data-unlock-phase]")).toHaveAttribute("data-unlock-phase", "unlocked");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
