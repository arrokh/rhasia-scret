import { expect, test } from "@playwright/test";

test("distinguishes the sign-in action from the external self-hosting guide", async ({ page }) => {
  await page.goto("/landing");
  const actions = page.locator('[data-slot="landing-final-cta"]');
  await expect(actions.locator('a[href="/sign-in"] svg')).toHaveClass(/lucide-log-in/);
  await expect(actions.locator('a[target="_blank"] svg')).toHaveClass(/lucide-arrow-up-right/);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 2056, height: 1166 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
]) {
  test(`keeps every intro scroll cue at the viewport bottom at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/landing");
    const scene = page.locator("[data-landing-desktop-scene]");
    const cue = scene.locator("[data-landing-scroll-cue]");
    await expect(scene).toHaveAttribute("data-input-ready", "true");
    await expect(cue).toHaveCount(1);
    let initialTop: number | undefined;
    for (const step of ["locked", "unlocked", "devices"]) {
      if (step !== "locked") await page.keyboard.press("PageDown");
      await expect(scene).toHaveAttribute("data-scene-step", step, { timeout: 20_000 });
      await expect(cue).toHaveAttribute("aria-hidden", "false");
      await expect(cue).toBeVisible();
      await expect
        .poll(async () => {
          const bounds = await cue.boundingBox();
          if (!bounds) return false;
          const bottomGap = viewport.height - bounds.y - bounds.height;
          return bounds.y >= viewport.height * 0.8 && bottomGap >= 8 && bottomGap <= 48;
        })
        .toBe(true);
      const bounds = await cue.boundingBox();
      if (!bounds) throw new Error("The scroll cue is unavailable.");
      initialTop ??= bounds.y;
      expect(Math.abs(bounds.y - initialTop)).toBeLessThanOrEqual(1);
    }
    if (viewport.width === 844) {
      const intro = scene.locator("[data-landing-intro-scroll]");
      await intro.focus();
      await page.keyboard.press("PageDown");
      await expect.poll(async () => intro.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await expect(scene).toHaveAttribute("data-scene-step", "devices");
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(Math.abs((await cue.boundingBox())!.y - initialTop!)).toBeLessThanOrEqual(1);
    }
  });
}

test("dissolves only the phone screen when the active journey card changes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/landing");
  const scene = page.locator("[data-landing-desktop-scene]");
  await expect(scene).toHaveAttribute("data-input-ready", "true");
  for (const step of ["unlocked", "devices", "settled"]) {
    await page.keyboard.press("PageDown");
    await expect(scene).toHaveAttribute("data-scene-step", step, { timeout: 20_000 });
  }
  const phone = page.locator('[data-landing-primary-phone] iframe[data-device-kind="phone"]');
  const originalBounds = await phone.boundingBox();
  for (const view of ["scan", "review", "added", "sharedPermissions"]) {
    await page.locator(`[class*="__journeyGrid"] [data-landing-phone-view="${view}"]`).evaluate((card) => {
      const bounds = card.getBoundingClientRect();
      window.scrollTo({
        top: window.scrollY + bounds.top + bounds.height / 2 - window.innerHeight / 2,
        behavior: "instant",
      });
    });
    const entry = phone.contentFrame().locator(`[data-landing-phone-screen-entry="${view}"]`);
    await expect(entry).toBeVisible();
    await expect(entry).toHaveCSS("animation-name", /landing-phone-screen-dissolve/);
    await expect(entry).toHaveCSS("animation-duration", "0.28s");
    expect(await entry.locator('[class*="__phoneUi"]').evaluate((root) => root.scrollTop)).toBe(0);
    expect(
      await entry.locator('[class*="__phoneStatusBar"]').evaluate((bar) => bar.getBoundingClientRect().top),
    ).toBeGreaterThanOrEqual(0);
    if (view === "added") {
      const frame = phone.contentFrame();
      await expect(
        frame.locator('[data-slot="account-directory-list"] li').last().locator('[data-landing-phone-target="added"]'),
      ).toHaveCount(1);
      await expect(frame.locator('a[href="/vaults/accounts/new"][data-landing-phone-target]')).toHaveCount(0);
    }
    if (view === "sharedPermissions") {
      await expect
        .poll(async () =>
          phone
            .contentFrame()
            .locator("#vault-default-canAddAccounts")
            .evaluate((control) => {
              const bounds = control.getBoundingClientRect();
              return bounds.top >= 80 && bounds.bottom <= window.innerHeight - 80;
            }),
        )
        .toBe(true);
    }
    await expect
      .poll(async () => {
        const bounds = await phone.boundingBox();
        return Boolean(
          bounds &&
          originalBounds &&
          Math.abs(bounds.x - originalBounds.x) <= 2 &&
          Math.abs(bounds.y - originalBounds.y) <= 2,
        );
      })
      .toBe(true);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(phone.contentFrame().locator("[data-landing-phone-screen-entry]")).toHaveCSS("animation-name", "none");
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`reveals journey cards without moving their connector anchors with ${reducedMotion} motion`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
      await page.goto("/landing");
      const scene = page.locator("[data-landing-desktop-scene]");
      await expect(scene).toHaveAttribute("data-input-ready", "true");
      await expect(page.locator("[data-landing-device-showcase]")).toHaveAttribute("data-ready", "true", {
        timeout: 15_000,
      });
      for (const step of ["unlocked", "devices", "settled"]) {
        await page.keyboard.press("PageDown");
        await expect(scene).toHaveAttribute("data-scene-step", step, { timeout: 20_000 });
      }
      await expect(page.locator("[data-landing-phone-story-journey]")).toHaveAttribute("aria-hidden", "false");
      const card = page.locator(`[data-landing-phone-guide="${width === 320 ? "mobile" : "right"}"]`).first();
      if (reducedMotion === "reduce") {
        await expect(card).toHaveCSS("animation-name", "none");
        await expect(card).toHaveCSS("opacity", "1");
        await expect(card.locator('[class*="__journeyCardContent"]')).toHaveCSS("animation-name", "none");
        continue;
      }
      const entrance = await card.evaluate(async (element) => {
        const animation = element
          .getAnimations()
          .find((item) => item instanceof CSSAnimation && item.animationName.includes("landing-journey-card-enter"));
        const effect = animation?.effect;
        if (!animation || !(effect instanceof KeyframeEffect))
          throw new Error("The journey card entrance is unavailable.");
        const before = element.getBoundingClientRect();
        const opacity = effect.getKeyframes().map((frame) => String(frame.opacity));
        await animation.finished;
        const after = element.getBoundingClientRect();
        return {
          opacity,
          duration: effect.getComputedTiming().duration,
          movement: Math.max(
            Math.abs(before.x - after.x),
            Math.abs(before.y - after.y),
            Math.abs(before.width - after.width),
            Math.abs(before.height - after.height),
          ),
        };
      });
      expect(entrance.opacity).toEqual(["0", "1"]);
      expect(entrance.duration).toBe(420);
      expect(entrance.movement).toBeLessThanOrEqual(1);
      await expect(card).toHaveCSS("opacity", "1");
    }
  });
}

for (const width of [1440, 2056]) {
  test(`keeps the desktop phone dock and pattern continuous at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/landing");
    const scene = page.locator("[data-landing-desktop-scene]");
    await expect(scene).toHaveAttribute("data-input-ready", "true");
    for (const step of ["unlocked", "devices", "settled"]) {
      await page.keyboard.press("PageDown");
      await expect(scene).toHaveAttribute("data-scene-step", step, { timeout: 20_000 });
    }
    const firstCard = page.locator('[class*="__guideColumn"] article').first();
    await expect(firstCard).toHaveAttribute("data-landing-phone-view", "accounts");
    await expect(firstCard).toHaveAttribute("data-active", "true");
    await expect(page.locator("[data-landing-phone-story-journey]")).toHaveAttribute("aria-hidden", "false");
    await expect
      .poll(async () => {
        const bounds = await firstCard.boundingBox();
        return bounds ? Math.abs(bounds.y + bounds.height / 2 - 450) : Number.POSITIVE_INFINITY;
      })
      .toBeLessThan(40);
    const phone = page.locator('[data-landing-primary-phone] iframe[data-device-kind="phone"]');
    const environment = page.locator("[data-landing-story-environment]");
    await expect(environment).toHaveAttribute("data-visible", "true");
    const initial = await phone.boundingBox();
    const dock = await page.locator('[class*="__journeyGrid"] [data-landing-phone-anchor="journey"]').boundingBox();
    expect(initial).not.toBeNull();
    expect(dock).not.toBeNull();
    expect(Math.abs(initial!.x + initial!.width / 2 - dock!.x - dock!.width / 2)).toBeLessThanOrEqual(2);
    for (const top of [8, 24, 80, 180, 300, 450, 650]) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), top);
      await expect(environment).toHaveAttribute("data-visible", "true");
      await expect
        .poll(async () => {
          const bounds = await phone.boundingBox();
          return Boolean(
            bounds &&
            initial &&
            Math.abs(bounds.x - initial.x) <= 2 &&
            Math.abs(bounds.y - initial.y) <= 2 &&
            Math.abs(bounds.width - initial.width) <= 2 &&
            Math.abs(bounds.height - initial.height) <= 2,
          );
        })
        .toBe(true);
    }
  });
}

