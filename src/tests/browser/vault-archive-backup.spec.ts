import { expect, test } from "@playwright/test";
import { openEncryptedVaultExport } from "@/modules/crypto/infrastructure/browser-vault-export";

test.describe("encrypted Vault archive backup", () => {
  test("audits before releasing a client-only V1 archive and separate key", async ({ page }) => {
    let auditBody: string | null | undefined;
    await page.route("**/api/vaults/preview-personal-vault/archive-exports", async (route) => {
      auditBody = route.request().postData();
      await route.fulfill({ status: 204 });
    });
    await page.goto("/ui-preview/archive-backup");
    await page.getByLabel("Brankas").click();
    await expect(page.getByRole("option", { name: /Brankas Tim/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Brankas Viewer/ })).toHaveCount(0);
    const selectedOption = page.getByRole("option", { name: /Brankas Pribadi/ });
    expect((await selectedOption.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expect(selectedOption).toHaveCSS("font-weight", "700");
    await expect(page.locator('[data-slot="select-content"]')).toHaveCSS("border-style", "solid");
    await page.keyboard.press("Escape");
    await page.getByLabel(/Saya akan menyimpan kunci arsip/).check();
    await page.getByRole("button", { name: "Buat cadangan" }).click();
    await expect(page.getByRole("heading", { name: "Simpan kunci cadangan" })).toBeVisible();
    expect(auditBody ?? null).toBeNull();

    const keyMaterial = await page.getByRole("textbox", { name: "Kunci arsip Base64", exact: true }).inputValue();
    expect(Buffer.from(keyMaterial, "base64")).toHaveLength(32);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Unduh arsip" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^rhasia-vault-\d{4}-\d{2}-\d{2}\.rhasia-vault$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const opened = await openArchive(Buffer.concat(chunks), Buffer.from(keyMaterial, "base64"));
    expect(opened.vaultName).toBe("Brankas Pribadi");
    expect(opened.accounts).toHaveLength(1);
    expect(Buffer.from(opened.accounts[0], "base64").toString("utf8")).toContain("sample@local.invalid");
    const keyDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Unduh kunci" }).click();
    const keyDownload = await keyDownloadPromise;
    expect(keyDownload.suggestedFilename()).toMatch(/^rhasia-vault-\d{4}-\d{2}-\d{2}\.key\.txt$/);
    const keyStream = await keyDownload.createReadStream();
    const keyChunks: Buffer[] = [];
    for await (const chunk of keyStream) keyChunks.push(Buffer.from(chunk));
    expect(Buffer.concat(keyChunks).toString("utf8").trim()).toBe(keyMaterial);

    await page.getByRole("button", { name: "Selesai dan hapus kunci dari layar" }).click();
    await expect(page.getByRole("textbox", { name: "Kunci arsip Base64", exact: true })).toHaveCount(0);
    const persisted = await page.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
    for (const value of [keyMaterial, "Penerbit contoh", "sample@local.invalid"]) expect(persisted).not.toContain(value);
  });

  test("clears prepared archive material when the Vault is locked", async ({ page }) => {
    await page.route("**/api/vaults/preview-personal-vault/archive-exports", async (route) => route.fulfill({ status: 204 }));
    await page.goto("/ui-preview/archive-backup");
    await page.getByLabel(/Saya akan menyimpan kunci arsip/).check();
    await page.getByRole("button", { name: "Buat cadangan" }).click();
    const keyMaterial = await page.getByRole("textbox", { name: "Kunci arsip Base64", exact: true }).inputValue();
    await page.evaluate(() => window.dispatchEvent(new Event("rhasia-scret:lock-local-vault")));
    await expect(page.getByText("Brankas telah dikunci dan materi cadangan telah dihapus.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Kunci arsip Base64", exact: true })).toHaveCount(0);
    const persisted = await page.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
    expect(persisted).not.toContain(keyMaterial);
  });

  test("does not release archive or key when audit recording fails", async ({ page }) => {
    await page.route("**/api/vaults/preview-personal-vault/archive-exports", async (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "audit_unavailable" }) }));
    await page.goto("/ui-preview/archive-backup");
    await page.getByLabel(/Saya akan menyimpan kunci arsip/).check();
    await page.getByRole("button", { name: "Buat cadangan" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Cadangan terenkripsi tidak dapat dibuat atau dicatat dalam audit." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Unduh arsip" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Kunci arsip Base64", exact: true })).toHaveCount(0);
  });

  test("blocks and never queues backup while offline", async ({ page, context }) => {
    let auditRequests = 0;
    await page.route("**/api/vaults/preview-personal-vault/archive-exports", async (route) => { auditRequests += 1; await route.abort(); });
    await page.goto("/ui-preview/archive-backup");
    await context.setOffline(true);
    await expect(page.getByText("Anda luring. Cadangan diblokir dan tidak akan diantrikan.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buat cadangan" })).toBeDisabled();
    expect(auditRequests).toBe(0);
    await context.setOffline(false);
  });
});

async function openArchive(archive: Uint8Array, keyBytes: Uint8Array): Promise<{ vaultName: string; accounts: string[] }> {
  const opened = await openEncryptedVaultExport(keyBytes, archive);
  try {
    return {
      vaultName: opened.vaultName,
      accounts: opened.accounts.map((account) => Buffer.from(account).toString("base64"))
    };
  } finally {
    for (const account of opened.accounts) account.fill(0);
  }
}
