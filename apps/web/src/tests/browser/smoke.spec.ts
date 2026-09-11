import { expect, test } from "@playwright/test";

test("renders the browser smoke page", async ({ page }) => {
  await page.goto("/smoke");
  await expect(page.getByTestId("smoke-ready")).toHaveText("Siap");
});

test("renders the public landing page in Bahasa Indonesia", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(page).toHaveTitle("rhasia-scret");
  const brandLink = page.getByRole("link", { name: "rhasia-scret" }).first();
  await expect(brandLink).toBeVisible();
  const brandIcon = brandLink.locator("img");
  await expect(brandIcon).toHaveAttribute("src", /icon512_rounded\.png/);
  expect(await brandIcon.locator("..").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    "rgba(0, 0, 0, 0)",
  );
  await expect(page.getByRole("heading", { name: /Autentikator Anda, sesuai ketentuan Anda/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Apa itu rhasia-scret?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tetap lokal. Pindah hanya saat bermanfaat." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Gunakan Hosted Vault" })).toHaveAttribute("href", "/sign-in");
  const landingHeader = page.locator("main > header");
  await expect(landingHeader.getByRole("link", { name: "Masuk" })).toHaveCount(0);
  await expect(landingHeader.getByRole("link", { name: "Repositori GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/arrokh/rhasia-scret",
  );
  const localVaultLink = page.locator('a[href="/local?from=landing"]').first();
  await expect(localVaultLink).toBeVisible();
  await expect(localVaultLink).toHaveAttribute("href", "/local?from=landing");
  const landingFooter = page
    .locator("main.landing-page")
    .locator("footer")
    .filter({
      has: page.locator('a[href*="sign-in"]'),
    });
  await expect(landingFooter).toBeVisible();
  const signInLink = landingFooter.locator('a[href*="sign-in"]').first();
  await expect(signInLink).toBeVisible();
  await expect(signInLink).toHaveAttribute("href", /(^https:\/\/rhasia-scret\.vercel\.app)?\/sign-in$/);
  await expect(landingFooter.locator('a[href="https://nooroctavian.id/"]').first()).toHaveAttribute(
    "href",
    "https://nooroctavian.id/",
  );
  await expect(landingFooter.getByRole("link", { name: "Privasi" })).toHaveAttribute("href", "/privacy");
  await expect(landingFooter.getByRole("link", { name: "Dukungan" })).toHaveAttribute("href", "/support");
  await page.evaluate(() => {
    const heroEnd = document.getElementById("landing-hero-end");
    const fallback = document.body.scrollHeight;
    const target = heroEnd ? heroEnd.getBoundingClientRect().top + window.scrollY + 1 : fallback;
    window.scrollTo({ top: target, behavior: "instant" });
    window.dispatchEvent(new Event("scroll"));
  });
  const stickyHeader = page.getByTestId("landing-sticky-header");
  await expect(stickyHeader).toHaveAttribute("aria-hidden", "false", { timeout: 10_000 });
  await expect(stickyHeader.getByRole("link", { name: "Coba Local Vault" })).toHaveAttribute(
    "href",
    "/local?from=landing",
  );
  await expect(stickyHeader.getByRole("link", { name: "Gunakan Hosted Vault" })).toHaveAttribute("href", "/sign-in");
  await expect(stickyHeader.getByRole("button", { name: "Pilih bahasa" })).toBeVisible();
  await expect(page.getByLabel("Alamat email yang diundang")).toHaveCount(0);
});

test("aligns the landing footer as brand and a right-side utility group", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 600, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const alignment = await page.locator("main.landing-page > footer > div").evaluate((footer) => {
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
    await expect(
      page.locator("main.landing-page > footer").getByRole("button", { name: "Pilih bahasa" }),
    ).toBeVisible();
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const desktopAlignment = await page.locator("main.landing-page > footer > div").evaluate((footer) => {
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
  await expect(page.locator("main.landing-page > footer").getByRole("button")).toHaveCount(0);
});

test("keeps every Vault flow connector straight at mobile and desktop widths", async ({ page }) => {
  for (const viewport of [
    { width: 430, height: 932 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const connectorGeometry = await page
      .locator(".comparison-flow-device, .comparison-flow-service")
      .evaluateAll((cards) =>
        cards.map((card) => {
          const connector = card.querySelector<HTMLElement>(
            ".comparison-flow-device-connector, .comparison-flow-service-connector",
          );
          const cardBox = card.getBoundingClientRect();
          const connectorBox = connector?.getBoundingClientRect();
          return {
            connectorHeight: connectorBox?.height ?? Number.POSITIVE_INFINITY,
            centerDelta: Math.abs(
              (connectorBox?.top ?? 0) + (connectorBox?.height ?? 0) / 2 - (cardBox.top + cardBox.height / 2),
            ),
          };
        }),
      );

    expect(connectorGeometry).toHaveLength(6);
    expect(
      connectorGeometry.every(({ connectorHeight, centerDelta }) => connectorHeight <= 1.5 && centerDelta <= 1),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("renders email authentication and signup at sign in", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByLabel("Alamat email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lanjutkan dengan email" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Buka snapshot luring" })).toHaveAttribute("href", "/offline");
});

test("switches to English without changing routes and persists through redirects and reloads", async ({ page }) => {
  await page.goto("/");
  await switchLanguage(page, "English", "en");

  await expect(
    page.locator('main.landing-page > header:not([data-testid="landing-sticky-header"])').getByRole("button", {
      name: "Choose language",
    }),
  ).toContainText("English");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Use Hosted Vault" })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("link", { name: "Use Hosted Vault" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
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

  await switchLanguage(page, "Bahasa Indonesia", "id");
  await expect(page.getByRole("button", { name: "Pilih bahasa" })).toHaveAttribute(
    "title",
    "Bahasa saat ini: Bahasa Indonesia",
  );
  await expect(page.getByText("Silakan masuk untuk melanjutkan.")).toBeVisible();
});

test("renders representative English OTP, Shared Vault, validation, and recovery previews", async ({ page }) => {
  await page.goto("/ui-preview");
  await switchLanguage(page, "English", "en");
  await expect(page.getByLabel("Account settings")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Authenticator accounts" })).toBeVisible();
  await expect(page.getByText("Sample service", { exact: true })).toBeVisible();
  await expect(page.getByText("Work account", { exact: true })).toBeVisible();

  await page.goto("/ui-preview/vaults");
  await expect(page.getByRole("heading", { level: 1, name: "Vaults" })).toBeVisible();
  await page.getByRole("tab", { name: "Invitations" }).click();
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
    const cancelLanguageDialog = page.getByRole("dialog").getByRole("button", { name: /Batal|Cancel/ });
    await expect(cancelLanguageDialog).toBeEnabled();
    await cancelLanguageDialog.click();
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
