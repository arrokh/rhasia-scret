import { devices, expect, test } from "@playwright/test";

const browserTestPort = process.env.BROWSER_TEST_PORT ?? "3100";

test("clears empty account filters by touch and keyboard in both locales", async ({ browser }) => {
  const context = await browser.newContext({
    ...devices["iPhone 12"],
    baseURL: `http://127.0.0.1:${browserTestPort}`,
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 320, height: 700 });

  try {
    for (const locale of ["id", "en"] as const) {
      await context.addCookies([{ name: "RHSIA_LOCALE", value: locale, url: `http://127.0.0.1:${browserTestPort}` }]);
      await page.goto("/ui-preview");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);

      const filterLabel = locale === "id" ? "Filter akun" : "Filter accounts";
      const personalVault = locale === "id" ? "Brankas Pribadi" : "Personal Vault";
      const workIssuer = locale === "id" ? "Akun kerja" : "Work account";
      const emptyLabel =
        locale === "id" ? "Tidak ada akun yang cocok dengan filter ini" : "No accounts match these filters";
      const clearLabel = locale === "id" ? "Hapus semua filter" : "Clear all filters";
      const allVaultsLabel = locale === "id" ? "Semua brankas" : "All vaults";
      const allIssuersLabel = locale === "id" ? "Semua penerbit" : "All issuers";
      const allTagsLabel = locale === "id" ? "Semua tag" : "All tags";
      const accountList = page.locator('[data-slot="account-directory-list"] [data-account-key]');
      const filterButton = page.getByRole("button", { name: filterLabel });

      await filterButton.tap();
      const filterOptions = page.locator('[data-slot="dropdown-menu-content"]');
      await filterOptions.getByRole("menuitemcheckbox", { name: personalVault }).tap();
      await filterOptions.getByRole("menuitemcheckbox", { name: workIssuer }).tap();
      await filterOptions.getByRole("menuitemcheckbox", { name: "Work", exact: true }).tap();
      await expect(accountList).toHaveCount(0);
      await expect(page.getByText(emptyLabel, { exact: true })).toBeVisible();

      const clearFromMenu = filterOptions.getByRole("button", { name: clearLabel });
      if (locale === "id") {
        await clearFromMenu.tap();
      } else {
        await clearFromMenu.focus();
        await expect(clearFromMenu).toBeFocused();
        await clearFromMenu.press("Enter");
      }
      await expect(filterOptions).toBeVisible();
      await expect(filterOptions.getByRole("menuitemcheckbox", { name: allVaultsLabel })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(filterOptions.getByRole("menuitemcheckbox", { name: allIssuersLabel })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(filterOptions.getByRole("menuitemcheckbox", { name: allTagsLabel })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(accountList).toHaveCount(2);

      await filterOptions.getByRole("menuitemcheckbox", { name: personalVault }).tap();
      await filterOptions.getByRole("menuitemcheckbox", { name: workIssuer }).tap();
      await filterOptions.getByRole("menuitemcheckbox", { name: "Work", exact: true }).tap();
      await expect(accountList).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: clearLabel }).filter({ hasText: clearLabel }).tap();
      await expect(accountList).toHaveCount(2);
      await expect(filterButton).toHaveAttribute("data-active", "false");
    }
  } finally {
    await context.close();
  }
});

test("reorders authenticator accounts from a touch gesture", async ({ browser }) => {
  const context = await browser.newContext({
    ...devices["iPhone 12"],
    baseURL: `http://127.0.0.1:${browserTestPort}`,
  });
  const page = await context.newPage();

  try {
    await page.goto("/ui-preview");
    await page.getByRole("button", { name: "Opsi tampilan" }).click();
    await page.getByRole("menuitem", { name: "Urutkan akun" }).click();

    const dialog = page.getByRole("dialog");
    const source = dialog.getByRole("button", {
      name: "Seret untuk mengurutkan ulang example@local.invalid",
    });
    const target = dialog.locator('[data-account-key="preview-operations:preview-account-operations"]');
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    const client = await context.newCDPSession(page);
    const sourcePoint = {
      x: (sourceBox?.x ?? 0) + (sourceBox?.width ?? 0) / 2,
      y: (sourceBox?.y ?? 0) + (sourceBox?.height ?? 0) / 2,
    };
    const targetPoint = {
      x: (targetBox?.x ?? 0) + (targetBox?.width ?? 0) / 2,
      y: (targetBox?.y ?? 0) + (targetBox?.height ?? 0) / 2,
    };
    const touchPoint = (point: typeof sourcePoint) => ({ ...point, id: 1, radiusX: 4, radiusY: 4, force: 1 });

    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [touchPoint(sourcePoint)],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [touchPoint(targetPoint)],
    });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    await expect(page.locator('[data-slot="account-directory-list"] [data-account-key]').first()).toHaveAttribute(
      "data-account-key",
      "preview-operations:preview-account-operations",
    );
  } finally {
    await context.close();
  }
});

