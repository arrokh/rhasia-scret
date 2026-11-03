import { expect, test } from "@playwright/test";

test("renders the browser smoke page", async ({ page }) => {
  await page.goto("/smoke");
  await expect(page.getByTestId("smoke-ready")).toHaveText("Siap");
});

test("scroll advances from the locked phone to the device showcase with its hero card", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/landing$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(page).toHaveTitle("rhasia-scret");
  const scene = page.locator('[data-landing-desktop-scene="true"]');
  const primaryPhone = page.locator("[data-landing-primary-phone]");
  await expect(scene).toHaveAttribute("data-scene-step", "locked");
  await expect(scene).toHaveAttribute("data-input-ready", "true");
  await expect(primaryPhone).toHaveAttribute("data-visible", "true");
  const storyEnvironment = page.locator("[data-landing-story-environment]");
  await expect(storyEnvironment).toHaveAttribute("data-visible", "true");
  await expect(storyEnvironment.locator("canvas")).toHaveCount(1, { timeout: 15_000 });
  const phonePreview = primaryPhone.getByRole("img").locator('iframe[data-device-kind="phone"]').first().contentFrame();
  await expect(phonePreview.locator("[data-unlock-phase]")).toHaveAttribute("data-unlock-phase", "locked", {
    timeout: 15_000,
  });
  await expect(primaryPhone.getByRole("img")).toHaveAttribute(
    "aria-label",
    "Pratinjau maket ponsel tiga dimensi untuk layar Hosted Vault.",
  );
  const originalCanvas = await primaryPhone.locator("canvas").first().elementHandle();
  expect(originalCanvas).not.toBeNull();
  await expect(scene.locator('[class*="__scrollCue"]')).toContainText("Gulir ke bawah untuk melanjutkan");
  await expect(scene.locator('[class*="__heroOverlay"]')).toHaveAttribute("data-visible", "false");

  await page.mouse.wheel(0, 500);
  await expect(scene).toHaveAttribute("data-scene-step", "unlocking");
  await expect(scene.locator('[class*="__sceneLoadingIndicator"]')).toHaveAttribute("data-visible", "true");
  await expect(phonePreview.locator("[data-unlock-phase]")).toHaveAttribute("data-unlock-phase", "unlocked", {
    timeout: 10_000,
  });
  await expect(scene).toHaveAttribute("data-scene-step", "unlocked", { timeout: 10_000 });

  const blockedInput = await scene.evaluate(
    (element) =>
      new Promise<{ wheel: boolean; click: boolean; key: boolean; inert: boolean; busy: boolean }>(
        (resolve, reject) => {
          const hero = element.querySelector<HTMLElement>('[class*="__heroOverlay"]');
          const link = hero?.querySelector<HTMLAnchorElement>('a[href="/local?from=landing"]');
          if (!hero || !link) return reject(new Error("The landing action is unavailable."));
          const timeout = window.setTimeout(() => {
            observer.disconnect();
            reject(new Error("The hero did not appear during the transition."));
          }, 25_000);
          const observer = new MutationObserver(() => {
            if (hero.dataset.visible !== "true" || element.getAttribute("aria-busy") !== "true") return;
            const click = new MouseEvent("click", { bubbles: true, cancelable: true });
            const key = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
            link.dispatchEvent(click);
            link.dispatchEvent(key);
            observer.disconnect();
            window.clearTimeout(timeout);
            resolve({
              wheel: extraWheel.defaultPrevented,
              click: click.defaultPrevented,
              key: key.defaultPrevented,
              inert: hero.inert,
              busy: true,
            });
          });
          observer.observe(element, {
            attributes: true,
            subtree: true,
            attributeFilter: ["data-visible", "aria-busy"],
          });
          window.dispatchEvent(new WheelEvent("wheel", { deltaY: 500, bubbles: true, cancelable: true }));
          const extraWheel = new WheelEvent("wheel", { deltaY: 500, bubbles: true, cancelable: true });
          window.dispatchEvent(extraWheel);
        },
      ),
  );
  expect(blockedInput).toEqual({ wheel: true, click: true, key: false, inert: true, busy: true });
  await page.evaluate(() => {
    const activeScene = document.querySelector<HTMLElement>("[data-landing-desktop-scene]");
    if (!activeScene) return;
    const wheelDuringTransition = window.setInterval(() => {
      const wheel = new WheelEvent("wheel", { deltaY: 500, bubbles: true, cancelable: true });
      window.dispatchEvent(wheel);
      if (wheel.defaultPrevented) activeScene.dataset.processingWheelSeen = "true";
      let scrollReachedObservers = false;
      const observeScroll = () => {
        scrollReachedObservers = true;
      };
      window.addEventListener("scroll", observeScroll);
      window.dispatchEvent(new Event("scroll"));
      window.removeEventListener("scroll", observeScroll);
      if (!scrollReachedObservers) activeScene.dataset.processingScrollIgnored = "true";
      if (activeScene.dataset.sceneStep !== "expanding") window.clearInterval(wheelDuringTransition);
    }, 80);
  });
  await expect(scene).toHaveAttribute("data-processing-wheel-seen", "true");
  await expect(scene).toHaveAttribute("data-processing-scroll-ignored", "true");
  const hero = scene.locator('[class*="__heroOverlay"]');
  const localLink = hero.locator('a[href="/local?from=landing"]');
  await expect(page).toHaveURL(/\/landing$/);
  await expect(scene).toHaveAttribute("data-scene-step", "devices", { timeout: 15_000 });
  await page.waitForTimeout(500);
  await expect(scene).toHaveAttribute("data-scene-step", "devices");
  await expect(scene).toHaveAttribute("aria-busy", "false");
  await expect(hero).not.toHaveAttribute("inert", "");
  await localLink.focus();
  await expect(localLink).toBeFocused();
  await expect(page.locator('[class*="__deviceShowcase"]')).toHaveAttribute("data-visible", "true");
  await expect(scene.locator('[class*="__heroOverlay"]')).toHaveAttribute("data-visible", "true");
  await expect(page.locator('[data-layout="showcase"]')).toHaveAttribute("data-device-count", "4");
  await expect(page.getByLabel("Alamat email yang diundang")).toHaveCount(0);
  await expect(primaryPhone.locator("[data-device-model]")).toHaveAttribute("data-device-model", "iphone-17-pro-max");
  const heroBounds = await hero.boundingBox();
  expect(heroBounds).not.toBeNull();
  expect(heroBounds!.y + heroBounds!.height / 2).toBeCloseTo(900 / 2, 0);

  await page.keyboard.press("PageUp");
  await expect(scene).toHaveAttribute("data-scene-step", "contracting");
  await expect(scene).toHaveAttribute("aria-busy", "true");
  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "contracting");
  await expect(primaryPhone).toHaveAttribute("data-device-scale", "full", { timeout: 10_000 });
  await expect(scene).toHaveAttribute("data-scene-step", "unlocked", { timeout: 5_000 });
  await expect(scene).toHaveAttribute("aria-busy", "false");
  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "expanding");
  await expect(scene).toHaveAttribute("data-scene-step", "devices", { timeout: 15_000 });

  const phoneStageLeft = () => primaryPhone.evaluate((element) => Number.parseFloat(element.style.left || "0"));
  expect(await phoneStageLeft()).toBeCloseTo(0, 1);
  await page.mouse.wheel(0, 500);
  await expect(scene).toHaveAttribute("data-scene-step", "leaving");
  await expect(primaryPhone).toHaveAttribute("data-device-scale", "full");
  await expect.poll(phoneStageLeft).toBeLessThan(-100);
  await expect(scene).toHaveAttribute("data-scene-step", "settled", { timeout: 15_000 });
  await expect(scene.locator('[class*="__heroScrollCue"]')).toHaveAttribute("data-visible", "false");
  await page.evaluate(() => {
    const journey = document.querySelector<HTMLElement>("#landing-journey");
    if (journey) window.scrollTo({ top: journey.offsetTop + window.innerHeight * 0.35, behavior: "instant" });
  });
  await expect(scene).toHaveAttribute("data-story-handoff", "true", { timeout: 10_000 });
  await expect(primaryPhone.locator("[data-device-model]")).toHaveAttribute("data-device-model", "iphone-17-pro-max");
  expect(
    await originalCanvas?.evaluate(
      (canvas) => canvas === document.querySelector("[data-landing-primary-phone] canvas"),
    ),
  ).toBe(true);
});

