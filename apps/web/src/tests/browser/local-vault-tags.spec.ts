import { expect, test } from "@playwright/test";

const localVaultName = "Synthetic tag vault";
const passphrase = "synthetic-local-passphrase";
const accountName = "alice@example.test";
const tagName = "Synthetic Work";
const syntheticUri =
  "otpauth://totp/Example%3Aalice%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA1&digits=6&period=30";

const copy = {
  id: {
    create: "Buat Brankas Lokal",
    addTab: "Tambah akun",
    advancedOptions: "Opsi lanjutan",
    useManual: "Gunakan URI manual",
    saveAccount: "Simpan ke Brankas Lokal",
    manage: `Kelola ${accountName}`,
    manageTitle: "Kelola akun",
    addTag: "Tambahkan tag",
    save: "Simpan",
    update: "Simpan",
    filterByTag: "Filter berdasarkan tag",
    allTags: "Semua tag",
    applied: "Filter diterapkan",
    removeTag: `Hapus tag ${tagName}`,
    searchLabel: "Cari penerbit atau nama akun",
    clearSearch: "Hapus pencarian",
    noResults: "Akun tidak ditemukan",
    settings: "Pengaturan",
    lockVault: "Kunci Brankas Lokal",
    unlockVault: "Buka Brankas Lokal",
  },
  en: {
    create: "Create Local Vault",
    addTab: "Add account",
    advancedOptions: "Advanced options",
    useManual: "Use manual URI",
    saveAccount: "Save to Local Vault",
    manage: `Manage ${accountName}`,
    manageTitle: "Manage account",
    addTag: "Add tag",
    save: "Save",
    update: "Save",
    filterByTag: "Filter by tag",
    allTags: "All tags",
    applied: "Filters applied",
    removeTag: `Remove tag ${tagName}`,
    searchLabel: "Search issuer or account name",
    clearSearch: "Clear search",
    noResults: "No accounts found",
    settings: "Settings",
    lockVault: "Lock Local Vault",
    unlockVault: "Unlock Local Vault",
  },
} as const;