test("searches account names without persisting, sending, or logging search values in both locales", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("The browser test base URL is unavailable.");
  const queryAccountName = "work@local.invalid";
  const noMatch = "synthetic-no-match-query";
  const previewUrl = new URL("/ui-preview", baseURL).href;

  for (const locale of ["id", "en"] as const) {
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
    try {
      await context.addCookies([{ name: "RHSIA_LOCALE", value: locale, url: baseURL }]);
      const page = await context.newPage();
      const requestDetails: string[] = [];
      const consoleMessages: string[] = [];
      page.on("request", (request) => requestDetails.push(`${request.url()}\n${request.postData() ?? ""}`));
      page.on("console", (message) => consoleMessages.push(message.text()));
      const issuerQuery = locale === "id" ? "Layanan contoh" : "Sample service";
      const searchLabel = locale === "id" ? "Cari penerbit atau nama akun" : "Search issuer or account name";
      const showSearchLabel = locale === "id" ? "Tampilkan pencarian akun" : "Show account search";
      const hideSearchLabel = locale === "id" ? "Sembunyikan pencarian akun" : "Hide account search";
      const clearSearchLabel = locale === "id" ? "Hapus pencarian" : "Clear search";
      const noResultsLabel = locale === "id" ? "Akun tidak ditemukan" : "No accounts found";

      await page.goto("/ui-preview");
      const searchToggle = page.locator('[data-slot="account-directory-search-toggle"]');
      const search = page.getByRole("searchbox", { name: searchLabel });
      const accountList = page.locator('[data-slot="account-directory-list"]');
      await expect(search).toHaveCount(0);
      await expect(searchToggle).toHaveAccessibleName(showSearchLabel);
      await searchToggle.click();
      await expect(searchToggle).toHaveAccessibleName(hideSearchLabel);
      await expect(search).toBeVisible();
      await expect(searchToggle).toHaveAttribute("aria-expanded", "true");
      await expect(search).toBeFocused();
      await search.fill(issuerQuery);
      await expect(accountList.locator("[data-account-key]")).toHaveCount(1);
      await expect(page).toHaveURL(previewUrl);
      await search.fill(queryAccountName);
      await expect(accountList).toContainText(queryAccountName);
      await expect(page).toHaveURL(previewUrl);
      await search.fill(noMatch);
      await expect(page.locator('[data-slot="account-search-empty-state"]')).toContainText(noResultsLabel);
      await expect(page).toHaveURL(previewUrl);
      await searchToggle.click();
      await expect(search).toHaveCount(0);
      await expect(searchToggle).toHaveAttribute("aria-expanded", "false");
      await expect(searchToggle).toHaveAccessibleName(showSearchLabel);
      await searchToggle.click();
      await expect(searchToggle).toHaveAccessibleName(hideSearchLabel);
      await expect(search).toHaveValue(noMatch);
      await expect(search).toBeFocused();
      await page
        .locator('[data-slot="account-search-empty-state"]')
        .getByRole("button", { name: clearSearchLabel })
        .click();
      await expect(search).toHaveValue("");
      await expect(accountList.locator("[data-account-key]")).toHaveCount(2);
      await expect(page).toHaveURL(previewUrl);

      const browserStorage = await page.evaluate(() =>
        JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }),
      );
      for (const value of [issuerQuery, queryAccountName, noMatch, "example@local.invalid"])
        expect(browserStorage).not.toContain(value);
      await page.reload();
      await expect(page).toHaveURL(previewUrl);
      await expect(search).toHaveCount(0);
      await expect(searchToggle).toHaveAccessibleName(showSearchLabel);
      await searchToggle.click();
      await expect(searchToggle).toHaveAccessibleName(hideSearchLabel);
      await expect(search).toHaveValue("");
      await expect(page.locator('[data-slot="account-directory-list"] [data-account-key]')).toHaveCount(2);
      await expect(searchToggle).toHaveAttribute("aria-expanded", "true");
      const externalOutput = `${requestDetails.join("\n")}\n${consoleMessages.join("\n")}`;
      for (const value of [issuerQuery, queryAccountName, noMatch, "example@local.invalid"])
        expect(externalOutput).not.toContain(value);
    } finally {
      await context.close();
    }
  }
});

test("requires explicit confirmation for destructive Personal Vault reset", async ({ page }) => {
  let submittedBody: unknown;
  await page.route("**/api/v1/personal-vault/destructive-reset", async (route) => {
    submittedBody = route.request().postDataJSON();
    await route.fulfill({ status: 204 });
  });
  await page.goto("/ui-preview/recovery");

  await expect(page.getByRole("heading", { name: "Hapus data terenkripsi dan mulai ulang" })).toBeVisible();
  await expect(page.getByText(/Brankas Bersama milik orang lain dan data anggotanya tidak akan dihapus/)).toBeVisible();
  const confirmationDialog = page.getByRole("heading", { name: "Atur ulang Brankas Pribadi?" });
  await expect(async () => {
    await page.reload({ waitUntil: "load" });
    const confirmation = page.getByLabel(/Ketik HAPUS DATA BRANKAS/);
    const submit = page.getByRole("button", { name: "Hapus data dan atur ulang brankas" });
    await confirmation.fill("belum terhidrasi");
    await submit.click();
    await expect(confirmation).toHaveAttribute("aria-invalid", "true", { timeout: 5_000 });
    await confirmation.fill("HAPUS DATA BRANKAS");
    await expect(confirmation).toHaveValue("HAPUS DATA BRANKAS");
    await submit.click();
    await expect(confirmationDialog).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });

  await expect(confirmationDialog).toBeVisible();
  expect(submittedBody).toBeUndefined();
  await page.getByRole("button", { name: "Hapus dan atur ulang" }).click();
  await expect.poll(() => submittedBody).toEqual({ confirmation: "HAPUS DATA BRANKAS" });
});