test("keeps the locked landing scene within narrow mobile viewports", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const scene = page.locator('[data-landing-desktop-scene="true"]');
    await expect(scene).toHaveAttribute("data-scene-step", "locked");
    await expect(page.locator("[data-landing-primary-phone]")).toHaveAttribute("data-visible", "true");
    await expect(scene.locator('[class*="__scrollCue"]')).toContainText("Gulir ke bawah untuk melanjutkan");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("reduced motion skips animations and allows moving backwards through landing steps", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const scene = page.locator('[data-landing-desktop-scene="true"]');
  await expect(scene).toHaveAttribute("data-scene-step", "locked");
  await expect(scene).toHaveAttribute("data-input-ready", "true");
  const phonePreview = page
    .locator("[data-landing-primary-phone]")
    .getByRole("img")
    .locator('iframe[data-device-kind="phone"]')
    .first()
    .contentFrame();
  await expect(phonePreview.locator("[data-unlock-phase]")).toHaveAttribute("data-unlock-phase", "locked", {
    timeout: 15_000,
  });
  await page.mouse.wheel(0, 500);
  await expect(scene).toHaveAttribute("data-scene-step", "unlocked", { timeout: 10_000 });
  await expect(scene.locator('[class*="__sceneLoadingIndicator"]')).toHaveAttribute("data-visible", "false");
  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "devices", { timeout: 25_000 });
  await page.keyboard.press("PageUp");
  await expect(scene).toHaveAttribute("data-scene-step", "unlocked", { timeout: 10_000 });
  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "devices", { timeout: 10_000 });
  await page.keyboard.press("PageDown");
  await expect(scene).toHaveAttribute("data-scene-step", "settled", { timeout: 10_000 });
  await page.keyboard.press("PageUp");
  await expect(scene).toHaveAttribute("data-scene-step", "devices", { timeout: 10_000 });
});

