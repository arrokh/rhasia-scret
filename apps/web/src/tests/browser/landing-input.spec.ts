import { expect, test } from "@playwright/test";

test("keeps keyboard traversal and input usable during processing while blocking link navigation", async ({ page }) => {
  await page.goto("/landing");
  const scene = page.locator('[data-landing-desktop-scene="true"]');
  await expect(scene).toHaveAttribute("data-scene-step", "locked");
  await expect(scene).toHaveAttribute("data-input-ready", "true");

  await page.mouse.wheel(0, 500);
  await expect(scene).toHaveAttribute("data-scene-step", "unlocking");
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "landing-processing-input-test";
    input.style.position = "fixed";
    input.style.top = "0";
    input.style.left = "0";
    const link = document.createElement("a");
    link.id = "landing-processing-link-test";
    link.href = "/sign-in";
    link.textContent = "Processing navigation test";
    link.style.position = "fixed";
    link.style.top = "32px";
    link.style.left = "0";
    document.body.append(input, link);
  });

  const input = page.locator("#landing-processing-input-test");
  const link = page.locator("#landing-processing-link-test");
  await input.fill("input remains usable");
  await input.focus();
  const keyDefaults = await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>("#landing-processing-input-test");
    if (!field) throw new Error("The processing input is unavailable.");
    const arrow = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    field.dispatchEvent(arrow);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    window.dispatchEvent(escape);
    const navigation = new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true });
    window.dispatchEvent(navigation);
    return {
      arrowPrevented: arrow.defaultPrevented,
      escapePrevented: escape.defaultPrevented,
      navigationPrevented: navigation.defaultPrevented,
    };
  });
  expect(keyDefaults).toEqual({ arrowPrevented: false, escapePrevented: false, navigationPrevented: true });
  await expect(scene).toHaveAttribute("data-scene-step", "unlocking");
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/landing$/);
  await expect(scene).toHaveAttribute("data-scene-step", "unlocking");
});

test("treats a wheel direction reversal as a new discrete gesture", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/landing");
  const scene = page.locator('[data-landing-desktop-scene="true"]');
  await expect(scene).toHaveAttribute("data-input-ready", "true");

  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "unlocked", { timeout: 15_000 });
  await page.mouse.wheel(0, 500);
  await expect(scene).toHaveAttribute("data-scene-step", "devices");
  await page.mouse.wheel(0, -500);
  await expect(scene).toHaveAttribute("data-scene-step", "unlocked");
});

test("resets a canceled touch gesture before accepting another move", async ({ page }) => {
  await page.goto("/landing");
  const scene = page.locator('[data-landing-desktop-scene="true"]');
  await expect(scene).toHaveAttribute("data-scene-step", "locked");
  await expect(scene).toHaveAttribute("data-input-ready", "true");

  await page.evaluate(() => {
    const dispatchTouch = (type: string, clientY: number | null) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", {
        value: clientY === null ? [] : [{ clientY }],
      });
      window.dispatchEvent(event);
    };
    dispatchTouch("touchstart", 300);
    dispatchTouch("touchcancel", null);
    dispatchTouch("touchmove", 250);
  });

  await expect(scene).toHaveAttribute("data-scene-step", "locked");
});

test("lets the hero card scroll before advancing the intro at its boundary", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/landing");
  const scene = page.locator('[data-landing-desktop-scene="true"]');
  await expect(scene).toHaveAttribute("data-input-ready", "true");
  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "unlocked", { timeout: 15_000 });
  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "devices");

  const hero = scene.locator('[data-landing-intro-scroll="true"]');
  await expect.poll(() => hero.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await hero.focus();
  await page.keyboard.press("PageDown");
  await expect.poll(() => hero.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(scene).toHaveAttribute("data-scene-step", "devices");

  await hero.evaluate((element) => {
    element.scrollTop = 0;
  });
  const touchMovePrevented = await hero.evaluate((container) => {
    const dispatchTouch = (type: string, clientY: number | null) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: clientY === null ? [] : [{ clientY }] });
      container.dispatchEvent(event);
      return event;
    };
    dispatchTouch("touchstart", 300);
    const movePrevented = dispatchTouch("touchmove", 100).defaultPrevented;
    dispatchTouch("touchend", null);
    return movePrevented;
  });
  expect(touchMovePrevented).toBe(false);
  await expect(scene).toHaveAttribute("data-scene-step", "devices");

  const bounds = await hero.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => hero.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(scene).toHaveAttribute("data-scene-step", "devices");

  await hero.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await hero.focus();
  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "leaving");
});

test("does not reverse when natural scrolling reaches the page top", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/landing");
  const scene = page.locator('[data-landing-desktop-scene="true"]');
  await expect(scene).toHaveAttribute("data-input-ready", "true");

  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "unlocked", { timeout: 15_000 });
  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "devices");
  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "settled", { timeout: 20_000 });

  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1);
  await page.mouse.wheel(0, -10_000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
  await expect(scene).toHaveAttribute("data-scene-step", "settled");

  await page.evaluate(() => {
    const dispatchTouch = (type: string, clientY: number | null) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: clientY === null ? [] : [{ clientY }] });
      window.dispatchEvent(event);
    };
    window.scrollTo({ top: 500, behavior: "instant" });
    dispatchTouch("touchstart", 300);
    window.scrollTo({ top: 0, behavior: "instant" });
    dispatchTouch("touchmove", 360);
    dispatchTouch("touchend", null);
  });
  await expect(scene).toHaveAttribute("data-scene-step", "settled");
  await page.waitForTimeout(500);
  await page.mouse.wheel(0, -500);
  await expect(scene).toHaveAttribute("data-scene-step", "returning");
});
