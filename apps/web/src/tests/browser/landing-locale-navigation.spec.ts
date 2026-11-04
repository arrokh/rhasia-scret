import { expect, test } from "@playwright/test";

for (const cookie of ["missing", "invalid"] as const) {
  test(`opens landing without a language modal with a ${cookie} locale cookie`, async ({ page, context }) => {
    await context.clearCookies();
    if (cookie === "invalid") {
      await context.addCookies([{ name: "RHSIA_LOCALE", value: "fr", url: "http://127.0.0.1" }]);
    }
    await context.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/landing");
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("[data-landing-header]").getByRole("button", { name: "Pilih bahasa" })).toBeVisible();
    if (cookie === "missing") {
      expect((await context.cookies()).some((entry) => entry.name === "RHSIA_LOCALE")).toBe(false);
    }
    const scene = page.locator("[data-landing-desktop-scene]:visible");
    await expect(scene).toHaveAttribute("data-input-ready", "true");
    await page.keyboard.press("PageDown");
    await expect(scene).toHaveAttribute("data-scene-step", "unlocked", { timeout: 20_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

for (const locale of ["id", "en"] as const) {
  test(`changes locale to ${locale} from the navbar and remembers it after reload`, async ({ page, context }) => {
    const initialLocale = locale === "id" ? "en" : "id";
    await context.clearCookies();
    await context.addCookies([{ name: "RHSIA_LOCALE", value: initialLocale, url: "http://127.0.0.1" }]);
    await page.goto("/landing");
    await expect(page.locator("html")).toHaveAttribute("lang", initialLocale);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const scene = page.locator("[data-landing-desktop-scene]:visible");
    await expect(scene).toHaveAttribute("data-input-ready", "true");
    const language = page.locator("[data-landing-header]").getByRole("button", {
      name: initialLocale === "id" ? "Pilih bahasa" : "Choose language",
    });
    await language.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menu")).toBeVisible();
    const choice = page.getByRole("menuitemradio", { name: locale === "id" ? "Bahasa Indonesia" : "English" });
    await choice.focus();
    await page.keyboard.press("Enter");
    const confirmation = page.getByRole("dialog");
    await expect(confirmation).toBeVisible();
    await confirmation
      .getByRole("button", { name: initialLocale === "id" ? "Ganti bahasa" : "Change language", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(confirmation).toHaveCount(0);
    await expect
      .poll(async () => (await context.cookies()).find((entry) => entry.name === "RHSIA_LOCALE")?.value)
      .toBe(locale);
    await expect(page).toHaveURL(/\/landing$/);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
