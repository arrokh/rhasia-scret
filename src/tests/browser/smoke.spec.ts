import { expect, test } from "@playwright/test";

test("renders the browser smoke page", async ({ page }) => {
  await page.goto("/smoke");
  await expect(page.getByTestId("smoke-ready")).toHaveText("Siap");
});

test("renders public product copy in Bahasa Indonesia", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(page).toHaveTitle("Brankas TOTP Bersama");
  await expect(page.getByRole("heading", { name: "Brankas TOTP Bersama" })).toBeVisible();
  await expect(page.getByLabel("Alamat email yang diundang")).toBeVisible();
  await expect(page.getByRole("button", { name: "Kirim tautan masuk" })).toBeVisible();

  await page.goto("/totp");
  await expect(page.getByRole("heading", { name: "TOTP Lokal" })).toBeVisible();
  await expect(page.getByLabel("URI autentikator")).toBeVisible();
  await expect(page.getByRole("button", { name: "Buat kode" })).toBeVisible();
});