test("aligns the landing footer as brand and a right-side utility group", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 600, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/landing");

    const alignment = await page.locator("main > footer > div").evaluate((footer) => {
      const footerBox = footer.getBoundingClientRect();
      const [brand, navigation] = Array.from(footer.children).map((item) => item.getBoundingClientRect());
      const brandChildren = footer.querySelectorAll("p > *");
      const firstBrandChild = brandChildren[0]?.getBoundingClientRect();
      const lastBrandChild = brandChildren[brandChildren.length - 1]?.getBoundingClientRect();
      const brandContent = {
        left: firstBrandChild?.left ?? Number.POSITIVE_INFINITY,
        right: lastBrandChild?.right ?? Number.NEGATIVE_INFINITY,
      };
      return {
        display: getComputedStyle(footer).display,
        childCount: footer.children.length,
        footerCenter: footerBox.x + footerBox.width / 2,
        brandCenter: (brandContent.left + brandContent.right) / 2,
        brandColumnCenter: brand.x + brand.width / 2,
        navigationCenter: navigation.x + navigation.width / 2,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    expect(alignment.display).toBe("flex");
    expect(alignment.childCount).toBe(2);
    expect(Math.abs(alignment.brandCenter - alignment.footerCenter)).toBeLessThan(2);
    expect(Math.abs(alignment.brandColumnCenter - alignment.footerCenter)).toBeLessThan(2);
    expect(Math.abs(alignment.navigationCenter - alignment.footerCenter)).toBeLessThan(2);
    expect(alignment.documentWidth).toBeLessThanOrEqual(alignment.viewportWidth);
    await expect(page.locator("main > footer").getByRole("button", { name: "Pilih bahasa" })).toBeVisible();
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/landing");
  const desktopAlignment = await page.locator("main > footer > div").evaluate((footer) => {
    const footerBox = footer.getBoundingClientRect();
    const [brand, navigation] = Array.from(footer.children).map((item) => item.getBoundingClientRect());
    return {
      display: getComputedStyle(footer).display,
      childCount: footer.children.length,
      left: footerBox.x,
      center: footerBox.x + footerBox.width / 2,
      right: footerBox.right,
      brandLeft: brand.x,
      navigationRight: navigation.right,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });

  expect(desktopAlignment.display).toBe("grid");
  expect(desktopAlignment.childCount).toBe(2);
  expect(Math.abs(desktopAlignment.brandLeft - desktopAlignment.left)).toBeLessThan(2);
  expect(Math.abs(desktopAlignment.navigationRight - desktopAlignment.right)).toBeLessThan(2);
  expect(desktopAlignment.documentWidth).toBeLessThanOrEqual(desktopAlignment.viewportWidth);
  await expect(page.locator("main > footer").getByRole("button")).toHaveCount(0);
});

test("keeps the shared Hosted Vault journey and device viewport on the page", async ({ page }) => {
  for (const viewport of [
    { width: 430, height: 932 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const journey = page.locator("#landing-journey");
    await expect(journey).toHaveCount(1);
    await expect(journey.locator('[class*="__guideColumn"] article')).toHaveCount(8);
    await expect(journey.locator('[class*="__mobileJourneySteps"] [data-landing-phone-view]')).toHaveCount(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("renders email authentication and signup at sign in", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByLabel("Alamat email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lanjutkan dengan email" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Buka Brankas Lokal" })).toHaveAttribute("href", "/local");
  await expect(page.getByRole("link", { name: "Buka snapshot luring" })).toHaveAttribute("href", "/offline");
  await expect(page.locator('a[href^="/auth/oidc"]')).toHaveCount(0);
});

test("renders the localized configuration failure state", async ({ page }) => {
  await page.goto("/sign-in?auth=configuration_error");
  await expect(
    page
      .locator('[data-slot="alert"]')
      .filter({ hasText: "Layanan masuk belum dikonfigurasi. Hubungi administrator." }),
  ).toBeVisible();
  await expect(page.getByLabel("Alamat email")).toBeVisible();
});

test("hands a passwordless session to a new installed-PWA window", async ({ page, context }) => {
  let handoffId: string | undefined;
  let handoffPublished = false;
  let handoffAccepted = false;
  let pollSentRefreshCredential = false;
  await context.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia;
    window.matchMedia = (query) => {
      if (query === "(display-mode: standalone)")
        return {
          matches: true,
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        };
      return nativeMatchMedia(query);
    };
  });
  // Keep the handoff scenario deterministic instead of relying on Cloudflare's external widget service.
  await context.route(/^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.turnstile = {
        render(container, options) {
          container.dataset.turnstileAction = options.action;
          container.style.width = "300px";
          container.style.height = "65px";
          const token = "synthetic-browser-smoke-turnstile-token";
          queueMicrotask(() => options.callback(token));
          return "browser-smoke-turnstile-widget";
        },
        getResponse() { return "synthetic-browser-smoke-turnstile-token"; },
        remove() {},
      };`,
    }),
  );
  await context.route("**/api/v1/auth/magic-link/request", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.client).toBe("pwa");
    expect(typeof body.handoffId).toBe("string");
    expect(typeof body.handoffVerifier).toBe("string");
    expect(body.turnstileToken).toBe("synthetic-browser-smoke-turnstile-token");
    handoffId = body.handoffId as string;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sent: true }) });
  });
  await context.route("**/api/v1/auth/magic-link/redeem", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        refreshToken: "0123456789abcdef.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
        returnPath: "/vaults/invitations/redeem",
      }),
    });
  });
  await context.route("**/api/v1/auth/pwa/session", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (typeof body.refreshToken === "string") {
      handoffPublished = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ published: true }) });
      return;
    }
    pollSentRefreshCredential ||= "refreshToken" in body;
    handoffAccepted ||= handoffPublished;
    await route.fulfill({
      status: handoffPublished ? 200 : 202,
      contentType: "application/json",
      body: JSON.stringify(
        handoffPublished ? { accepted: true, returnPath: "/vaults/invitations/redeem" } : { pending: true },
      ),
    });
  });

  await page.goto("/sign-in?next=%2Fvaults%2Finvitations%2Fredeem");
  const turnstileWidget = page.getByLabel("Verifikasi keamanan");
  await expect(turnstileWidget).toBeVisible();
  await expect(turnstileWidget).toHaveAttribute("data-turnstile-action", "magic_link_request");
  const widgetBox = await turnstileWidget.boundingBox();
  const formBox = await page.locator("form").boundingBox();
  expect(widgetBox).not.toBeNull();
  expect(formBox).not.toBeNull();
  expect(
    Math.abs((widgetBox?.x ?? 0) + (widgetBox?.width ?? 0) / 2 - ((formBox?.x ?? 0) + (formBox?.width ?? 0) / 2)),
  ).toBeLessThan(2);
  await page.getByLabel("Alamat email").fill("person@example.test");
  const submitButton = page.getByRole("button", { name: "Lanjutkan dengan email" });
  await expect(submitButton).toBeEnabled({ timeout: 15_000 });
  await submitButton.click();
  await expect(
    page.getByText(
      "Periksa kotak masuk. Biarkan aplikasi terpasang ini tetap terbuka; sesi akan diteruskan otomatis setelah tautan dibuka.",
    ),
  ).toBeVisible();
  expect(handoffId).toBeTruthy();

  const browser = await context.newPage();
  try {
    await browser.goto(
      `/auth/pwa-confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&next=%2Fvaults%2Finvitations%2Fredeem&handoff=${handoffId}`,
    );
    await expect.poll(() => handoffPublished).toBe(true);
    await expect.poll(() => handoffAccepted).toBe(true);
    await expect(page.getByText("Meneruskan sesi masuk ke aplikasi terpasang…")).toBeVisible({ timeout: 15_000 });
    expect(pollSentRefreshCredential).toBe(false);
  } finally {
    await browser.close();
  }
});

test("switches to English without changing routes and persists through redirects and reloads", async ({ page }) => {
  await page.goto("/ui-preview");
  await switchLanguage(page, "English", "en");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('[data-landing-desktop-scene="true"]')).toHaveAttribute("data-scene-step", "locked");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/sign-in");
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with email" })).toBeVisible();
  await expect(page.getByText("Sign in or create an account with a verified email address.")).toBeVisible();

  const manifest = await page.evaluate(async () => fetch("/manifest.webmanifest").then((response) => response.json()));
  expect(manifest).toMatchObject({
    lang: "en-US",
    description: "Zero-knowledge shared authenticator",
    id: "/vaults",
    start_url: "/vaults",
    scope: "/",
  });

  await page.goto("/vaults");
  await expect(page).toHaveURL(/\/sign-in\?auth=required$/);
  await expect(page.getByText("Sign in to continue.")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.goto("/ui-preview");
  await switchLanguage(page, "Bahasa Indonesia", "id");
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(page.getByText("Masuk atau buat akun dengan alamat email terverifikasi.")).toBeVisible();
});

test("renders representative English OTP, Shared Vault, validation, and recovery previews", async ({ page }) => {
  await page.goto("/ui-preview");
  await switchLanguage(page, "English", "en");
  await expect(page.getByLabel("Account settings")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Authenticator accounts" })).toBeVisible();
  await expect(page.getByText("Sample service", { exact: true })).toBeVisible();
  await expect(page.getByText("Work account", { exact: true })).toBeVisible();

  await page.route("**/api/v1/shared-vaults/shared-preview/participants**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        owner: { id: "preview-owner", email: "owner@local.invalid" },
        vaultDefaultAccountPermissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false },
        vaultDefaultAccountPermissionsRevision: 1,
        participants: [
          {
            key: "member:preview-member",
            email: "member@local.invalid",
            kind: "MEMBER",
            userId: "preview-member",
            invitationId: null,
            invitationState: null,
            invitedAt: "2026-07-26T12:00:00.000Z",
            expiresAt: null,
            permissionOverrides: { canAddAccounts: null, canEditAccounts: null, canDeleteAccounts: null },
            effectiveAccountPermissions: {
              permissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false },
              sources: { canAddAccounts: "VAULT", canEditAccounts: "VAULT", canDeleteAccounts: "VAULT" },
            },
            permissionsRevision: 1,
          },
        ],
        nextCursor: null,
      }),
    }),
  );
  await page.goto("/ui-preview/vaults");
  await expect(page.getByRole("heading", { level: 1, name: "Vaults" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const permissionHelp = page.getByRole("button", { name: "Open guide: Shared Vault member permissions" });
  const permissionTitle = page.getByText("Default member account permissions", { exact: true });
  const permissionToggle = page.getByRole("button", { name: /Default member account permissions/ });
  const chevron = await permissionToggle.locator("svg").boundingBox();
  const [permissionControlBounds, titleBounds, cardRight] = await Promise.all([
    permissionHelp.boundingBox(),
    permissionTitle.boundingBox(),
    permissionHelp.evaluate((button) => button.closest("form")?.getBoundingClientRect().right ?? null),
  ]);
  expect(permissionControlBounds).not.toBeNull();
  expect(titleBounds).not.toBeNull();
  expect(cardRight).not.toBeNull();
  expect(chevron).not.toBeNull();
  expect(Math.abs((permissionControlBounds?.y ?? 0) - (titleBounds?.y ?? 0))).toBeLessThanOrEqual(4);
  expect(Math.abs((chevron?.y ?? 0) - (titleBounds?.y ?? 0))).toBeLessThanOrEqual(4);
  expect((permissionControlBounds?.x ?? 0) + (permissionControlBounds?.width ?? 0)).toBeLessThan((cardRight ?? 0) - 8);
  await permissionHelp.focus();
  await page.keyboard.press("Enter");
  const defaultHelpDialog = page.getByRole("dialog");
  await expect(defaultHelpDialog.getByRole("heading", { name: "Shared Vault member permissions" })).toBeVisible();
  const helpBounds = await defaultHelpDialog.boundingBox();
  expect(helpBounds).not.toBeNull();
  expect(helpBounds?.x).toBeGreaterThanOrEqual(0);
  expect((helpBounds?.x ?? 0) + (helpBounds?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(helpBounds?.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(defaultHelpDialog).toHaveCount(0);
  await expect(permissionHelp).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("tab", { name: "Invitations" }).click();
  const invitationEmail = page.getByLabel("Recipient email");
  await invitationEmail.fill("reader@local.invalid");
  const invitationHelp = page.getByRole("button", { name: "Open guide: Shared Vault invitations" });
  await invitationHelp.focus();
  await page.keyboard.press("Enter");
  const invitationHelpDialog = page.getByRole("dialog");
  await expect(invitationHelpDialog.getByRole("heading", { name: "Shared Vault invitations" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(invitationHelpDialog).toHaveCount(0);
  await expect(invitationHelp).toBeFocused();
  await expect(invitationEmail).toHaveValue("reader@local.invalid");

  await expect(page.getByText("member@local.invalid")).toBeVisible();
  const memberHelp = page.getByRole("button", { name: "Open guide: Shared Vault member permissions" });
  await memberHelp.click();
  const memberHelpDialog = page.getByRole("dialog");
  await expect(memberHelpDialog.getByRole("heading", { name: "Shared Vault member permissions" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(memberHelpDialog).toHaveCount(0);
  await expect(memberHelp).toBeFocused();

  await page.getByRole("button", { name: "Configure account permissions for member@local.invalid" }).click();
  const memberPermissionsDialog = page.getByRole("dialog");
  await expect(memberPermissionsDialog.getByRole("heading", { name: "Member account permissions" })).toBeVisible();
  await memberPermissionsDialog.getByRole("button", { name: "Cancel" }).click();
  await invitationEmail.fill("");

  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();

  await page.goto("/ui-preview/archive-import");
  await expect(page.getByRole("heading", { name: "Open encrypted archive" })).toBeVisible();
  const previewArchiveButton = page.getByRole("button", { name: "Preview archive" });
  await expect(previewArchiveButton).toBeEnabled();
  await previewArchiveButton.click();
  await expect(page.getByText("Archive file is required.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Archive key is required.")).toBeVisible({ timeout: 15_000 });

  await page.goto("/ui-preview/archive-backup");
  await expect(page.getByRole("heading", { name: "Vault backup" })).toBeVisible();
  await page.getByRole("button", { name: "Create backup" }).click();
  await expect(page.getByText("Confirm that you will store the key separately.")).toBeVisible();

  await page.goto("/ui-preview/recovery");
  await expect(page.getByRole("heading", { name: "Delete encrypted data and start over" })).toBeVisible();
  await expect(page.getByLabel(/Type HAPUS DATA BRANKAS/)).toBeVisible();
});

test("redirects unauthenticated users away from protected pages", async ({ page }) => {
  for (const pathname of ["/vaults", "/vaults/accounts/new", "/vaults/recovery", "/totp"]) {
    await page.goto(pathname);
    await expect(page).toHaveURL(/\/sign-in\?auth=required$/);
    await expect(page.getByText("Silakan masuk untuk melanjutkan.")).toBeVisible();
  }
});

async function switchLanguage(
  page: import("@playwright/test").Page,
  language: "Bahasa Indonesia" | "English",
  locale: "id" | "en",
) {
  const isPreview = new URL(page.url()).pathname === "/ui-preview";
  if (isPreview) {
    await page.getByLabel(/Pengaturan akun|Account settings/).click();
    await page.locator('[data-slot="dropdown-menu-sub-trigger"]').click();
  } else {
    const languageTrigger = (await page.locator("main.landing-page").count())
      ? page
          .locator(
            'main.landing-page > header button[aria-label="Pilih bahasa"], main.landing-page > header button[aria-label="Choose language"]',
          )
          .first()
      : page.locator('button[aria-label="Pilih bahasa"]:visible, button[aria-label="Choose language"]:visible').first();
    await expect(languageTrigger).toBeVisible();
    await languageTrigger.click();
  }
  await page.getByRole("menuitemradio", { name: language }).click();
  await page.getByRole("button", { name: locale === "en" ? "Ganti bahasa" : "Change language" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  if (!isPreview) {
    const languageButton = (await page.locator("main.landing-page").count())
      ? page
          .locator(
            'main.landing-page > header:not([data-testid="landing-sticky-header"]) button[aria-label="Pilih bahasa"], main.landing-page > header:not([data-testid="landing-sticky-header"]) button[aria-label="Choose language"]',
          )
          .first()
      : page.locator('button[aria-label="Pilih bahasa"]:visible, button[aria-label="Choose language"]:visible').first();
    await expect(languageButton).toHaveAttribute("title", new RegExp(language), { timeout: 15_000 });
  }
  if (isPreview) {
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
}

test("logs out a stale session idempotently", async ({ page }) => {
  await page.goto("/sign-in");
  const response = await page.request.post("/auth/logout", {
    headers: {
      origin: new URL(page.url()).origin,
    },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  const noticePage = await page.context().newPage();
  try {
    await noticePage.goto(response.headers().location);
    await expect(noticePage).toHaveURL(/\/sign-in\?auth=signed_out$/, { timeout: 15_000 });
    await expect(noticePage.getByText("Anda telah keluar.")).toBeVisible({ timeout: 15_000 });
  } finally {
    await noticePage.close();
  }
});
