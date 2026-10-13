import { expect, test, type Page } from "@playwright/test";
import { createEncryptedVaultArchive } from "@/modules/crypto/infrastructure/browser-vault-export";

const localVaultName = "Synthetic Destination Vault";
const archiveVaultName = "Synthetic Archive Source";
const account = {
  issuer: "Example Issuer",
  accountName: "test@example.invalid",
};

const copy = {
  id: {
    create: "Buat Brankas Lokal",
    backupTab: "Cadangan",
    archiveFile: "Berkas arsip terenkripsi",
    keyFile: "Berkas kunci arsip",
    reviewButton: "Tinjau arsip",
    reviewTitle: "Tinjau pemulihan arsip",
    count: "1 akun dalam arsip",
    noDuplicates: "Tidak ada akun duplikat.",
    cancel: "Batalkan tinjauan",
    confirm: "Konfirmasi dan pulihkan",
    imported: "1 akun dipulihkan secara lokal.",
  },
  en: {
    create: "Create Local Vault",
    backupTab: "Backup",
    archiveFile: "Encrypted archive file",
    keyFile: "Archive key file",
    reviewButton: "Review archive",
    reviewTitle: "Review archive restore",
    count: "1 account in this archive",
    noDuplicates: "No duplicate accounts were found.",
    cancel: "Cancel review",
    confirm: "Confirm and restore",
    imported: "1 account restored locally.",
  },
} as const;

test("reviews Local Vault archive contents before restore in both locales and responsive layouts", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("The browser test base URL is unavailable.");
  const fixture = await encryptedArchive();

  try {
    for (const locale of ["id", "en"] as const) {
      const context = await browser.newContext({ baseURL });
      try {
        await context.addCookies([{ name: "RHSIA_LOCALE", value: locale, url: baseURL }]);
        const page = await context.newPage();
        const labels = copy[locale];
        const requestData: string[] = [];
        const consoleMessages: string[] = [];
        page.on("request", (request) => requestData.push(`${request.url()} ${request.postData() ?? ""}`));
        page.on("console", (message) => consoleMessages.push(message.text()));

        await page.setViewportSize({ width: 320, height: 740 });
        await page.goto("/local");
        await page.locator("#local-vault-name").fill(localVaultName);
        await page.locator("#local-vault-passphrase").fill("synthetic-local-passphrase");
        await page.locator("#local-vault-passphrase-confirm").fill("synthetic-local-passphrase");
        await page.getByRole("button", { name: labels.create }).click();
        await expect(page.getByRole("tab", { name: localVaultName })).toBeVisible({ timeout: 30_000 });
        await page.getByRole("tab", { name: labels.backupTab }).click();
        await page.getByLabel(labels.archiveFile).setInputFiles({
          name: "sample.rhasia-vault",
          mimeType: "application/octet-stream",
          buffer: Buffer.from(fixture.archive),
        });
        await page.getByLabel(labels.keyFile).setInputFiles({
          name: "sample-key.txt",
          mimeType: "text/plain",
          buffer: Buffer.from(fixture.key),
        });
        await page.getByRole("button", { name: labels.reviewButton }).click();

        const review = page.getByRole("region", { name: labels.reviewTitle });
        await expect(review).toBeVisible();
        await expect(review.getByText(archiveVaultName, { exact: true })).toBeVisible();
        await expect(review.getByText(localVaultName, { exact: true })).toBeVisible();
        await expect(review.getByText(labels.count, { exact: true })).toBeVisible();
        const accountSummary = review.getByRole("listitem");
        await expect(accountSummary).toContainText(account.issuer);
        await expect(accountSummary).toContainText(account.accountName);
        await expect(review.getByText(labels.noDuplicates, { exact: true })).toBeVisible();
        expect(await localVaultAccountCount(page)).toBe(0);

        for (const width of [320, 820, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
          for (const label of [labels.cancel, labels.confirm]) {
            const action = review.getByRole("button", { name: label });
            await expect(action).toBeVisible();
            expect((await action.boundingBox())?.height).toBe(48);
          }
        }

        await review.getByRole("button", { name: labels.cancel }).click();
        await expect(review).toHaveCount(0);
        expect(await localVaultAccountCount(page)).toBe(0);
        await page.getByRole("button", { name: labels.reviewButton }).click();
        await expect(review).toBeVisible();
        await review.getByRole("button", { name: labels.confirm }).click();
        await expect(page.getByRole("status").filter({ hasText: labels.imported })).toBeVisible({ timeout: 30_000 });
        expect(await localVaultAccountCount(page)).toBe(1);

        const sensitiveValues = [
          archiveVaultName,
          localVaultName,
          account.issuer,
          account.accountName,
          fixture.key,
          fixture.secretBase64,
          Buffer.from(fixture.archive).toString("base64"),
        ];
        const outbound = JSON.stringify(requestData);
        const logged = consoleMessages.join("\n");
        for (const value of sensitiveValues) {
          expect(outbound).not.toContain(value);
          expect(logged).not.toContain(value);
        }
        await expectNoSensitivePersistence(page, sensitiveValues);
      } finally {
        await context.close();
      }
    }
  } finally {
    fixture.archive.fill(0);
  }
});

async function encryptedArchive(): Promise<{ archive: Uint8Array; key: string; secretBase64: string }> {
  const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);
  const secretBytes = Uint8Array.from({ length: 20 }, (_, index) => index + 1);
  const key = Buffer.from(keyBytes).toString("base64");
  const secretBase64 = Buffer.from(secretBytes).toString("base64");
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      ...account,
      secret: secretBase64,
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
    }),
  );
  try {
    const archive = await createEncryptedVaultArchive(keyBytes, archiveVaultName, [plaintext]);
    return { archive, key, secretBase64 };
  } finally {
    keyBytes.fill(0);
    secretBytes.fill(0);
    plaintext.fill(0);
  }
}

async function localVaultAccountCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const opening = indexedDB.open("rhasia-scret-local-vault");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result;
          const request = database.transaction("local-vault", "readonly").objectStore("local-vault").get("singleton");
          request.onerror = () => {
            database.close();
            reject(request.error);
          };
          request.onsuccess = () => {
            const record = request.result as { accounts?: unknown[] } | undefined;
            database.close();
            resolve(record?.accounts?.length ?? 0);
          };
        };
      }),
  );
}

async function expectNoSensitivePersistence(page: Page, values: string[]): Promise<void> {
  const persisted = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const records: unknown[] = [];
    for (const { name } of databases) {
      if (!name) continue;
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        for (const storeName of database.objectStoreNames) {
          records.push(
            ...(await new Promise<unknown[]>((resolve, reject) => {
              const request = database.transaction(storeName).objectStore(storeName).getAll();
              request.onsuccess = () => resolve(request.result as unknown[]);
              request.onerror = () => reject(request.error);
            })),
          );
        }
      } finally {
        database.close();
      }
    }
    return JSON.stringify({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
      records,
    });
  });
  for (const value of values) expect(persisted).not.toContain(value);
}
