import { expect, test, type Page } from "@playwright/test";
import { createEncryptedVaultArchive } from "@/modules/crypto/infrastructure/browser-vault-export";

const archiveKey = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);
const archiveKeyBase64 = Buffer.from(archiveKey).toString("base64");
const sensitive = { vaultName: "Imported Secret Vault", issuer: "Private Issuer", accountName: "secret@example.test", secret: Uint8Array.from([9, 8, 7, 6]) };

test.describe("encrypted Vault archive import", () => {
  test("previews entirely in memory and explicit cancellation clears the draft before mutation", async ({ page }) => {
    let requests = 0;
    await page.route("**/api/vault-imports", async (route) => { requests += 1; await route.abort(); });
    await page.goto("/ui-preview/archive-import");
    await openArchive(page, await encryptedArchive(sensitive));

    await expect(page.getByRole("heading", { name: "Pratinjau arsip" })).toBeVisible();
    await expect(page.getByText(sensitive.vaultName, { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText("1", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Kunci arsip Base64")).toHaveCount(0);

    await page.getByRole("button", { name: "Batal" }).click();
    await expect(page.getByRole("heading", { name: "Buka arsip terenkripsi" })).toBeVisible();
    await expect(page.getByText(sensitive.vaultName, { exact: true })).toHaveCount(0);
    expect(requests).toBe(0);
    await openArchive(page, await encryptedArchive(sensitive));
    await page.evaluate(() => window.dispatchEvent(new Event("rhasia-scret:lock-local-vault")));
    await expect(page.getByRole("heading", { name: "Pratinjau arsip" })).toHaveCount(0);
    await expectNoSensitivePersistence(page, [sensitive.vaultName, sensitive.issuer, sensitive.accountName, Buffer.from(sensitive.secret).toString("base64"), archiveKeyBase64]);
  });

  test("confirms and atomically uploads re-encrypted ciphertext to a new Shared Vault", async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on("console", (message) => consoleMessages.push(message.text()));
    let requestBody: Record<string, unknown> | undefined;
    await page.route("**/api/vault-imports", async (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      const destination = requestBody.destination as { vaultId: string };
      const accounts = requestBody.accounts as Array<{ id: string }>;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ vaultId: destination.vaultId, accountIds: accounts.map(({ id }) => id), vaultCreated: true, replayed: false }) });
    });
    await page.setViewportSize({ width: 982, height: 752 });
    await page.goto("/ui-preview/archive-import");
    await openArchive(page, await encryptedArchive(sensitive));
    await page.getByLabel("Brankas tujuan").click();
    await page.getByRole("option", { name: new RegExp(`Buat Brankas Bersama.*${sensitive.vaultName}`) }).click();
    await page.getByRole("button", { name: "Konfirmasi dan impor" }).click();

    const successDialog = page.getByRole("dialog", { name: "Import selesai" });
    await expect(successDialog).toBeVisible();
    await expect(successDialog.getByText("1 akun berhasil diimpor ke Brankas Bersama baru.")).toBeVisible();
    const importAnother = successDialog.getByRole("button", { name: "Impor arsip lain" });
    const openImportedVault = successDialog.getByRole("link", { name: "Buka Brankas hasil import" });
    await expect(openImportedVault).toHaveAttribute("href", /^\/vaults\/manage\/[0-9a-f-]+$/);
    expect(await openImportedVault.evaluate((link) => link.scrollWidth <= link.clientWidth && link.scrollHeight <= link.clientHeight)).toBe(true);
    expect(await importAnother.evaluate((button) => button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight)).toBe(true);
    await importAnother.click();
    await expect(successDialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Buka arsip terenkripsi" })).toBeVisible();
    expect(requestBody).toBeDefined();
    expect((requestBody?.destination as { kind: string }).kind).toBe("NEW_SHARED");
    const serialized = JSON.stringify(requestBody);
    for (const value of [sensitive.vaultName, sensitive.issuer, sensitive.accountName, Buffer.from(sensitive.secret).toString("base64"), archiveKeyBase64]) expect(serialized).not.toContain(value);
    expect(consoleMessages.join("\n")).not.toContain(sensitive.vaultName);
    expect(consoleMessages.join("\n")).not.toContain(sensitive.accountName);
    await expectNoSensitivePersistence(page, [sensitive.vaultName, sensitive.issuer, sensitive.accountName, archiveKeyBase64]);
  });

  test("requires explicit add-anyway confirmation for duplicate accounts", async ({ page }) => {
    const duplicate = { vaultName: "Duplicate Archive", issuer: "Example", accountName: "alice@example.test", secret: Uint8Array.from([1, 2, 3, 4]) };
    let requests = 0;
    await page.route("**/api/vault-imports", async (route) => {
      requests += 1;
      const body = route.request().postDataJSON() as { destination: { vaultId: string }; accounts: Array<{ id: string }> };
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ vaultId: body.destination.vaultId, accountIds: body.accounts.map(({ id }) => id), vaultCreated: false, replayed: false }) });
    });
    await page.goto("/ui-preview/archive-import");
    await openArchive(page, await encryptedArchive(duplicate));
    await expect(page.getByText("1 akun duplikat terdeteksi")).toBeVisible();
    await page.getByRole("button", { name: "Konfirmasi dan impor" }).click();
    expect(requests).toBe(0);
    await expect(page.getByText("Tambahkan akun duplikat?")).toBeVisible();
    await page.getByRole("button", { name: "Tetap tambahkan" }).click();
    await expect(page.getByText("1 akun berhasil diimpor.")).toBeVisible();
    expect(requests).toBe(1);
  });

  test("reports when encrypted import data is waiting for the server", async ({ page }) => {
    let releaseResponse: (() => void) | undefined;
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
    await page.route("**/api/vault-imports", async (route) => {
      const body = route.request().postDataJSON() as { destination: { vaultId: string }; accounts: Array<{ id: string }> };
      await responseGate;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ vaultId: body.destination.vaultId, accountIds: body.accounts.map(({ id }) => id), vaultCreated: false, replayed: false }) });
    });
    await page.goto("/ui-preview/archive-import");
    await openArchive(page, await encryptedArchive(sensitive));
    await page.getByRole("button", { name: "Konfirmasi dan impor" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Menunggu respons server" })).toBeVisible();
    releaseResponse?.();
    await expect(page.getByText("1 akun berhasil diimpor.")).toBeVisible();
  });

  test("keeps the preview and exposes an atomic server failure instead of claiming partial success", async ({ page }) => {
    await page.route("**/api/vault-imports", async (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "archive_import_failed" }) }));
    await page.goto("/ui-preview/archive-import");
    await openArchive(page, await encryptedArchive(sensitive));
    await page.getByRole("button", { name: "Konfirmasi dan impor" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Import tidak selesai" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pratinjau arsip" })).toBeVisible();
    await expect(page.getByText("berhasil diimpor", { exact: false })).toHaveCount(0);
  });

  test("rejects wrong keys and corrupt archives without requests", async ({ page }) => {
    let requests = 0;
    await page.route("**/api/vault-imports", async (route) => { requests += 1; await route.abort(); });
    await page.goto("/ui-preview/archive-import");
    const archive = await encryptedArchive(sensitive);
    await setArchive(page, archive, Buffer.from(Uint8Array.from({ length: 32 }, () => 3)).toString("base64"));
    await expect(page.getByRole("alert").filter({ hasText: "Arsip terenkripsi tidak dapat dibuka." })).toBeVisible();

    const corrupt = archive.slice();
    corrupt[corrupt.length - 1] ^= 1;
    await setArchive(page, corrupt, archiveKeyBase64);
    await expect(page.getByRole("alert").filter({ hasText: "Arsip terenkripsi tidak dapat dibuka." })).toBeVisible();
    expect(requests).toBe(0);
  });

  test("blocks and never queues import while offline", async ({ page, context }) => {
    let requests = 0;
    await page.route("**/api/vault-imports", async (route) => { requests += 1; await route.abort(); });
    await page.goto("/ui-preview/archive-import");
    await openArchive(page, await encryptedArchive(sensitive));
    await context.setOffline(true);
    await expect(page.getByText("Anda luring. Import diblokir dan tidak akan diantrikan.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Konfirmasi dan impor" })).toBeDisabled();
    expect(requests).toBe(0);
    await context.setOffline(false);
  });
});

