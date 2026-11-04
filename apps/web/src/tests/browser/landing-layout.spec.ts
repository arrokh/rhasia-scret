import { expect, test } from "@playwright/test";

for (const locale of ["id", "en"] as const) {
  test(`keeps landing navigation accessible and aligned in ${locale}`, async ({ page, context }) => {
    await context.addCookies([{ name: "RHSIA_LOCALE", value: locale, url: "http://127.0.0.1" }]);
    await page.goto("/landing");
    const header = page.locator("[data-landing-header]");
    await expect(header.locator("img")).toHaveCount(0);
    const navigation = header.getByRole("navigation", { name: locale === "id" ? "Navigasi utama" : "Main navigation" });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(navigation).toBeVisible();
      await expect(page.locator('[data-slot="app-footer"]')).toBeHidden();
      await expect(navigation.getByRole("link", { name: /rhasia-scret/ })).toHaveAttribute("href", "/");
      const github = navigation.getByRole("link", {
        name: locale === "id" ? "Repositori GitHub" : "GitHub repository",
        exact: true,
      });
      await expect(github).toHaveAttribute("href", "https://github.com/arrokh/rhasia-scret");
      const language = navigation.getByRole("button", {
        name: locale === "id" ? "Pilih bahasa" : "Choose language",
        exact: true,
      });
      await language.focus();
      await expect(language).toBeFocused();
      await expect(navigation.locator('a[href="/sign-in"]')).toHaveCount(0);
      await expect(navigation.locator('a[href="/local?from=landing"]')).toHaveCount(0);
      await expect(page.locator('[data-landing-intro-scroll] a[href="/sign-in"]')).toHaveCount(1);
      await expect(page.locator('[data-landing-intro-scroll] a[href="/local?from=landing"]')).toHaveCount(1);
      await expect(header).toHaveCSS("position", "fixed");
      const sizes = await header.evaluate((element) => ({
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
        actions: [...element.querySelectorAll('button, a[data-slot="button"]')]
          .filter((action) => action.getClientRects().length)
          .map((action) => action.getBoundingClientRect().height),
      }));
      expect(sizes.width).toBeLessThanOrEqual(sizes.viewport);
      expect(sizes.actions).toHaveLength(2);
      expect(sizes.actions.every((height) => height === 48)).toBe(true);
      await expect
        .poll(() =>
          page.locator("[data-landing-primary-phone] iframe").evaluate((screen) => {
            const phone = screen.getBoundingClientRect();
            const header = document.querySelector("[data-landing-header]")?.getBoundingClientRect();
            const footer = document.querySelector("footer")?.getBoundingClientRect();
            const top = header?.bottom ?? 0;
            const bottom = footer && footer.top > top && footer.top < innerHeight ? footer.top : innerHeight;
            return Math.max(
              Math.abs(phone.x + phone.width / 2 - innerWidth / 2),
              Math.abs(phone.y + phone.height / 2 - (top + bottom) / 2),
            );
          }),
        )
        .toBeLessThanOrEqual(12);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    const scene = page.locator("[data-landing-desktop-scene]:visible");
    for (const step of ["unlocked", "devices", "settled"]) {
      await page.keyboard.press("PageDown");
      await expect(scene).toHaveAttribute("data-scene-step", step, { timeout: 15_000 });
      if (step !== "devices") continue;
      const hero = scene.locator("[data-landing-intro-scroll]");
      await expect(hero).toHaveAttribute("data-visible", "true");
      await expect(hero.locator('a[href="/sign-in"]')).toBeVisible();
      await expect(hero.locator('a[href="/local?from=landing"]')).toBeVisible();
    }
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await expect(header).toBeVisible();
      await expect(header).not.toHaveAttribute("inert");
      await expect(header.locator('a[href="/local?from=landing"]')).toHaveCount(0);
      await expect(header.locator('a[href="/sign-in"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="landing-final-cta"] a[target="_blank"]')).toBeVisible();
      await expect(page.locator('[data-slot="landing-final-cta"] a[href="/sign-in"]')).toBeVisible();
      await expect
        .poll(() =>
          page.locator('[data-slot="landing-final-cta"]').evaluate((cta) => {
            const note = document.querySelector("[data-landing-phone-story-end]");
            if (!note) throw new Error("The journey privacy note is unavailable.");
            return cta.getBoundingClientRect().top - note.getBoundingClientRect().bottom;
          }),
        )
        .toBe(24);
      expect(await header.evaluate((element) => Math.abs(element.getBoundingClientRect().top))).toBeLessThanOrEqual(1);
    }
  });
}

