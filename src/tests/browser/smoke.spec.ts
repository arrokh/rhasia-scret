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

test("switches to English without changing routes and persists through redirects and reloads", async ({ page }) => {
  await page.goto("/");
  await switchLanguage(page, "English", "en");

  await expect(page.getByRole("button", { name: "Choose language" })).toContainText("English");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByLabel("Invited email address")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeVisible();
  await expect(page.getByText(/Access is invitation-only/)).toBeVisible();

  const manifest = await page.evaluate(async () => fetch("/manifest.webmanifest").then((response) => response.json()));
  expect(manifest).toMatchObject({ lang: "en-US", description: "Zero-knowledge shared authenticator", start_url: "/", scope: "/" });

  await page.goto("/vaults");
  await expect(page).toHaveURL(/\/sign-in\?auth=required$/);
  await expect(page.getByText("Sign in to continue.")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await switchLanguage(page, "Bahasa Indonesia", "id");
  await expect(page.getByRole("button", { name: "Pilih bahasa" })).toContainText("Bahasa Indonesia");
  await expect(page.getByText("Silakan masuk untuk melanjutkan.")).toBeVisible();
});

test("renders representative English OTP, Shared Vault, validation, and recovery previews", async ({ page }) => {
  await page.goto("/ui-preview");
  await switchLanguage(page, "English", "en");
  await expect(page.getByRole("button", { name: "Choose language" })).toContainText("English");
  await expect(page.getByRole("heading", { level: 1, name: "Authenticator accounts" })).toBeVisible();
  await expect(page.getByText("Sample service", { exact: true })).toBeVisible();
  await expect(page.getByText("Work account", { exact: true })).toBeVisible();

  await page.goto("/ui-preview/vaults");
  await expect(page.getByRole("heading", { level: 1, name: "Vaults" })).toBeVisible();
  await page.getByRole("tab", { name: "Invitations" }).click();
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();

  await page.goto("/ui-preview/archive-import");
  await page.getByRole("button", { name: "Preview archive" }).click();
  await expect(page.getByText("Archive file is required.")).toBeVisible();
  await expect(page.getByText("Archive key is required.")).toBeVisible();

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

async function switchLanguage(page: import("@playwright/test").Page, language: "Bahasa Indonesia" | "English", locale: "id" | "en") {
  await page.getByRole("button", { name: /Pilih bahasa|Choose language/ }).click();
  await page.getByRole("menuitemradio", { name: language }).click();
  await page.getByRole("button", { name: locale === "en" ? "Ganti bahasa" : "Change language" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

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
