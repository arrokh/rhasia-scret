import { devices, expect, test, type Locator } from "@playwright/test";

const browserTestPort = process.env.BROWSER_TEST_PORT ?? "3100";

test("renders the ciphertext-free vault layout at a mobile viewport", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ui-preview");
  await expect(page.getByRole("heading", { level: 1, name: "Akun autentikator" })).toBeVisible();
  const accountMenuTrigger = page.getByLabel("Pengaturan akun");
  await accountMenuTrigger.click();
  await expect(page.getByText("preview@local.invalid")).toBeVisible();
  const triggerBox = await accountMenuTrigger.boundingBox();
  const menuBox = await page.locator('[data-slot="dropdown-menu-content"]').boundingBox();
  expect(
    Math.abs((triggerBox?.x ?? 0) + (triggerBox?.width ?? 0) - ((menuBox?.x ?? 0) + (menuBox?.width ?? 0))),
  ).toBeLessThan(8);
  await page.keyboard.press("Escape");
  await expect(page.getByText("preview@local.invalid")).toBeHidden();
  await accountMenuTrigger.click();
  const lockAction = page.getByRole("button", { name: "Kunci" });
  const languageSettings = page.locator('[data-slot="dropdown-menu-sub-trigger"]');
  await expect(languageSettings).toBeVisible();
  await languageSettings.click();
  await expect(page.getByRole("menuitemradio", { name: "Bahasa Indonesia" })).toBeVisible();
  const languageMenu = page.locator('[data-slot="dropdown-menu-sub-content"]');
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  await expect
    .poll(
      async () => {
        const box = await languageMenu.boundingBox();
        return box ? box.x >= 0 && box.x + box.width <= viewportWidth : false;
      },
      { intervals: [50, 100, 150], timeout: 3_000 },
    )
    .toBe(true);
  const languageMenuBox = await languageMenu.boundingBox();
  const languageMenuWidth = languageMenuBox?.width;
  expect(languageMenuWidth).toBeGreaterThanOrEqual(210);
  expect(languageMenuWidth).toBeLessThanOrEqual(224);
  await expect(page.getByRole("menuitemradio", { name: "Bahasa Indonesia" })).toHaveCSS("white-space", "nowrap");
  await expect(page.getByRole("menuitemradio", { name: "English" })).toHaveCSS("white-space", "nowrap");
  expect(
    await languageMenu.evaluate((menu) =>
      [...menu.querySelectorAll('[role="menuitemradio"]')].every((item) => item.scrollWidth <= item.clientWidth),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitemradio", { name: "Bahasa Indonesia" })).toBeHidden();
  await page.keyboard.press("Escape");
  const accountMenu = page.locator('[data-slot="dropdown-menu-content"]');
  if (!(await accountMenu.isVisible().catch(() => false))) await accountMenuTrigger.click();
  await expect(accountMenu).toBeVisible();
  const accountActions = accountMenu.locator(
    "button, [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='menuitemsubmenu']",
  );
  const signOutActionInMenu = accountActions.filter({ hasText: /Keluar/ }).first();
  await expect(lockAction).toBeVisible();
  await expect(signOutActionInMenu).toBeVisible();
  const actionPositions = await accountActions.evaluateAll((items) => {
    const toTopItems = [...items]
      .map((item) => item as unknown as HTMLElement)
      .filter((item) => {
        const text = item.textContent?.trim();
        return text === "Kunci" || text === "Keluar" || text?.startsWith("Kunci") || text?.startsWith("Keluar");
      })
      .map((item) => ({ text: item.textContent?.trim(), top: item.getBoundingClientRect().top }));
    const lockY = toTopItems.find((item) => item.text === "Kunci")?.top;
    const signOutY = toTopItems.find((item) => item.text === "Keluar")?.top;
    return { lockY, signOutY };
  });
  expect(actionPositions.lockY).not.toBeUndefined();
  expect(actionPositions.signOutY).not.toBeUndefined();
  expect(actionPositions.lockY).toBeLessThan(actionPositions.signOutY ?? Number.POSITIVE_INFINITY);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Brankas" }).locator(".lucide-vault")).toBeVisible();
  await expect(page.getByRole("link", { name: "Brankas" }).locator(".lucide-lock-keyhole")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Brankas Perangkat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keamanan" })).toContainText("Keamanan");
  await expect(page.getByRole("link", { name: "Tambahkan akun autentikator" })).toBeVisible();
  const vaultAccountActions = page.locator('[data-slot="vault-account-actions"]');
  await expect(vaultAccountActions.locator('[data-slot="account-directory-menu"]')).toHaveCount(0);
  await expect(vaultAccountActions.locator('[data-slot="account-directory-filter-menu"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Opsi tampilan" })).toHaveAttribute("data-size", "icon");
  await expect(page.getByRole("button", { name: "Filter akun" })).toHaveAttribute("data-size", "icon");
  await expect
    .poll(async () =>
      vaultAccountActions
        .locator(":scope > *")
        .evaluateAll((items) =>
          items.map(
            (item) =>
              item.querySelector<HTMLElement>("[aria-label]")?.getAttribute("aria-label") ??
              item.getAttribute("aria-label"),
          ),
        ),
    )
    .toEqual(["Brankas", "Brankas Perangkat", "Keamanan", "Tambahkan akun autentikator"]);
  expect(await vaultAccountActions.evaluate((actions) => actions.scrollWidth <= actions.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByText("Brankas Pribadi")).toBeVisible();
  await expect(page.getByText("Tim Operasional")).toBeVisible();
  await expect(page.getByText(/Tidak ada materi akun, passphrase, OTP, atau kunci/)).toBeVisible();
  const directoryMenu = page.getByRole("button", { name: "Opsi tampilan" });
  const filterMenu = page.getByRole("button", { name: "Filter akun" });
  await filterMenu.click();
  const filterOptions = page.locator('[data-slot="dropdown-menu-content"]');
  await filterOptions.getByRole("menuitemcheckbox", { name: "Layanan contoh" }).click();
  await expect(page.locator('[data-slot="account-directory-list"]')).toContainText("Layanan contoh");
  await expect(page.locator('[data-slot="account-directory-list"]')).not.toContainText("Akun kerja");
  await filterOptions.getByRole("menuitemcheckbox", { name: "Semua penerbit" }).click();
  await filterOptions.getByRole("menuitemcheckbox", { name: "Tim Operasional" }).click();
  await filterOptions.getByRole("menuitemcheckbox", { name: "Brankas Pribadi" }).click();
  await expect(filterOptions.getByRole("menuitemcheckbox", { name: "Tim Operasional" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(filterOptions.getByRole("menuitemcheckbox", { name: "Brankas Pribadi" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const accountList = page.locator('[data-slot="account-directory-list"]');
  await expect(accountList.getByText("Akun kerja")).toBeVisible();
  await expect(accountList.getByText("Layanan contoh")).toBeVisible();
  await filterOptions.getByRole("menuitemcheckbox", { name: "Semua brankas" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="dropdown-menu-content"][data-state="closed"]')).toHaveCount(0);
  await directoryMenu.click();
  const directoryOptions = page.locator('[data-slot="dropdown-menu-content"]');
  await directoryOptions.getByRole("menuitemradio", { name: "Ringkas" }).click();
  await expect(page.locator('[data-slot="account-directory-list"]')).toHaveAttribute("data-view-mode", "compact");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="dropdown-menu-content"][data-state="closed"]')).toHaveCount(0);
  await directoryMenu.click();
  await directoryOptions.getByRole("menuitem", { name: "Urutkan akun" }).click();
  const reorderDialog = page.getByRole("dialog");
  await expect(reorderDialog).toBeVisible();
  await reorderDialog
    .getByRole("button", { name: "Seret untuk mengurutkan ulang example@local.invalid" })
    .dragTo(reorderDialog.locator('[data-account-key="preview-operations:preview-account-operations"]'));
  await expect(page.locator('[data-slot="account-directory-list"] [data-account-key]').first()).toHaveAttribute(
    "data-account-key",
    "preview-operations:preview-account-operations",
  );
  await reorderDialog.getByRole("button", { name: "Tutup" }).click();
  await page.locator('button[aria-label="Tindakan untuk example@local.invalid"]').click();
  await expect(page.getByRole("menuitem", { name: "Buka detail Brankas Pribadi" })).toHaveAttribute(
    "href",
    "/ui-preview/vaults",
  );
  await page.keyboard.press("Escape");
  await filterMenu.click();
  await filterOptions.getByRole("menuitemcheckbox", { name: "Tim Operasional" }).click();
  await expect(accountList.getByText("Akun kerja")).toBeVisible();
  await expect(accountList.getByText("Layanan contoh")).toBeHidden();
  await page.keyboard.press("Escape");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[data-slot="account-directory-list"]')).toHaveAttribute("data-view-mode", "compact");
  await expect(page.locator('[data-slot="account-directory-list"] [data-account-key]')).toHaveCount(1);
  await expect(page.locator('[data-slot="account-directory-list"] [data-account-key]').first()).toHaveAttribute(
    "data-account-key",
    "preview-operations:preview-account-operations",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator("footer")).toHaveText(/rhasia-scretolehnooroctavian\.id/);
  await expect(page.locator("footer").getByRole("link", { name: "rhasia-scret" })).toHaveAttribute("href", "/");
  const developerLink = page.locator("footer").getByRole("link", { name: "nooroctavian.id" });
  await expect(developerLink).toHaveAttribute("href", "https://nooroctavian.id/");
  await expect(developerLink).toHaveAttribute("target", "_blank");
  await expect(developerLink).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.locator("footer img")).toHaveCount(0);
  const footer = page.locator("footer");
  await expect(footer.getByRole("button", { name: "Pilih bahasa" })).toHaveCount(0);
  const [footerBox, footerBrandBox] = await Promise.all([footer.boundingBox(), footer.locator("p").boundingBox()]);
  expect(
    Math.abs(
      (footerBrandBox?.x ?? 0) + (footerBrandBox?.width ?? 0) / 2 - ((footerBox?.x ?? 0) + (footerBox?.width ?? 0) / 2),
    ),
  ).toBeLessThan(2);
  expect(pageErrors).toEqual([]);

  const touchTargets = page.locator("main button, main a");
  for (let index = 0; index < (await touchTargets.count()); index += 1) {
    const box = await touchTargets.nth(index).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

test("keeps the footer anchored when account directory menus open", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/ui-preview");

  const footer = page.locator("footer");
  const before = await page.evaluate(() => {
    const readBox = (selector: string) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box ? { left: box.left, right: box.right, top: box.top, width: box.width } : null;
    };
    return {
      main: readBox("main"),
      footer: readBox("footer"),
      bodyOverflow: getComputedStyle(document.body).overflow,
      bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
    };
  });
  expect(before.main).not.toBeNull();
  expect(before.footer).not.toBeNull();

  for (const label of ["Opsi tampilan", "Filter akun"]) {
    await page.getByRole("button", { name: label }).click();
    await expect(page.locator('[data-slot="dropdown-menu-content"][data-state="open"]')).toBeVisible();
    const after = await page.evaluate(() => {
      const readBox = (selector: string) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box ? { left: box.left, right: box.right, top: box.top, width: box.width } : null;
      };
      return {
        main: readBox("main"),
        footer: readBox("footer"),
        bodyOverflow: getComputedStyle(document.body).overflow,
        bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
      };
    });
    expect(after).toEqual(before);
    await page.keyboard.press("Escape");
  }

  await expect(footer).toBeVisible();
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

test("keeps Vault actions within the card at an intermediate viewport", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto("/ui-preview");
  const actions = page.locator('[data-slot="vault-account-actions"]');
  await expect(actions).toBeVisible();
  const layout = await actions.evaluate((element) => ({
    actionOverflow: element.scrollWidth > element.clientWidth,
    itemOverflow: [...element.children].some((item) => item.scrollWidth > item.clientWidth),
    documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  expect(layout.actionOverflow).toBe(false);
  expect(layout.itemOverflow).toBe(false);
  expect(layout.documentOverflow).toBe(false);
});

test("keeps preview controls within the viewport in both locales", async ({ page }) => {
  test.setTimeout(120_000);
  const routes = [
    "/ui-preview",
    "/ui-preview/vaults",
    "/ui-preview/archive-backup",
    "/ui-preview/archive-import",
    "/ui-preview/recovery",
    "/ui-preview/remembered-browser",
  ];
  const origin = `http://127.0.0.1:${browserTestPort}`;
  for (const locale of ["id", "en"] as const) {
    await page.context().addCookies([{ name: "RHSIA_LOCALE", value: locale, url: origin }]);
    for (const viewport of [
      { width: 320, height: 700 },
      { width: 820, height: 900 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        const layout = await page.evaluate(() => {
          const isVisible = (element: HTMLElement) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
          };
          const overflowingControls = [...document.querySelectorAll<HTMLElement>("button, a")]
            .filter(isVisible)
            .filter((element) => {
              const box = element.getBoundingClientRect();
              return (
                box.left < -1 ||
                box.right > window.innerWidth + 1 ||
                (!element.matches('[data-slot="checkbox"]') && element.scrollWidth > element.clientWidth + 1)
              );
            })
            .slice(0, 5)
            .map(
              (element) =>
                element.getAttribute("aria-label") ??
                `${element.tagName}.${element.className} ${element.textContent?.trim().slice(0, 80) ?? ""}`,
            );
          return {
            documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
            overflowingControls,
          };
        });
        expect(layout, `${locale} ${viewport.width}px ${route}`).toEqual({
          documentOverflow: false,
          overflowingControls: [],
        });
      }
    }
  }
});

test("closes the language confirmation after changing a setting", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ui-preview");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Pengaturan akun" }).click();
  await page.locator('[data-slot="dropdown-menu-sub-trigger"]').click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  const confirmLanguage = page.getByRole("button", { name: /Ganti bahasa|Change language/ });
  await expect(confirmLanguage).toBeVisible();
  await confirmLanguage.click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("uses dedicated, consistent Vault navigation and management tabs", async ({ page }) => {
  const pageErrors: Error[] = [];
  let invitationBody: Record<string, unknown> | undefined;
  let reinvitationBody: Record<string, unknown> | undefined;
  let defaultPermissionsBody: Record<string, unknown> | undefined;
  let memberPermissionsBody: Record<string, unknown> | undefined;
  let cancelledInvitation = false;
  let createdInvitation = false;
  let deletedVault = false;
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("**/api/v1/vaults/shared-preview/audit-events**", (route) => {
    const nextPage = new URL(route.request().url()).searchParams.has("cursor");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        events: [
          {
            id: nextPage ? "event-2" : "event-1",
            eventType: "ACCOUNT_ACCESSED",
            targetId: "opaque-account-1",
            actorUserId: "viewer-preview",
            actorEmail: "viewer@local.invalid",
            createdAt: nextPage ? "2026-07-26T13:27:00.000Z" : "2026-07-26T13:28:00.000Z",
          },
        ],
        nextCursor: nextPage ? null : "audit-page-2",
      }),
    });
  });
  await page.route("**/api/v1/shared-vaults/shared-preview/participants**", (route) => {
    const nextPage = new URL(route.request().url()).searchParams.has("cursor");
    const participants = nextPage
      ? [
          {
            key: "invitation:pending-preview",
            email: "pending@local.invalid",
            kind: "INVITATION",
            userId: null,
            invitationId: "pending-preview",
            invitationState: "PENDING",
            invitedAt: "2026-07-26T12:01:00.000Z",
            expiresAt: "2026-08-02T12:01:00.000Z",
          },
          {
            key: "invitation:expired-preview",
            email: "expired-with-a-long-address@local.invalid",
            kind: "INVITATION",
            userId: null,
            invitationId: "expired-preview",
            invitationState: "EXPIRED",
            invitedAt: "2026-07-19T12:01:00.000Z",
            expiresAt: "2026-07-26T12:01:00.000Z",
          },
          ...(createdInvitation
            ? [
                {
                  key: "invitation:invitation-preview",
                  email: "viewer@example.test",
                  kind: "INVITATION",
                  userId: null,
                  invitationId: "invitation-preview",
                  invitationState: "PENDING",
                  invitedAt: "2026-07-26T12:02:00.000Z",
                  expiresAt: "2026-08-02T12:02:00.000Z",
                },
              ]
            : []),
        ]
      : [
          {
            key: "member:viewer-preview",
            email: "viewer@local.invalid",
            kind: "MEMBER",
            userId: "viewer-preview",
            invitationId: null,
            invitedAt: "2026-07-26T12:00:00.000Z",
            permissionOverrides: { canAddAccounts: null, canEditAccounts: true, canDeleteAccounts: false },
            effectiveAccountPermissions: {
              permissions: { canAddAccounts: false, canEditAccounts: true, canDeleteAccounts: false },
              sources: { canAddAccounts: "VAULT", canEditAccounts: "MEMBER", canDeleteAccounts: "MEMBER" },
            },
            permissionsRevision: 2,
          },
        ];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        owner: { id: "owner-preview", email: "owner@local.invalid" },
        vaultDefaultAccountPermissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false },
        vaultDefaultAccountPermissionsRevision: 1,
        participants,
        nextCursor: nextPage ? null : "participants-page-2",
      }),
    });
  });
  await page.route("**/api/v1/shared-vaults/shared-preview/member-permissions", async (route) => {
    const isUpdate = route.request().method() === "PATCH";
    if (isUpdate) defaultPermissionsBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        vaultDefaultAccountPermissions: { canAddAccounts: isUpdate, canEditAccounts: false, canDeleteAccounts: false },
        vaultDefaultAccountPermissionsRevision: isUpdate ? 2 : 1,
      }),
    });
  });
  await page.route("**/api/v1/shared-vaults/shared-preview/members/viewer-preview", async (route) => {
    memberPermissionsBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        permissionOverrides: { canAddAccounts: null, canEditAccounts: true, canDeleteAccounts: true },
        effectiveAccountPermissions: {
          permissions: { canAddAccounts: false, canEditAccounts: true, canDeleteAccounts: true },
          sources: { canAddAccounts: "VAULT", canEditAccounts: "MEMBER", canDeleteAccounts: "MEMBER" },
        },
        permissionsRevision: 3,
      }),
    });
  });
  await page.route("**/api/v1/shared-vaults/shared-preview/share-links", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const reinviting = body.recipientEmail === "expired-with-a-long-address@local.invalid";
    if (reinviting) reinvitationBody = body;
    else {
      invitationBody = body;
      createdInvitation = true;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: reinviting ? "replacement-preview" : "invitation-preview",
        expiresAt: "2026-08-05T12:00:00.000Z",
      }),
    });
  });
  await page.route("**/api/v1/shared-vaults/shared-preview/share-links/pending-preview", async (route) => {
    cancelledInvitation = true;
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/v1/shared-vaults/shared-preview/lifecycle", async (route) => {
    deletedVault = route.request().method() === "DELETE";
    await route.fulfill({ status: 204 });
  });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/ui-preview/vaults");

  await expect(page.getByRole("heading", { level: 1, name: "Brankas" })).toBeVisible();
  await expect(page.getByLabel("Kembali ke pratinjau akun")).toBeVisible();
  const backupAction = page.getByRole("link", { name: "Buat cadangan" });
  const importAction = page.getByRole("link", { name: "Import arsip" });
  const createSharedAction = page.getByRole("link", { name: /Brankas Bersama/ });
  await expect(backupAction).toHaveText("");
  await expect(backupAction.locator(".lucide-database-backup")).toBeVisible();
  await expect(importAction).toHaveText("");
  await expect(importAction.locator(".lucide-import")).toBeVisible();
  expect(
    await backupAction.evaluate(
      (action, shared) => action.parentElement === (shared as Node).parentElement,
      await createSharedAction.elementHandle(),
    ),
  ).toBe(true);
  expect(
    await importAction.evaluate(
      (action, shared) => action.parentElement === (shared as Node).parentElement,
      await createSharedAction.elementHandle(),
    ),
  ).toBe(true);
  await expect(createSharedAction).toHaveAttribute("data-size", "default");
  const vaultLinks = page.locator('[aria-label="Daftar brankas"] li > a');
  await expect(vaultLinks.nth(0)).toContainText("Brankas Pribadi");
  await expect(vaultLinks.nth(0)).toHaveAttribute("href", "/vaults/manage/personal");
  await expect(vaultLinks.nth(1)).toContainText("Tim Operasional");
  await expect(page.getByText("owner@local.invalid")).toBeVisible();
  const defaultPermissions = page.locator('[data-slot="collapsible"]').filter({ hasText: "Izin akun bawaan anggota" });
  await expect(defaultPermissions).toHaveAttribute("data-state", "closed");
  await defaultPermissions.locator('[data-slot="collapsible-trigger"]').click();
  await expect(defaultPermissions).toHaveAttribute("data-state", "open");
  const addAccountsCheckbox = page.locator("#vault-default-canAddAccounts");
  await waitForStableBoundingBox(addAccountsCheckbox);
  await addAccountsCheckbox.click();
  await page.getByRole("button", { name: "Simpan bawaan anggota" }).click();
  await expect
    .poll(() => defaultPermissionsBody)
    .toEqual({ expectedRevision: 1, canAddAccounts: true, canEditAccounts: false, canDeleteAccounts: false });
  await page.getByLabel("Lihat audit Layanan contoh viewer@local.invalid").click();
  await expect(page.getByText("Filter: Layanan contoh · viewer@local.invalid")).toBeVisible();
  await expect(page.getByText("Akun autentikator disalin")).toBeVisible();
  const firstAuditEvent = page.locator("li").filter({ hasText: "Akun autentikator disalin" }).first();
  await expect(firstAuditEvent.getByText("viewer@local.invalid", { exact: true })).toBeVisible();
  await expect(firstAuditEvent.getByText("26 Jul 2026, 20.28", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Muat lebih banyak aktivitas" }).click();
  await expect(page.getByText("Semua aktivitas telah dimuat.")).toBeVisible();
  const secondAuditEvent = page.locator("li").filter({ hasText: "26 Jul 2026, 20.27" });
  await expect(secondAuditEvent.getByText("viewer@local.invalid", { exact: true })).toBeVisible();
  await expect(secondAuditEvent.getByText("26 Jul 2026, 20.27", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Undangan" }).click();
  await expect(page.getByText("viewer@local.invalid")).toBeVisible();
  await page.getByLabel("Atur izin akun untuk viewer@local.invalid").click();
  await expect(page.getByRole("heading", { name: "Izin akun anggota" })).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(3);
  await page.getByLabel("Hapus akun").click();
  await page.getByRole("option", { name: "Izinkan" }).click();
  await page.getByRole("button", { name: "Simpan izin anggota" }).click();
  await expect
    .poll(() => memberPermissionsBody)
    .toEqual({ expectedRevision: 2, canAddAccounts: null, canEditAccounts: true, canDeleteAccounts: true });
  await expect(page.getByText("pending@local.invalid")).toHaveCount(0);
  await page.getByRole("button", { name: "Muat lebih banyak pengguna" }).click();
  await expect(page.getByText("pending@local.invalid")).toBeVisible();
  await expect(page.getByText("expired-with-a-long-address@local.invalid")).toBeVisible();
  await expect(page.getByText("Kedaluwarsa", { exact: true })).toBeVisible();
  await expect(page.getByText("Semua pengguna telah dimuat.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const participantActions = page.locator('[aria-labelledby="invited-users-title"] li button');
  for (let index = 0; index < (await participantActions.count()); index += 1) {
    const box = await participantActions.nth(index).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("button", { name: "Undang kembali" }).click();
  await expect
    .poll(() => reinvitationBody)
    .toEqual({
      recipientEmail: "expired-with-a-long-address@local.invalid",
      linkVerifier: expect.any(String),
      encryptedPackage: expect.any(String),
    });
  await expect(page.getByLabel("Tautan undangan aman")).toBeVisible();
  await page.getByLabel("Tautan undangan tidak tersedia untuk pending@local.invalid").click();
  await expect(page.getByText(/Tautan aman asli hanya tersedia saat undangan dibuat/)).toBeVisible();
  await page.getByLabel("Email penerima").fill("viewer@example.test");
  await page.getByRole("button", { name: "Buat undangan" }).click();
  const secureLink = page.getByLabel("Tautan undangan aman").last();
  await expect(secureLink).toHaveText(
    new RegExp(`^http://127\\.0\\.0\\.1:${browserTestPort}/vaults/invitations/redeem#[A-Za-z0-9_-]+$`),
  );
  await expect
    .poll(() => invitationBody)
    .toEqual({
      recipientEmail: "viewer@example.test",
      linkVerifier: expect.any(String),
      encryptedPackage: expect.any(String),
    });
  expect(JSON.stringify(invitationBody)).not.toContain((await secureLink.textContent())?.split("#")[1]);
  await expect(page.getByLabel("Salin undangan untuk viewer@example.test")).toBeVisible();
  await page.getByLabel("Lihat audit viewer@local.invalid").click();
  await expect(page.getByText("Filter: viewer@local.invalid")).toBeVisible();
  await page.getByRole("tab", { name: "Undangan" }).click();
  await page.getByLabel("Hapus pending@local.invalid").click();
  await page.getByRole("button", { name: "Hapus undangan" }).click();
  await expect.poll(() => cancelledInvitation).toBe(true);
  await page.getByRole("tab", { name: "Audit" }).click();
  await expect(page.getByText("viewer@local.invalid", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Detail" }).click();
  const deleteVaultSection = page.locator('[data-slot="collapsible"]').filter({ hasText: "Hapus Brankas Bersama ini" });
  await expect(deleteVaultSection).toHaveAttribute("data-state", "closed");
  const deleteVaultTrigger = deleteVaultSection.getByRole("button", { name: "Hapus Brankas Bersama ini" });
  await expect(deleteVaultTrigger).toBeVisible();
  await waitForStableBoundingBox(deleteVaultTrigger);
  await deleteVaultTrigger.click({ force: true });
  await expect(deleteVaultSection).toHaveAttribute("data-state", "open");
  const deleteVaultButton = deleteVaultSection.getByRole("button", { name: "Hapus Brankas Bersama", exact: true });
  await expect(deleteVaultButton).toBeVisible();
  await waitForStableBoundingBox(deleteVaultButton);
  await deleteVaultButton.click({ force: true });
  await expect(page.getByRole("heading", { name: "Hapus Brankas Bersama?" })).toBeVisible({ timeout: 15_000 });
  const confirmDeleteButton = page.getByRole("button", { name: "Hapus brankas" });
  await expect(confirmDeleteButton).toBeVisible();
  await waitForStableBoundingBox(confirmDeleteButton);
  await confirmDeleteButton.click({ force: true });
  await expect.poll(() => deletedVault).toBe(true);
  await expect(page.locator("footer")).toHaveText(/rhasia-scretolehnooroctavian\.id/);
  await expect(page.locator("footer").getByRole("link", { name: "rhasia-scret" })).toHaveAttribute("href", "/");
  const footerDeveloperLink = page.locator("footer").getByRole("link", { name: "nooroctavian.id" });
  await expect(footerDeveloperLink).toHaveAttribute("href", "https://nooroctavian.id/");
  await expect(footerDeveloperLink).toHaveAttribute("target", "_blank");
  await expect(footerDeveloperLink).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.locator("footer img")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

async function waitForStableBoundingBox(locator: Locator): Promise<void> {
  let previous: string | undefined;
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        if (!box) {
          previous = undefined;
          return false;
        }
        const current = [box.x, box.y, box.width, box.height].map((value) => value.toFixed(2)).join(":");
        const stable = current === previous;
        previous = current;
        return stable;
      },
      { intervals: [50, 100, 150], timeout: 3_000 },
    )
    .toBe(true);
}

test("aligns the shared header action and sticky footer on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/ui-preview/vaults");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main > header")).toHaveCSS("display", "flex");
  const headerLead = page.locator("main > header > div").first();
  const settings = page.getByLabel("Pengaturan akun");
  await waitForStableBoundingBox(headerLead);
  await waitForStableBoundingBox(settings);
  const leadBox = await headerLead.boundingBox();
  const settingsBox = await settings.boundingBox();
  expect(Math.abs((leadBox?.y ?? 0) - (settingsBox?.y ?? 0))).toBeLessThan(2);
  const footer = page.locator("footer");
  const footerBox = await footer.boundingBox();
  expect(Math.abs((footerBox?.y ?? 0) + (footerBox?.height ?? 0) - 900)).toBeLessThan(2);
  await expect(footer.getByRole("button", { name: "Pilih bahasa" })).toHaveCount(0);
  const footerContentBox = await footer.locator("> div").boundingBox();
  const footerBrandBox = await footer.locator("p").boundingBox();
  expect(Math.abs((footerBrandBox?.x ?? 0) - (footerContentBox?.x ?? 0))).toBeLessThan(2);
});

test("aligns every shared footer item across mobile and desktop viewports", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 600, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/offline");

    const alignment = await page.locator("footer > div").evaluate((footer) => {
      const footerBox = footer.getBoundingClientRect();
      const center = footerBox.x + footerBox.width / 2;
      const items = [...footer.children].map((item) => {
        const box = item.getBoundingClientRect();
        return { center: box.x + box.width / 2 };
      });
      return {
        center,
        items,
        display: getComputedStyle(footer).display,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    expect(alignment.display).toBe("flex");
    expect(alignment.items.every(({ center }) => Math.abs(center - alignment.center) < 2)).toBe(true);
    expect(alignment.documentWidth).toBeLessThanOrEqual(alignment.viewportWidth);
    await expect(page.locator("footer").getByRole("button", { name: "Pilih bahasa" })).toBeVisible();
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/offline");
  const desktopAlignment = await page.locator("footer > div").evaluate((footer) => {
    const footerBox = footer.getBoundingClientRect();
    const [brand, navigation] = Array.from(footer.children).map((item) => item.getBoundingClientRect());
    return {
      center: footerBox.x + footerBox.width / 2,
      left: footerBox.x,
      right: footerBox.right,
      brandLeft: brand.x,
      navigationRight: navigation.right,
      childCount: footer.children.length,
      display: getComputedStyle(footer).display,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });

  expect(desktopAlignment.display).toBe("grid");
  expect(desktopAlignment.childCount).toBe(2);
  expect(Math.abs(desktopAlignment.brandLeft - desktopAlignment.left)).toBeLessThan(2);
  expect(Math.abs(desktopAlignment.navigationRight - desktopAlignment.right)).toBeLessThan(2);
  expect(desktopAlignment.documentWidth).toBeLessThanOrEqual(desktopAlignment.viewportWidth);
  await expect(page.locator("footer").getByRole("button")).toContainText("Bahasa");
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
