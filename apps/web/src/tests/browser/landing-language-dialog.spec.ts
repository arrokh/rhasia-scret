import { expect, test } from "@playwright/test";

for (const locale of ["id", "en"] as const) {
  test(`lets a first-time visitor choose ${locale} with the keyboard and remembers it after reload`, async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/landing");

    const dialog = page.locator('[role="dialog"][data-landing-language-choice="true"]:visible');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Choose your language");
    await expect(dialog).toContainText("Pilih bahasa");
    const firstChoice = dialog.getByRole("button", { name: "Bahasa Indonesia" });
    const selectedLanguage = dialog.getByRole("button", { name: locale === "id" ? "Bahasa Indonesia" : "English" });
    await expect(firstChoice).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();

    if (locale === "en") {
      await page.keyboard.press("Tab");
      await expect(selectedLanguage).toBeFocused();
    }
    await page.keyboard.press("Enter");

    await expect(dialog).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page).toHaveURL(/\/landing$/);
    await expect
      .poll(async () => (await context.cookies()).find((cookie) => cookie.name === "RHSIA_LOCALE")?.value)
      .toBe(locale);

    await page.reload();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  });
}

test("keeps the landing intro still behind the chooser on a narrow screen", async ({ page, context }) => {
  await context.clearCookies();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/landing");

  const dialog = page.locator('[role="dialog"][data-landing-language-choice="true"]:visible');
  await expect(dialog).toBeVisible();
  const dialogBounds = await dialog.boundingBox();
  expect(dialogBounds).not.toBeNull();
  expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(320);
  await expect(dialog.getByRole("button", { name: "Bahasa Indonesia" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "English" })).toBeVisible();

  await page.mouse.wheel(0, 700);
  await page.keyboard.press("PageDown");
  await expect(page.locator("[data-landing-desktop-scene]")).toHaveAttribute("data-scene-step", "locked");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await dialog.getByRole("button", { name: "Bahasa Indonesia" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await page.reload();
  await expect(dialog).toHaveCount(0);
});

test("skips the chooser for a valid locale cookie and reopens it for an invalid value", async ({ page, context }) => {
  await context.clearCookies();
  await context.addCookies([
    {
      name: "RHSIA_LOCALE",
      value: "en",
      url: "http://127.0.0.1",
    },
  ]);
  await page.goto("/landing");

  const dialog = page.locator('[role="dialog"][data-landing-language-choice="true"]:visible');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await context.clearCookies();
  await context.addCookies([
    {
      name: "RHSIA_LOCALE",
      value: "fr",
      url: "http://127.0.0.1",
    },
  ]);
  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
});
