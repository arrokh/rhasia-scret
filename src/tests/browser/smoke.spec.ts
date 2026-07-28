import { expect, test } from "@playwright/test";

test("renders the browser smoke page", async ({ page }) => {
  await page.goto("/smoke");
  await expect(page.getByTestId("smoke-ready")).toHaveText("Siap");
});

test("renders the public landing page in Bahasa Indonesia", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(page).toHaveTitle("rhasia-scret");
  const brandHeading = page.getByRole("heading", { name: "rhasia-scret" });
  await expect(brandHeading).toBeVisible();
  const brandIcon = brandHeading.locator("img");
  await expect(brandIcon).toHaveAttribute("src", /icon512_rounded\.png/);
  expect(await brandIcon.locator("..").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  await expect(page.getByText("Autentikator TOTP terenkripsi")).toBeVisible();
  await expect(page.getByRole("link", { name: "Masuk" })).toHaveAttribute("href", "/sign-in");
  await expect(page.getByLabel("Alamat email yang diundang")).toHaveCount(0);
});

test("renders invite-only authentication at sign in", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByLabel("Alamat email yang diundang")).toBeVisible();
  await expect(page.getByRole("button", { name: "Kirim tautan masuk" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Buka snapshot luring" })).toHaveAttribute("href", "/offline");
});

test("redirects unauthenticated users away from protected pages", async ({ page }) => {
  for (const pathname of ["/vaults", "/vaults/accounts/new", "/vaults/recovery", "/totp"]) {
    await page.goto(pathname);
    await expect(page).toHaveURL(/\/sign-in\?auth=required$/);
    await expect(page.getByText("Silakan masuk untuk melanjutkan.")).toBeVisible();
  }
});

test("logs out a stale session idempotently", async ({ page }) => {
  await page.goto("/sign-in");
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/auth/logout";
    document.body.append(form);
    form.submit();
  });

  await expect(page).toHaveURL(/\/sign-in\?auth=signed_out$/, { timeout: 15_000 });
  await expect(page.getByText("Anda telah keluar.")).toBeVisible({ timeout: 15_000 });
});
