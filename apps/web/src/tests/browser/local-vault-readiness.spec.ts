import { expect, test } from "@playwright/test";

const localVaultName = "Synthetic readiness vault";
const passphrase = "synthetic-local-passphrase";

const copy = {
  id: {
    requestStorage: "Minta penyimpanan persisten",
    persistenceDescription:
      "Penyimpanan persisten dapat mengurangi penghapusan otomatis data situs ini. Fitur ini tidak mencegah penghapusan data situs yang disengaja dan bukan cadangan.",
    notGranted: "Penyimpanan persisten belum diberikan.",
    granted: "Browser memberikan penyimpanan persisten untuk situs ini.",
    create: "Buat Brankas Lokal",
    reminderTitle: "Lindungi Brankas Lokal",
    archiveCaveat:
      "Browser ini tidak dapat memastikan arsip maupun kuncinya masih tersedia. Keduanya diperlukan untuk pemulihan.",
    dismissReminder: "Tutup pengingat",
    openArchiveTools: "Buka alat arsip",
    backupTab: "Cadangan",
    backupTitle: "Cadangan terenkripsi",
    export: "Ekspor cadangan terenkripsi",
    restore: "Pulihkan cadangan terenkripsi",
    reviewArchive: "Tinjau arsip",
  },
  en: {
    requestStorage: "Request persistent storage",
    persistenceDescription:
      "Persistent storage may reduce automatic eviction of data for this site. It cannot prevent deliberate site-data deletion and is not a backup.",
    notGranted: "Persistent storage has not been granted yet.",
    granted: "The browser granted persistent storage for this site.",
    create: "Create Local Vault",
    reminderTitle: "Protect your Local Vault",
    archiveCaveat:
      "This browser cannot confirm that either the archive or its key still exists. Both are needed to restore.",
    dismissReminder: "Dismiss reminder",
    openArchiveTools: "Open archive tools",
    backupTab: "Backup",
    backupTitle: "Encrypted backup",
    export: "Export encrypted backup",
    restore: "Restore encrypted backup",
    reviewArchive: "Review archive",
  },
} as const;

test("requests origin storage only on action and links a dismissible Local Vault reminder in both locales", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("The browser test base URL is unavailable.");

  for (const locale of ["id", "en"] as const) {
    const context = await browser.newContext({ baseURL });
    try {
      await context.addCookies([{ name: "RHSIA_LOCALE", value: locale, url: baseURL }]);
      await context.addInitScript(() => {
        let requestCount = 0;
        Object.defineProperty(window, "__rhasiaPersistenceRequestCount", {
          configurable: true,
          get: () => requestCount,
        });
        Object.defineProperty(navigator.storage, "persisted", {
          configurable: true,
          value: async () => false,
        });
        Object.defineProperty(navigator.storage, "persist", {
          configurable: true,
          value: async () => {
            requestCount += 1;
            return true;
          },
        });
      });

      const page = await context.newPage();
      const labels = copy[locale];
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/local");

      const persistence = page.locator("[data-storage-persistence]");
      await expect(persistence).toHaveAttribute("data-storage-persistence", "not_granted");
      await expect(persistence).toContainText(labels.persistenceDescription);
      await expect(persistence).toContainText(labels.notGranted);
      expect(await persistenceRequestCount(page)).toBe(0);
      await persistence.getByRole("button", { name: labels.requestStorage }).click();
      await expect(persistence).toHaveAttribute("data-storage-persistence", "granted");
      await expect(persistence).toContainText(labels.granted);
      expect(await persistenceRequestCount(page)).toBe(1);

      await page.locator("#local-vault-name").fill(localVaultName);
      await page.locator("#local-vault-passphrase").fill(passphrase);
      await page.locator("#local-vault-passphrase-confirm").fill(passphrase);
      await page.getByRole("button", { name: labels.create }).click();
      await expect(page.getByRole("tab", { name: localVaultName })).toBeVisible({ timeout: 30_000 });

      await expect(page.getByText(labels.reminderTitle, { exact: true })).toBeVisible();
      await expect(page.getByText(labels.archiveCaveat, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: labels.openArchiveTools })).toBeVisible();
      await page.getByRole("button", { name: labels.openArchiveTools }).click();
      await expect(page.getByRole("heading", { name: labels.backupTitle, exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: labels.export })).toBeVisible();
      await expect(page.getByText(labels.restore, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: labels.reviewArchive })).toBeVisible();

      await page.getByRole("tab", { name: localVaultName }).click();
      await page.getByRole("button", { name: labels.dismissReminder }).click();
      await expect(page.getByText(labels.reminderTitle, { exact: true })).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});

async function persistenceRequestCount(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const count = Reflect.get(window, "__rhasiaPersistenceRequestCount");
    return typeof count === "number" ? count : -1;
  });
}
