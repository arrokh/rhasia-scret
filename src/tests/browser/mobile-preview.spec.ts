import { expect, test } from "@playwright/test";

test("renders the ciphertext-free vault layout at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ui-preview");
  await expect(page.getByRole("heading", { level: 1, name: "Akun autentikator" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keluar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Brankas Bersama" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tambahkan akun autentikator" })).toBeVisible();
  await expect(page.getByText("Brankas Pribadi")).toBeVisible();
  await expect(page.getByText("Tim Operasional")).toBeVisible();
  await expect(page.getByText(/Tidak ada materi akun, passphrase, OTP, atau kunci/)).toBeVisible();
});

test("requires explicit confirmation for destructive Personal Vault reset", async ({ page }) => {
  let submittedBody: unknown;
  await page.route("**/api/personal-vault/destructive-reset", async (route) => {
    submittedBody = route.request().postDataJSON();
    await route.fulfill({ status: 204 });
  });
  await page.goto("/ui-preview/recovery");

  await expect(page.getByRole("heading", { name: "Hapus data terenkripsi dan mulai ulang" })).toBeVisible();
  await expect(page.getByText(/Brankas Bersama milik orang lain dan data anggotanya tidak akan dihapus/)).toBeVisible();
  await page.getByLabel(/Ketik HAPUS DATA BRANKAS/).fill("HAPUS DATA BRANKAS");
  await page.getByRole("button", { name: "Hapus data dan atur ulang brankas" }).click();

  await expect.poll(() => submittedBody).toEqual({ confirmation: "HAPUS DATA BRANKAS" });
});
