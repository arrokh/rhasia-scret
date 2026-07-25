import { expect, test } from "@playwright/test";

test("renders the ciphertext-free vault layout at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ui-preview");
  await expect(page.getByRole("heading", { name: "Authenticator accounts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Personal Vault accounts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add encrypted account" })).toBeVisible();
  await expect(page.getByText(/No account, secret, OTP, or key material/)).toBeVisible();
});
