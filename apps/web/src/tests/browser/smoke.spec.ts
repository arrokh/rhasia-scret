import { expect, test } from "@playwright/test";

test("opens the hosted sign-in entry with device-only and offline alternatives", async ({ page }) => {
  await page.goto("/sign-in");

  await expect(page.getByLabel("Alamat email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lanjutkan dengan email" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Buka Brankas Lokal" })).toHaveAttribute("href", "/local");
  await expect(page.getByRole("link", { name: "Buka snapshot luring" })).toHaveAttribute("href", "/offline");
});

test("preserves the selected locale when an unauthenticated visitor is redirected to sign-in", async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error("The browser test base URL is unavailable.");
  await page.context().clearCookies();

  for (const locale of ["id", "en"] as const) {
    await page.context().addCookies([{ name: "RHSIA_LOCALE", value: locale, url: baseURL }]);
    await page.goto("/vaults");

    await expect(page).toHaveURL(/\/sign-in\?auth=required$/);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByLabel(locale === "id" ? "Alamat email" : "Email address")).toBeVisible();
  }
});
