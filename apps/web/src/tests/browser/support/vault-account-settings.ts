import { expect, type Page } from "@playwright/test";

type SupportedLocale = "id" | "en";

const labels = {
  id: { settings: "Pengaturan akun", lock: "Kunci" },
  en: { settings: "Account settings", lock: "Lock" },
} as const;

export async function expectVaultLockAction(
  page: Page,
  locale: SupportedLocale = "id",
  timeout = 120_000,
): Promise<void> {
  const lock = await openAccountSettings(page, locale, timeout);
  await expect(lock).toBeVisible({ timeout });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: labels[locale].settings })).toHaveAttribute("aria-expanded", "false");
}

export async function lockVaultFromSettings(page: Page, locale: SupportedLocale = "id"): Promise<void> {
  const lock = await openAccountSettings(page, locale, 30_000);
  await lock.click();
  await expect(page.getByRole("button", { name: labels[locale].settings })).toHaveAttribute("aria-expanded", "false");
}

async function openAccountSettings(page: Page, locale: SupportedLocale, timeout: number) {
  const settings = page.getByRole("button", { name: labels[locale].settings });
  await expect(settings).toBeVisible({ timeout });
  if ((await settings.getAttribute("aria-expanded")) !== "true") await settings.click();
  return page.getByRole("button", { name: labels[locale].lock, exact: true });
}