for (const locale of ["id", "en"] as const) {
  test(`fits the mobile journey phone and guide without clipping in ${locale}`, async ({ page, context }) => {
    await context.addCookies([{ name: "RHSIA_LOCALE", value: locale, url: "http://127.0.0.1" }]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/landing");
    const scene = page.locator("[data-landing-desktop-scene]");
    await expect(scene).toHaveAttribute("data-input-ready", "true");
    for (const step of ["unlocked", "devices", "settled"]) {
      await page.keyboard.press("PageDown");
      await expect(scene).toHaveAttribute("data-scene-step", step, { timeout: 20_000 });
    }
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await page.locator("#landing-journey").evaluate((element) => {
        window.scrollTo({
          top: element.getBoundingClientRect().top + window.scrollY + window.innerHeight * 0.5,
          behavior: "instant",
        });
      });
      await expect(scene).toHaveAttribute("data-story-handoff", "true");
      const phone = page.locator('[data-landing-primary-phone] iframe[data-device-kind="phone"]');
      const guide = page.locator('[data-landing-phone-guide="mobile"][data-active="true"]');
      await expect
        .poll(async () => {
          const frame = await phone.boundingBox();
          const card = await guide.boundingBox();
          return Boolean(
            frame &&
            card &&
            frame.x >= 0 &&
            frame.y >= 0 &&
            frame.x + frame.width <= viewport.width &&
            frame.y + frame.height < card.y &&
            card.y + card.height <= viewport.height,
          );
        })
        .toBe(true);
      const connector = page.locator('svg[class*="phoneStoryConnector"] circle').first();
      const guideNode = page.locator("[data-landing-guide-node]");
      await expect(connector).toHaveAttribute("visibility", "visible");
      await expect(guideNode).toHaveAttribute("visibility", "visible");
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const caption = Array.from(document.querySelectorAll<HTMLElement>("[data-landing-phone-caption]")).find(
              (item) => item.getClientRects().length > 0,
            );
            const path = document.querySelector('svg[class*="phoneStoryConnector"] path');
            const exitX = Number(path?.getAttribute("d")?.split(" ")[4]);
            return Boolean(caption && Number.isFinite(exitX) && exitX > caption.getBoundingClientRect().right + 8);
          }),
        )
        .toBe(true);
      await expect
        .poll(async () => {
          const card = await guide.boundingBox();
          const nodeX = Number(await guideNode.getAttribute("cx"));
          const nodeY = Number(await guideNode.getAttribute("cy"));
          return Boolean(card && Math.abs(nodeX - card.x - 20) <= 1 && Math.abs(nodeY - card.y - 1) <= 1);
        })
        .toBe(true);
    }
  });

  test(`keeps the landing hero and scroll cue separate in ${locale}`, async ({ page, context }) => {
    await context.addCookies([{ name: "RHSIA_LOCALE", value: locale, url: "http://127.0.0.1" }]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/landing");
    const scene = page.locator("[data-landing-desktop-scene]");
    await expect(scene).toHaveAttribute("data-input-ready", "true");
    await page.keyboard.press("PageDown");
    await expect(scene).toHaveAttribute("data-scene-step", "unlocked", { timeout: 20_000 });
    await page.keyboard.press("PageDown");
    await expect(scene).toHaveAttribute("data-scene-step", "devices", { timeout: 20_000 });
    const heroSurface = scene.locator('[data-landing-intro-scroll="true"]');
    await expect(heroSurface).toHaveCSS("backdrop-filter", /blur\(18px\)/);

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1280, height: 577 },
      { width: 844, height: 390 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      const hero = scene.locator('[class*="__heroOverlay"]');
      const cue = scene.locator("[data-landing-scroll-cue]");
      await expect(hero).toHaveAttribute("data-visible", "true");
      await expect
        .poll(async () => {
          const card = await hero.boundingBox();
          const hint = await cue.boundingBox();
          return Boolean(
            card &&
            hint &&
            card.y >= 0 &&
            card.y + card.height + 8 <= hint.y &&
            hint.y + hint.height <= viewport.height &&
            card.x >= 0 &&
            card.x + card.width <= viewport.width &&
            Math.abs(card.x + card.width / 2 - viewport.width / 2) <= 1 &&
            Math.abs(card.y + card.height / 2 - viewport.height / 2) <= 1,
          );
        })
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      const action = hero.locator('a[href="/sign-in"]');
      await hero.focus();
      await action.focus();
      await expect(action).toBeFocused();
      await expect
        .poll(async () => {
          const control = await action.boundingBox();
          const card = await hero.boundingBox();
          return Boolean(control && card && control.y >= card.y && control.y + control.height <= card.y + card.height);
        })
        .toBe(true);
    }

    const browserSession = await context.newCDPSession(page);
    await browserSession.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
    });
    await expect(heroSurface).toHaveCSS("backdrop-filter", "none");
    await expect(heroSurface).toHaveCSS("background-color", "rgb(248, 244, 237)");
  });
}