test("adds, filters, removes, and keeps Local Vault tags encrypted in both locales", async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error("The browser test base URL is unavailable.");

  for (const locale of ["id", "en"] as const) {
    const context = await browser.newContext({ baseURL });
    try {
      await context.addCookies([{ name: "RHSIA_LOCALE", value: locale, url: baseURL }]);
      const page = await context.newPage();
      const labels = copy[locale];
      const requestBodies: string[] = [];
      const requestUrls: string[] = [];
      const consoleMessages: string[] = [];
      page.on("request", (request) => {
        requestUrls.push(request.url());
        const body = request.postData();
        if (body) requestBodies.push(body);
      });
      page.on("console", (message) => consoleMessages.push(message.text()));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/local");
      await page.locator("#local-vault-name").fill(localVaultName);
      await page.locator("#local-vault-passphrase").fill(passphrase);
      await page.locator("#local-vault-passphrase-confirm").fill(passphrase);
      await page.getByRole("button", { name: labels.create }).click();
      await expect(page.getByRole("tab", { name: localVaultName })).toBeVisible({ timeout: 30_000 });

      const search = page.getByRole("searchbox", { name: labels.searchLabel });
      await search.fill("missing-synthetic-account");
      await expect(page.locator('[data-slot="account-search-empty-state"]')).toContainText(labels.noResults);
      await page
        .locator('[data-slot="account-search-empty-state"]')
        .getByRole("button", { name: labels.clearSearch })
        .click();
      await expect(search).toHaveValue("");

      await page.getByRole("tab", { name: labels.addTab }).click();
      await page.getByRole("button", { name: labels.advancedOptions }).click();
      await page.locator("#manual-authenticator-uri").fill(syntheticUri);
      await page.getByRole("button", { name: labels.useManual }).click();
      await expect(page.locator("#local-account-label")).toHaveValue(accountName);
      await page.getByRole("button", { name: labels.saveAccount }).click();

      const accountActions = page.getByRole("button", { name: labels.manage });
      await expect(accountActions).toBeVisible({ timeout: 15_000 });
      await accountActions.click();
      await page.getByRole("menuitem", { name: labels.manageTitle }).click();
      await page.locator("#edit-local-account-tag").fill(tagName);
      await page.getByRole("button", { name: labels.addTag, exact: true }).click();
      const removeTag = page.getByRole("button", { name: labels.removeTag, exact: true });
      await expect(removeTag).toBeVisible();
      const removeTagBox = await removeTag.boundingBox();
      expect(removeTagBox?.width).toBeGreaterThanOrEqual(44);
      expect(removeTagBox?.height).toBeGreaterThanOrEqual(44);
      await page.getByRole("button", { name: labels.update, exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("article").getByText(tagName, { exact: true })).toBeVisible();

      const tagFilter = page.locator('[data-slot="account-tags-filter"]');
      await expect(tagFilter).toBeVisible();
      await tagFilter.click();
      const tagOptions = page.locator('[data-slot="dropdown-menu-content"]');
      await tagOptions.getByRole("menuitemcheckbox", { name: tagName, exact: true }).click();
      await expect(tagFilter).toHaveAttribute("data-active", "true");
      await expect(tagFilter).toHaveAttribute("aria-description", labels.applied);
      await expect(page.getByRole("article").getByText(tagName, { exact: true })).toBeVisible();
      await expect(search).toBeVisible();
      const searchRequestCount = requestUrls.length;
      await search.fill("Example");
      await expect(page.getByRole("article").getByText(accountName, { exact: true })).toBeVisible();
      await search.fill(accountName);
      await expect(page.getByRole("article").getByText(accountName, { exact: true })).toBeVisible();
      await search.fill("no-such-synthetic-account");
      await expect(page.locator('[data-slot="account-search-empty-state"]')).toContainText(labels.noResults);
      const persisted = await persistedLocalData(page);
      for (const value of [tagName, accountName, "Example", "JBSWY3DPEHPK3PXP", "no-such-synthetic-account"])
        expect(persisted).not.toContain(value);
      await page
        .locator('[data-slot="account-search-empty-state"]')
        .getByRole("button", { name: labels.clearSearch })
        .click();
      await expect(search).toHaveValue("");
      await expect(tagFilter).toHaveAttribute("data-active", "true");
      await expect(page.getByRole("article").getByText(accountName, { exact: true })).toBeVisible();
      expect(requestUrls).toHaveLength(searchRequestCount);
      expect(requestBodies.join("\n")).not.toContain("no-such-synthetic-account");
      expect(requestBodies.join("\n")).not.toContain(accountName);
      expect(requestUrls.join("\n")).not.toContain("no-such-synthetic-account");
      expect(consoleMessages.join("\n")).not.toContain("no-such-synthetic-account");
      await search.fill("Example");
      await expect(page.getByRole("article").getByText(accountName, { exact: true })).toBeVisible();
      await page.getByRole("tab", { name: labels.settings }).click();
      await page.getByRole("button", { name: labels.lockVault, exact: true }).click();
      await expect(page.locator("#local-vault-unlock")).toBeVisible();
      await page.locator("#local-vault-unlock").fill(passphrase);
      await page.getByRole("button", { name: labels.unlockVault, exact: true }).click();
      await expect(page.getByRole("searchbox", { name: labels.searchLabel })).toHaveValue("");
      await expect(tagFilter).toHaveAttribute("data-active", "false");
      expect(requestBodies.join("\n")).not.toContain(tagName);

      await page.getByRole("button", { name: labels.manage }).click();
      await page.getByRole("menuitem", { name: labels.manageTitle }).click();
      await page.getByRole("button", { name: labels.removeTag, exact: true }).click();
      await page.getByRole("button", { name: labels.update, exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("article").getByText(tagName, { exact: true })).toHaveCount(0);
      await expect(page.locator('[data-slot="account-tags-filter"]')).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});

async function persistedLocalData(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(async () => {
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
}