async function openArchive(page: Page, archive: Uint8Array) {
  await setArchive(page, archive, archiveKeyBase64);
  await expect(page.getByRole("heading", { name: "Pratinjau arsip" })).toBeVisible();
}

async function setArchive(page: Page, archive: Uint8Array, key: string) {
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Berkas arsip").setInputFiles({ name: "backup.rhasia-vault", mimeType: "application/octet-stream", buffer: Buffer.from(archive) });
  await page.getByLabel("Kunci arsip Base64").fill(key);
  await page.getByRole("button", { name: "Pratinjau arsip" }).click();
}

async function encryptedArchive(account: typeof sensitive): Promise<Uint8Array> {
  const normalized = new TextEncoder().encode(JSON.stringify({ issuer: account.issuer, accountName: account.accountName, secret: Buffer.from(account.secret).toString("base64"), algorithm: "SHA-1", digits: 6, period: 30 }));
  try {
    return await createEncryptedVaultArchive(archiveKey, account.vaultName, [normalized]);
  } finally {
    normalized.fill(0);
  }
}

async function expectNoSensitivePersistence(page: Page, values: string[]) {
  const persisted = await page.evaluate(async () => {
    const local = Object.entries(localStorage);
    const session = Object.entries(sessionStorage);
    const databases = await indexedDB.databases();
    const indexed: unknown[] = [];
    for (const { name } of databases) {
      if (!name) continue;
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        for (const storeName of database.objectStoreNames) {
          indexed.push(...await new Promise<unknown[]>((resolve, reject) => {
            const request = database.transaction(storeName).objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result as unknown[]);
            request.onerror = () => reject(request.error);
          }));
        }
      } finally {
        database.close();
      }
    }
    return JSON.stringify({ local, session, indexed });
  });
  for (const value of values) expect(persisted).not.toContain(value);
}