for (const locale of ["id", "en"] as const) {
  test(`keeps final CTA copy and destinations without right-side icons in ${locale}`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("The browser test base URL is required.");
    await context.addCookies([{ name: "RHSIA_LOCALE", value: locale, url: baseURL }]);
    await page.goto("/landing");
    const actions = page.locator('[data-slot="landing-final-cta"]');
    const signIn = actions.getByRole("link", { name: locale === "id" ? "Coba sekarang" : "Try now", exact: true });
    const selfHost = actions.getByRole("link", {
      name: locale === "id" ? "Jalankan sendiri" : "Self-host it",
      exact: true,
    });
    await expect(signIn).toHaveAttribute("href", "/sign-in");
    await expect(selfHost).toHaveAttribute(
      "href",
      "https://github.com/arrokh/rhasia-scret/blob/main/docs/self-hosting.md",
    );
    await expect(selfHost).toHaveAttribute("target", "_blank");
    await expect(selfHost).toHaveAttribute("rel", "noopener noreferrer");
    await expect(actions.locator("a svg")).toHaveCount(0);
  });
}

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
    const scene = page.locator("[data-landing-desktop-scene]:visible");
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

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`keeps the phone screen opaque when the active journey card changes at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/landing");
    const scene = page.locator("[data-landing-desktop-scene]:visible");
    await expect(scene).toHaveAttribute("data-input-ready", "true");
    for (const step of ["unlocked", "devices", "settled"]) {
      await page.keyboard.press("PageDown");
      await expect(scene).toHaveAttribute("data-scene-step", step, { timeout: 20_000 });
    }
    const phone = page.locator('[data-landing-primary-phone] iframe[data-device-kind="phone"]');
    const originalBounds = await phone.boundingBox();
    for (const view of ["scan", "review", "added", "sharedPermissions"]) {
      await page.locator(`[data-landing-phone-view="${view}"]:visible`).evaluate((card) => {
        const bounds = card.getBoundingClientRect();
        window.scrollTo({
          top:
            innerWidth <= 720
              ? scrollY + bounds.top - innerHeight * 0.57
              : scrollY + bounds.top + bounds.height / 2 - innerHeight / 2,
          behavior: "instant",
        });
      });
      const entry = phone.contentFrame().locator(`[data-landing-phone-screen-entry="${view}"]`);
      await expect(entry).toBeVisible();
      await expect(entry).toHaveCSS("animation-name", "none");
      await expect(entry).toHaveCSS("opacity", "1");
      expect(await entry.locator('[class*="phoneUi"]').evaluate((root) => root.scrollTop)).toBe(0);
      expect(
        await entry.locator('[class*="phoneStatusBar"]').evaluate((bar) => bar.getBoundingClientRect().top),
      ).toBeGreaterThanOrEqual(0);
      if (view === "added") {
        const frame = phone.contentFrame();
        await expect(
          frame
            .locator('[data-slot="account-directory-list"] li')
            .last()
            .locator('[data-landing-phone-target="added"]'),
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
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`reveals journey cards without moving their connector anchors with ${reducedMotion} motion`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
      await page.goto("/landing");
      const scene = page.locator("[data-landing-desktop-scene]:visible");
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
        await expect(card.locator('[class*="journeyCardContent"]')).toHaveCSS("animation-name", "none");
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
    const scene = page.locator("[data-landing-desktop-scene]:visible");
    await expect(scene).toHaveAttribute("data-input-ready", "true");
    for (const step of ["unlocked", "devices", "settled"]) {
      await page.keyboard.press("PageDown");
      await expect(scene).toHaveAttribute("data-scene-step", step, { timeout: 20_000 });
    }
    const firstCard = page.locator('[class*="guideColumn"] article').first();
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
    const dock = await page.locator('[class*="journeyGrid"] [data-landing-phone-anchor="journey"]').boundingBox();
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
    const scene = page.locator("[data-landing-desktop-scene]:visible");
    await expect(scene).toHaveAttribute("data-input-ready", "true");
    for (const step of ["unlocked", "devices", "settled"]) {
      await page.keyboard.press("PageDown");
      await expect(scene).toHaveAttribute("data-scene-step", step, { timeout: 20_000 });
    }
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 640, height: 360 },
      { width: 568, height: 320 },
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
            frame.height >= 80 &&
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
      const measureGroup = () =>
        guide.evaluate((card) => {
          const panel = card.closest('[class*="mobileJourneyStage"]');
          const anchor = panel?.querySelector('[data-landing-phone-anchor="journey"]')?.getBoundingClientRect();
          const caption = panel?.querySelector("[data-landing-phone-caption]")?.getBoundingClientRect();
          const bounds = card.getBoundingClientRect();
          const header = document.querySelector("[data-landing-header]")?.getBoundingClientRect();
          if (!anchor || !caption || !header) return null;
          return {
            anchorCaptionGap: Math.round(caption.top - anchor.bottom),
            captionCardGap: Math.round(bounds.top - caption.bottom),
            centered: Math.abs((anchor.top + bounds.bottom) / 2 - (header.bottom + innerHeight) / 2) <= 12,
          };
        });
      await expect.poll(measureGroup).toEqual({ anchorCaptionGap: 8, captionCardGap: 8, centered: true });
      const views = [
        "accounts",
        "scan",
        "review",
        "added",
        "sharedCreate",
        "sharedInvite",
        "sharedPermissions",
        "sharedReady",
      ];
      for (const [index, view] of views.entries()) {
        await page.locator(`[data-landing-phone-view="${view}"]:visible`).evaluate((element) => {
          const journey = element.closest("[data-landing-phone-story-journey]");
          const journeyTop = journey ? journey.getBoundingClientRect().top + scrollY : 0;
          window.scrollTo({
            top: Math.max(journeyTop, element.getBoundingClientRect().top + scrollY - innerHeight * 0.57),
            behavior: "instant",
          });
        });
        await expect(guide.locator('[class*="cardIndex"]')).toHaveText(`0${index + 1}`);
        await expect.poll(measureGroup).toEqual({ anchorCaptionGap: 8, captionCardGap: 8, centered: true });
      }
      await expect
        .poll(async () => {
          const card = await guide.boundingBox();
          const nodeX = Number(await guideNode.getAttribute("cx"));
          const nodeY = Number(await guideNode.getAttribute("cy"));
          return Boolean(
            card && Math.abs(nodeX - (card.x + card.width - 20)) <= 1 && Math.abs(nodeY - card.y - 1) <= 1,
          );
        })
        .toBe(true);
    }
  });

  test(`keeps the landing hero and scroll cue separate in ${locale}`, async ({ page, context }) => {
    await context.addCookies([{ name: "RHSIA_LOCALE", value: locale, url: "http://127.0.0.1" }]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/landing");
    const scene = page.locator("[data-landing-desktop-scene]:visible");
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
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await page.setViewportSize(viewport);
      const hero = scene.locator('[class*="heroOverlay"]');
      await expect(hero).toHaveAttribute("data-visible", "true");
      await expect
        .poll(() =>
          hero.evaluate((element) => {
            const card = element.getBoundingClientRect();
            const hint = element
              .closest("[data-landing-desktop-scene]")
              ?.querySelector("[data-landing-scroll-cue]")
              ?.getBoundingClientRect();
            return Boolean(
              hint &&
              card.y >= 0 &&
              card.bottom + 8 <= hint.y &&
              hint.bottom <= window.innerHeight &&
              card.x >= 0 &&
              card.right <= window.innerWidth &&
              Math.abs(card.x + card.width / 2 - window.innerWidth / 2) <= 1 &&
              Math.abs(card.y + card.height / 2 - window.innerHeight / 2) <= 1,
            );
          }),
        )
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      const action = hero.locator('a[href="/sign-in"]');
      await hero.focus();
      await action.focus();
      await expect(action).toBeFocused();
      await expect
        .poll(() =>
          action.evaluate((element) => {
            const control = element.getBoundingClientRect();
            const card = element.closest('[data-landing-intro-scroll="true"]')?.getBoundingClientRect();
            return Boolean(card && control.y >= card.y && control.bottom <= card.bottom);
          }),
        )
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
