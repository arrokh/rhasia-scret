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
});

test("redirects unauthenticated users away from protected pages", async ({ page }) => {
  for (const pathname of ["/vaults", "/totp"]) {
    await page.goto(pathname);
    await expect(page).toHaveURL(/\/?auth=required$/);
    await expect(page.getByText("Silakan masuk untuk melanjutkan.")).toBeVisible();
  }
});

test("logs out a stale session idempotently", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/auth/logout";
    document.body.append(form);
    form.submit();
  });

  await expect(page).toHaveURL(/\/?auth=signed_out$/);
  await expect(page.getByText("Anda telah keluar.")).toBeVisible();
});
