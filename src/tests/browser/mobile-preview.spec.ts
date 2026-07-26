import { expect, test } from "@playwright/test";

test("renders the ciphertext-free vault layout at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ui-preview");
  await expect(page.getByRole("heading", { name: "Akun autentikator" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Akun Brankas Pribadi" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tambahkan akun terenkripsi" })).toBeVisible();
  await expect(page.getByText(/Tidak ada materi akun, rahasia, OTP, atau kunci/)).toBeVisible();
});
