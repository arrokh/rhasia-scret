import { resolve } from "node:path";
import { expect, test, type BrowserContext, type Page, type Response } from "@playwright/test";
import { cleanBrowserE2eUsers } from "./support/e2e-database";
import { e2eUserAlias, e2eUserEmail, type E2E_BROWSER_SCENARIOS, type E2E_BROWSER_ROLES } from "./support/e2e-users";

const baseUrl = "http://127.0.0.1:3000";
const personalSecret = "e2e personal vault passphrase";
const personalName = "E2E Personal Vault";
const imageTotpSecret = ["JBSW", "Y3DP", "EHPK", "3PXP"].join("");
const manualTotpSecret = ["KRSX", "G5DS", "NFXG", "OIDB"].join("");
const imageTotpUri = `otpauth://totp/E2E%20Image:image-user?secret=${imageTotpSecret}&issuer=E2E%20Image&algorithm=SHA1&digits=6&period=30`;
const manualTotpUri = `otpauth://totp/E2E%20Manual:manual-user?secret=${manualTotpSecret}&issuer=E2E%20Manual&algorithm=SHA256&digits=8&period=45`;

test.beforeEach(async ({ page }) => installMockClipboard(page));

test("administrator-invited session, Personal Vault initialization, lock, unlock, and logout stay client-safe", async ({ page, context, browserName }) => {
  const alias = scenarioAlias(browserName, "personal");
  await cleanBrowserE2eUsers([e2eUserEmail(alias)]);
  const observed = observeSensitiveSurfaces(page);
  let keyMaterial: string[] = [];

  await test.step("protected routes reject an unauthenticated browser", async () => {
    await page.goto("/vaults");
    await expect(page).toHaveURL(/\/sign-in\?auth=required$/);
  });

  await test.step("a configured administrator-invited test session reaches first-login setup", async () => {
    await authenticate(context, alias);
    await page.goto("/vaults");
    await expect(page.getByRole("heading", { name: "Siapkan Brankas Pribadi" })).toBeVisible();
    await initializePersonalVault(page, personalName, personalSecret);
    await expect(page.getByRole("heading", { name: "Brankas Anda terkunci" })).toBeVisible({ timeout: 30_000 });
    const lockedDirectoryPage = await context.newPage();
    try {
      await lockedDirectoryPage.goto("/vaults/manage");
      await expect(lockedDirectoryPage.getByRole("heading", { name: "Brankas Anda terkunci" })).toBeVisible();
      await expect(lockedDirectoryPage.locator('a[href="/vaults/backup"]')).toHaveCount(0);
      await expect(lockedDirectoryPage.locator('a[href="/vaults/import"]')).toHaveCount(0);
    } finally {
      await lockedDirectoryPage.close();
    }
  });

  await test.step("unlock creates only an in-memory workspace and explicit lock clears key buffers", async () => {
    await unlockVault(page, personalSecret);
    await expect(page.getByRole("heading", { name: "Akun autentikator" }).last()).toBeVisible();
    await expectWorkspaceInspection(page, { workspacePresent: true, lastClearedAllZero: null });
    keyMaterial = await activeWorkspaceKeyMaterial(page);
    expect(keyMaterial.length).toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: "Kunci" }).click();
    await expect(page.getByRole("heading", { name: "Brankas Anda terkunci" })).toBeVisible();
    await expectWorkspaceInspection(page, { workspacePresent: false, lastClearedAllZero: true });
    await unlockVault(page, personalSecret);
  });

  await test.step("logout clears local encrypted state and destroys the browser session", async () => {
    let releaseLogout = () => {};
    const logoutHeld = new Promise<void>((resolveLogout) => { releaseLogout = resolveLogout; });
    await page.route("**/auth/logout", async (route) => { await logoutHeld; await route.continue(); });
    await page.getByRole("button", { name: "Pengaturan akun" }).click();
    await page.getByRole("button", { name: "Keluar", exact: true }).click();
    const logout = page.getByRole("dialog").getByRole("button", { name: "Keluar", exact: true }).click();
    await expectWorkspaceInspection(page, { workspacePresent: false, lastClearedAllZero: true });
    releaseLogout();
    await logout;
    await page.unroute("**/auth/logout");
    await expect(page).toHaveURL(/\/sign-in\?auth=signed_out$/);
    await page.goto("/vaults");
    await expect(page).toHaveURL(/\/sign-in\?auth=required$/);
    expect(await persistedApplicationRecordCount(page)).toBe(0);
  });

  await assertNoSensitiveLeak(page, observed, [personalSecret, personalName, ...keyMaterial]);
});

test("QR image and manual TOTP workflows preserve encryption, revisions, recovery, generation, and copy", async ({ page, context, browserName }) => {
  skipDataHeavyWebKitCi(browserName);
  const alias = scenarioAlias(browserName, "accounts");
  await cleanBrowserE2eUsers([e2eUserEmail(alias)]);
  await authenticate(context, alias);
  const observed = observeSensitiveSurfaces(page);
  await page.goto("/vaults");
  await initializePersonalVault(page, personalName, personalSecret);
  await expect(page.getByRole("heading", { name: "Brankas Anda terkunci" })).toBeVisible({ timeout: 30_000 });
  await unlockVault(page, personalSecret);

  let accountId = "";
  let vaultId = "";
  let latestEncryptedPayload = "";
  let generatedOtp = "";

  await test.step("upload and preview a QR image before encrypted persistence", async () => {
    await page.getByRole("link", { name: "Tambahkan akun autentikator" }).click();
    await page.locator("#qr-image").setInputFiles(resolve(process.cwd(), "src/tests/browser/fixtures/e2e-totp-qr.svg"));
    await expect(page.getByRole("heading", { name: "Metadata autentikator" })).toBeVisible();
    await expect(page.getByText("E2E Image", { exact: true })).toBeVisible();
    const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && /\/api\/vaults\/[^/]+\/accounts$/.test(new URL(response.url()).pathname));
    await page.getByRole("button", { name: "Simpan akun" }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const created = await response.json() as { id: string; revision: number };
    accountId = created.id;
    expect(created.revision).toBe(1);
    vaultId = new URL(response.url()).pathname.split("/")[3] ?? "";
    await expect(page).toHaveURL(/\/vaults$/);
  });

  await test.step("local OTP generation exposes a countdown and copies only on explicit action", async () => {
    const output = page.getByLabel("OTP saat ini").first();
    await expect(output).toHaveText(/\d{3} \d{3}/);
    generatedOtp = (await output.textContent() ?? "").replace(/\s/g, "");
    expect(generatedOtp).toMatch(/^\d{6}$/);
    await expect(page.getByLabel(/detik tersisa/).first()).toBeVisible();
    await page.getByRole("button", { name: "Salin OTP untuk image-user, E2E Image" }).click();
    await expect(page.getByText("Disalin", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as typeof window & { __RHSIA_E2E_CLIPBOARD__?: string }).__RHSIA_E2E_CLIPBOARD__)).toBe(generatedOtp);
  });

  await test.step("manual import warns about a duplicate and requires explicit add-anyway confirmation", async () => {
    await page.getByRole("link", { name: "Tambahkan akun autentikator" }).click();
    await page.getByRole("textbox", { name: "Masukkan URI secara manual" }).fill(imageTotpUri);
    await page.getByRole("button", { name: "Gunakan URI manual" }).click();
    await expect(page.getByRole("heading", { name: "Metadata autentikator" })).toBeVisible();
    await page.getByRole("button", { name: "Simpan akun" }).click();
    await expect(page.getByText("Akun serupa sudah ada")).toBeVisible();
    await page.getByRole("button", { name: "Tetap tambahkan" }).click();
    await expect(page).toHaveURL(/\/vaults$/);
    await expect(page.getByLabel("2 akun")).toBeVisible();
  });

  await test.step("edit increments revision and a stale overwrite remains a distinct conflict", async () => {
    await page.getByRole("button", { name: "Kelola image-user" }).first().click();
    const label = page.getByRole("dialog").getByLabel("Label akun");
    await label.fill("image-user-edited");
    const responsePromise = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes(`/api/vaults/${vaultId}/accounts`));
    await page.getByRole("dialog").getByRole("button", { name: "Simpan label" }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ id: accountId, revision: 2 });
    const requestBody = JSON.parse(response.request().postData() ?? "{}") as { encryptedPayload: string };
    latestEncryptedPayload = requestBody.encryptedPayload;
    await expect(page.getByText("Label akun diperbarui.")).toBeVisible();

    const stale = await page.evaluate(async ({ id, targetVaultId, encryptedPayload }) => {
      const response = await fetch(`/api/vaults/${targetVaultId}/accounts`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: id, expectedRevision: 1, encryptedPayload, encryptionVersion: 1 }) });
      return { status: response.status, body: await response.json() };
    }, { id: accountId, targetVaultId: vaultId, encryptedPayload: latestEncryptedPayload });
    expect(stale).toEqual({ status: 409, body: { error: "stale_revision" } });
  });

  await test.step("delete and restore preserve edited ciphertext while advancing revision", async () => {
    await page.getByRole("button", { name: "Tutup" }).click();
    await page.getByRole("button", { name: "Kelola image-user-edited" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Hapus akun" }).click();
    const deleteResponse = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().includes(`/api/vaults/${vaultId}/accounts`));
    await page.getByRole("dialog").getByRole("button", { name: "Hapus akun", exact: true }).click();
    expect((await deleteResponse).status()).toBe(204);
    await expect(page.getByLabel("1 akun")).toBeVisible();

    const restored = await page.evaluate(async ({ id, targetVaultId }) => {
      const response = await fetch(`/api/vaults/${targetVaultId}/accounts`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: id }) });
      return response.status;
    }, { id: accountId, targetVaultId: vaultId });
    expect(restored).toBe(204);
    const restoredRecord = await page.evaluate(async ({ id, targetVaultId }) => {
      const accounts = await fetch(`/api/vaults/${targetVaultId}/accounts`).then((response) => response.json()) as Array<{ id: string; encryptedPayload: string; encryptionVersion: number; revision: number }>;
      return accounts.find((account) => account.id === id);
    }, { id: accountId, targetVaultId: vaultId });
    expect(restoredRecord).toEqual({ id: accountId, encryptedPayload: latestEncryptedPayload, encryptionVersion: 1, revision: 4 });
    await page.reload();
    await unlockVault(page, personalSecret);
    await expect(page.getByRole("button", { name: "Kelola image-user-edited" })).toBeVisible();
    await expect(page.getByLabel("2 akun")).toBeVisible();
  });

  await assertNoSensitiveLeak(page, observed, [personalSecret, personalName, imageTotpUri, imageTotpSecret, "image-user", "image-user-edited", generatedOtp]);
});

test("Shared Vault invitations, Viewer boundaries, audit, membership loss, deletion, and restoration use the real stack", async ({ page, context, browser, browserName }) => {
  skipDataHeavyWebKitCi(browserName);
  const ownerAlias = scenarioAlias(browserName, "shared", "owner");
  const leaveAlias = scenarioAlias(browserName, "shared", "viewer-leave");
  const revokeAlias = scenarioAlias(browserName, "shared", "viewer-revoke");
  const aliases = [ownerAlias, leaveAlias, revokeAlias];
  await cleanBrowserE2eUsers(aliases.map(e2eUserEmail));
  const ownerSecret = "e2e shared owner passphrase";
  const leaveSecret = "e2e leave viewer passphrase";
  const revokeSecret = "e2e revoke viewer passphrase";
  const sharedName = "E2E Shared Treasury";
  const observed = observeSensitiveSurfaces(page);
  await authenticate(context, ownerAlias);
  await page.goto("/vaults");
  await initializePersonalVault(page, "Owner Personal Vault", ownerSecret);
  await expect(page.getByRole("heading", { name: "Brankas Anda terkunci" })).toBeVisible({ timeout: 30_000 });
  await unlockVault(page, ownerSecret);

  const leaveContext = await browser.newContext({ baseURL: baseUrl });
  const revokeContext = await browser.newContext({ baseURL: baseUrl });
  await installMockClipboard(leaveContext);
  await installMockClipboard(revokeContext);
  const leavePage = await leaveContext.newPage();
  const revokePage = await revokeContext.newPage();
  const leaveObserved = observeSensitiveSurfaces(leavePage);
  const revokeObserved = observeSensitiveSurfaces(revokePage);
  try {
    await initializeUserContext(leavePage, leaveContext, leaveAlias, "Leave Personal Vault", leaveSecret);
    await initializeUserContext(revokePage, revokeContext, revokeAlias, "Revoke Personal Vault", revokeSecret);

    let sharedVaultId = "";
    await test.step("owner creates an encrypted Shared Vault and account", async () => {
      await page.getByRole("link", { name: "Brankas", exact: true }).click();
      await page.getByRole("link", { name: "Brankas Bersama" }).click();
      await page.getByLabel("Nama Brankas Bersama").fill(sharedName);
      const creationResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/shared-vaults");
      await page.getByRole("button", { name: "Buat Brankas" }).click();
      const created = await (await creationResponse).json() as { id: string };
      sharedVaultId = created.id;
      await expect(page).toHaveURL(new RegExp(`/vaults/manage/${sharedVaultId}$`));
      await page.getByRole("link", { name: "Tambah akun" }).click();
      await page.getByRole("textbox", { name: "Masukkan URI secara manual" }).fill(manualTotpUri);
      await page.getByRole("button", { name: "Gunakan URI manual" }).click();
      await page.getByRole("button", { name: "Simpan akun" }).click();
      await expect(page).toHaveURL(/\/vaults$/);
      await expect(page.getByRole("button", { name: "Salin OTP untuk manual-user, E2E Manual" })).toBeVisible();
    });

    let leaveInvitation = "";
    await test.step("owner creates encrypted one-time invitation material", async () => {
      await openSharedManagement(page, ownerSecret, sharedName);
      leaveInvitation = await createInvitation(page, e2eUserEmail(leaveAlias));
      expect(leaveInvitation).toContain("#");
      expect(observed.requests.join("\n")).not.toContain(leaveInvitation.split("#")[1] ?? "missing-secret");
    });

    let viewerOtp = "";
    await test.step("recipient redeems in-browser, sees generic locked labels, and cannot enumerate owner surfaces", async () => {
      await redeemInvitation(leavePage, leaveInvitation, leaveSecret, [sharedName, "E2E Manual", "manual-user"]);
      const copyResponse = leavePage.waitForResponse((response) => response.request().method() === "POST" && response.url().includes(`/api/shared-vaults/${sharedVaultId}/audit-events`));
      const otp = leavePage.getByLabel("OTP saat ini").first();
      await expect(otp).toHaveText(/\d{4} \d{4}/);
      viewerOtp = (await otp.textContent() ?? "").replace(/\s/g, "");
      await leavePage.getByRole("button", { name: "Salin OTP untuk manual-user, E2E Manual" }).click();
      expect((await copyResponse).status()).toBe(204);

      const denied = await leavePage.evaluate(async ({ vaultId }) => {
        const [participants, audit, accountMutation, invitationMutation, memberMutation, bundleResponse] = await Promise.all([
          fetch(`/api/shared-vaults/${vaultId}/participants`),
          fetch(`/api/shared-vaults/${vaultId}/audit-events`),
          fetch(`/api/shared-vaults/${vaultId}/accounts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ encryptedPayload: "AQEBAQEBAQEBAQEBAQEBAQE=", encryptionVersion: 1 }) }),
          fetch(`/api/shared-vaults/${vaultId}/share-links`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipientEmail: "owner@browser-e2e.test", linkVerifier: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", encryptedPackage: "AQEBAQEBAQEBAQEBAQEBAQE=" }) }),
          fetch(`/api/shared-vaults/${vaultId}/members/00000000-0000-4000-8000-000000000000`, { method: "DELETE" }),
          fetch("/api/sync/offline-bundle")
        ]);
        const bundle = await bundleResponse.json() as { sharedVaults: Array<Record<string, unknown>> };
        const sharedVault = bundle.sharedVaults.find((vault) => vault.vaultId === vaultId);
        return {
          participants: participants.status,
          audit: audit.status,
          accountMutation: accountMutation.status,
          invitationMutation: invitationMutation.status,
          memberMutation: memberMutation.status,
          sharedVaultFields: sharedVault ? Object.keys(sharedVault).sort() : []
        };
      }, { vaultId: sharedVaultId });
      expect(denied).toEqual({
        participants: 404,
        audit: 404,
        accountMutation: 404,
        invitationMutation: 404,
        memberMutation: 404,
        sharedVaultFields: ["accounts", "encryptedName", "encryptedVaultKey", "encryptionVersion", "keyVersion", "lifecycle", "role", "vaultId"]
      });

      const requestCountBeforeViewerManagement = leaveObserved.requests.length;
      await leavePage.getByRole("link", { name: "Brankas", exact: true }).click();
      await leavePage.getByRole("link", { name: sharedName }).click();
      await expect(leavePage.getByText("Anda dapat melihat dan menyalin OTP")).toBeVisible();
      await expect(leavePage.getByRole("tab", { name: "Undangan" })).toHaveCount(0);
      await expect(leavePage.getByRole("tab", { name: "Audit" })).toHaveCount(0);
      await expect(leavePage.getByRole("link", { name: "Tambah akun" })).toHaveCount(0);
      expect(leaveObserved.requests.slice(requestCountBeforeViewerManagement).some((request) => request.includes("/participants") || request.includes("/audit-events"))).toBe(false);
    });

    await test.step("Viewer leave removes access on the next authorized reconciliation", async () => {
      const status = await leavePage.evaluate(async ({ vaultId }) => (await fetch(`/api/shared-vaults/${vaultId}/leave`, { method: "POST" })).status, { vaultId: sharedVaultId });
      expect(status).toBe(204);
      await leavePage.goto("/vaults");
      await unlockVault(leavePage, leaveSecret);
      await expect(leavePage.getByText(sharedName, { exact: true })).toHaveCount(0);
      await expect(leavePage.getByRole("button", { name: "Salin OTP untuk manual-user, E2E Manual" })).toHaveCount(0);
    });

    let revokeInvitation = "";
    await test.step("a second recipient can be revoked by the owner", async () => {
      await openSharedManagement(page, ownerSecret, sharedName);
      revokeInvitation = await createInvitation(page, e2eUserEmail(revokeAlias));
      await redeemInvitation(revokePage, revokeInvitation, revokeSecret, [sharedName, "E2E Manual", "manual-user"]);
      await openSharedManagement(page, ownerSecret, sharedName);
      await page.getByRole("tab", { name: "Undangan" }).click();
      const revokeEmail = e2eUserEmail(revokeAlias);
      const revokeParticipant = page.getByRole("listitem").filter({ hasText: revokeEmail });
      await expect(revokeParticipant.getByText("Anggota aktif")).toBeVisible();
      await page.getByRole("button", { name: `Hapus ${revokeEmail}` }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Cabut akses" }).click();
      await expect(page.getByText(revokeEmail, { exact: true })).toHaveCount(0);
      await revokePage.goto("/vaults");
      await unlockVault(revokePage, revokeSecret);
      await expect(revokePage.getByText(sharedName, { exact: true })).toHaveCount(0);
    });

    await test.step("owner sees redacted audit transport without plaintext labels or OTPs", async () => {
      await openSharedManagement(page, ownerSecret, sharedName);
      const auditResponse = page.waitForResponse((response) => response.request().method() === "GET" && response.url().includes(`/api/vaults/${sharedVaultId}/audit-events`));
      await page.getByRole("tab", { name: "Audit" }).click();
      await expect(page.getByText("Akun autentikator disalin")).toBeVisible();
      const auditBody = await (await auditResponse).text();
      expect(auditBody).not.toContain("E2E Manual");
      expect(auditBody).not.toContain("manual-user");
      expect(auditBody).not.toContain(viewerOtp);
    });

    await test.step("Shared Vault deletion restores, while Personal Vault deletion is impossible", async () => {
      const outcomes = await page.evaluate(async ({ vaultId }) => {
        const personal = await fetch("/api/personal-vault").then((response) => response.json()) as { id: string };
        const personalDelete = await fetch(`/api/shared-vaults/${personal.id}/lifecycle`, { method: "DELETE" });
        const deleted = await fetch(`/api/shared-vaults/${vaultId}/lifecycle`, { method: "DELETE" });
        const restored = await fetch(`/api/shared-vaults/${vaultId}/lifecycle`, { method: "POST" });
        return { personalDelete: personalDelete.status, deleted: deleted.status, restored: restored.status };
      }, { vaultId: sharedVaultId });
      expect(outcomes).toEqual({ personalDelete: 404, deleted: 204, restored: 204 });
      await page.goto("/vaults");
      await unlockVault(page, ownerSecret);
      await expect(page.getByRole("button", { name: "Salin OTP untuk manual-user, E2E Manual" })).toBeVisible();
    });

    await assertNoSensitiveLeak(page, observed, [ownerSecret, sharedName, manualTotpUri, manualTotpSecret, "manual-user", viewerOtp, leaveInvitation.split("#")[1] ?? ""]);
    await assertNoSensitiveLeak(leavePage, leaveObserved, [leaveSecret, sharedName, manualTotpUri, manualTotpSecret, "manual-user", viewerOtp]);
    await assertNoSensitiveLeak(revokePage, revokeObserved, [revokeSecret, sharedName, manualTotpUri, manualTotpSecret, "manual-user"]);
  } finally {
    await leaveContext.close();
    await revokeContext.close();
  }
});

test("English setup, unlock, account creation, and OTP smoke use the real stack", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "One Chromium scenario provides the English real-stack smoke while every browser keeps the Indonesian security baseline.");
  const alias = scenarioAlias(browserName, "english");
  await cleanBrowserE2eUsers([e2eUserEmail(alias)]);
  await authenticate(context, alias);
  await context.addCookies([{ name: "RHSIA_LOCALE", value: "en", url: baseUrl, sameSite: "Lax" }]);

  const secret = "e2e english vault passphrase";
  await page.goto("/vaults");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByLabel("Vault name").fill("");
  await page.getByRole("button", { name: "Secure Personal Vault" }).click();
  await expect(page.getByText("Vault name is required.")).toBeVisible();
  await page.getByLabel("Vault name").fill("E2E English Personal Vault");
  await page.getByLabel("Create your own").click();
  await page.getByRole("textbox", { name: "Your Vault Passphrase", exact: true }).fill(secret);
  await page.getByRole("textbox", { name: "Re-enter your Vault Passphrase" }).fill(secret);
  await page.getByLabel(/I understand that without an access-recovery key/).click();
  await page.getByRole("button", { name: "Secure Personal Vault" }).click();

  await expect(page.getByRole("heading", { name: "Your vault is locked" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("textbox", { name: "Vault Passphrase", exact: true }).fill(secret);
  await page.getByRole("button", { name: "Unlock Vault" }).click();
  await expect(page.getByRole("button", { name: "Lock" })).toBeVisible({ timeout: 120_000 });

  await page.getByRole("link", { name: "Add authenticator account" }).click();
  await page.locator("#qr-image").setInputFiles(resolve(process.cwd(), "src/tests/browser/fixtures/e2e-totp-qr.svg"));
  await expect(page.getByRole("heading", { name: "Authenticator metadata" })).toBeVisible();
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(page).toHaveURL(/\/vaults$/);
  await expect(page.getByLabel("Current OTP")).toHaveText(/\d{3} \d{3}/);
  await page.getByRole("button", { name: "Copy OTP for image-user, E2E Image" }).click();
  await expect(page.getByText("Copied", { exact: true })).toBeVisible();
});

test("Passkey-assisted enrollment and unlock release the local package only after verification with fallback", async ({ page, context, browserName }) => {
  const alias = scenarioAlias(browserName, "passkey");
  await cleanBrowserE2eUsers([e2eUserEmail(alias)]);
  await installMockPasskey(page, browserName);
  await authenticate(context, alias);
  const observed = observeSensitiveSurfaces(page);
  const secret = "e2e passkey fallback passphrase";
  const vaultName = "E2E Passkey Personal Vault";
  await page.goto("/vaults");
  await initializePersonalVault(page, vaultName, secret);
  await expect(page.getByRole("heading", { name: "Brankas Anda terkunci" })).toBeVisible({ timeout: 30_000 });
  await unlockVault(page, secret);

  await test.step("enrollment stores only an opaque recovery package after PRF verification", async () => {
    await page.getByRole("button", { name: "Keamanan brankas" }).click();
    await expect(page.getByRole("button", { name: "Aktifkan pemulihan kunci akses" })).toBeVisible();
    await page.getByRole("button", { name: "Aktifkan pemulihan kunci akses" }).click();
    await expect(page.getByText("Pemulihan kunci akses aktif")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("dialog", { name: "Keamanan brankas" }).press("Escape");
    await expect(page.getByRole("dialog", { name: "Keamanan brankas" })).toHaveCount(0);
  });

  await test.step("verified passkey unlock opens the current authorized bundle", async () => {
    await page.getByRole("button", { name: "Kunci" }).click();
    await expect(page.getByRole("heading", { name: "Brankas Anda terkunci" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Buka dengan passkey" })).toBeVisible();
    await page.getByRole("button", { name: "Buka dengan passkey" }).click();
    await expect(page.getByRole("button", { name: "Kunci" })).toBeVisible({ timeout: 30_000 });
  });

  await test.step("unsupported verification fails without key release and the Vault Unlock Secret still works", async () => {
    await page.getByRole("button", { name: "Kunci" }).click();
    await page.evaluate(() => {
      Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "credentials", { configurable: true, value: { get: async () => { throw new DOMException("Unsupported", "NotSupportedError"); } } });
    });
    await page.getByRole("button", { name: "Buka dengan passkey" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Passkey tidak dapat membuka brankas" })).toBeVisible();
    await unlockVault(page, secret);
  });

  await assertNoSensitiveLeak(page, observed, [secret, vaultName]);
});

async function initializeUserContext(page: Page, context: BrowserContext, alias: string, name: string, secret: string): Promise<void> {
  await authenticate(context, alias);
  await page.goto("/vaults");
  await initializePersonalVault(page, name, secret);
  await expect(page.getByRole("heading", { name: "Brankas Anda terkunci" })).toBeVisible({ timeout: 30_000 });
}

async function openSharedManagement(page: Page, secret: string, sharedName: string): Promise<void> {
  const invitationsTab = page.getByRole("tab", { name: "Undangan" });
  if (await invitationsTab.isVisible()) {
    await page.getByRole("link", { name: "Kembali ke daftar brankas" }).click();
  } else {
    const vaultsLink = page.getByRole("link", { name: "Brankas", exact: true });
    if (!(await vaultsLink.isVisible())) {
      await page.goto("/vaults", { waitUntil: "domcontentloaded" });
      await unlockVault(page, secret);
    }
    await page.getByRole("link", { name: "Brankas", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/vaults\/manage\/?$/);
  await page.getByRole("link", { name: sharedName }).click();
  await expect(page).toHaveURL(/\/vaults\/manage\/[^/]+$/);
  await expect(invitationsTab).toBeVisible();
}

async function createInvitation(page: Page, email: string): Promise<string> {
  await page.getByRole("tab", { name: "Undangan" }).click();
  await page.getByLabel("Email penerima").fill(email);
  await page.getByRole("button", { name: "Buat undangan" }).click();
  const output = page.getByLabel("Tautan undangan aman");
  await expect(output).toBeVisible();
  return (await output.textContent() ?? "").trim();
}

async function redeemInvitation(page: Page, invitation: string, secret: string, lockedPlaintext: string[]): Promise<void> {
  await page.goto(invitation);
  for (const value of lockedPlaintext) await expect(page.getByText(value, { exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Passphrase Brankas", exact: true }).fill(secret);
  await page.getByRole("button", { name: "Buka Brankas" }).click();
  await expect(page.getByRole("button", { name: "Terima undangan" })).toBeVisible({ timeout: 30_000 });
  const redemptionResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/secure-share-links");
  await page.getByRole("button", { name: "Terima undangan" }).click();
  expect((await redemptionResponse).status()).toBe(204);
  await page.goto("/vaults", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Brankas Anda terkunci" })).toBeVisible({ timeout: 30_000 });
  for (const value of lockedPlaintext) await expect(page.getByText(value, { exact: true })).toHaveCount(0);
  await unlockVault(page, secret);
  await expect(page.getByRole("button", { name: "Salin OTP untuk manual-user, E2E Manual" })).toBeVisible();
}

function scenarioAlias(browserName: string, scenario: typeof E2E_BROWSER_SCENARIOS[number], role: typeof E2E_BROWSER_ROLES[number] = "owner"): string {
  return e2eUserAlias(browserName, scenario, role);
}

function skipDataHeavyWebKitCi(browserName: string): void {
  test.skip(
    process.env.CI === "true" && browserName === "webkit",
    "Linux WebKit on constrained CI cannot reliably repeat the production-strength Argon2 workflow after data-heavy browser operations; Chromium and Firefox retain complete scenario coverage, while WebKit retains Personal Vault and passkey coverage."
  );
}

async function authenticate(context: BrowserContext, alias: string): Promise<void> {
  await context.addCookies([{ name: "rhsia-e2e-session", value: alias, url: baseUrl, httpOnly: true, sameSite: "Lax" }]);
}

async function initializePersonalVault(page: Page, name: string, secret: string): Promise<void> {
  await page.getByLabel("Nama Brankas").fill(name);
  await page.getByLabel("Buat sendiri").click();
  await page.getByRole("textbox", { name: "Passphrase Brankas Anda" }).fill(secret);
  await page.getByRole("textbox", { name: "Masukkan kembali Passphrase Brankas" }).fill(secret);
  await page.getByLabel(/Saya memahami/).click();
  await page.getByRole("button", { name: "Amankan Brankas Pribadi" }).click();
}

async function unlockVault(page: Page, secret: string): Promise<void> {
  const input = page.getByRole("textbox", { name: "Passphrase Brankas", exact: true });
  await expect(input).toBeVisible();
  await input.fill(secret);
  await expect(input).toHaveValue(secret);
  await page.getByRole("button", { name: "Buka Brankas" }).click();
  await expect(page.getByRole("button", { name: "Kunci" })).toBeVisible({ timeout: 120_000 });
}

async function installMockClipboard(target: Pick<Page, "addInitScript"> | Pick<BrowserContext, "addInitScript">): Promise<void> {
  await target.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value: string) => { (window as typeof window & { __RHSIA_E2E_CLIPBOARD__?: string }).__RHSIA_E2E_CLIPBOARD__ = value; },
      readText: async () => (window as typeof window & { __RHSIA_E2E_CLIPBOARD__?: string }).__RHSIA_E2E_CLIPBOARD__ ?? ""
    } });
  });
}

async function installMockPasskey(page: Page, browserName: string): Promise<void> {
  const credentialBytes = [...new TextEncoder().encode(browserName)];
  await page.addInitScript(({ credentialBytes: configuredCredentialBytes }) => {
    const rawCredentialId = Uint8Array.from(configuredCredentialBytes);
    const credentialId = btoa(String.fromCharCode(...rawCredentialId)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const prfOutput = Uint8Array.from({ length: 32 }, (_, index) => index + 101);
    class FakeAttestationResponse {
      attestationObject = Uint8Array.of(1, 2, 3).buffer;
      clientDataJSON = Uint8Array.of(4, 5, 6).buffer;
      getTransports() { return ["internal"] as AuthenticatorTransport[]; }
    }
    class FakeAssertionResponse {
      authenticatorData = Uint8Array.of(7, 8, 9).buffer;
      clientDataJSON = Uint8Array.of(10, 11, 12).buffer;
      signature = Uint8Array.of(13, 14, 15).buffer;
      userHandle = null;
    }
    class FakePublicKeyCredential {
      id = credentialId;
      rawId = rawCredentialId.slice().buffer;
      type = "public-key";
      constructor(readonly response: FakeAttestationResponse | FakeAssertionResponse) {}
      getClientExtensionResults() { return { browserE2eTest: true, prf: { enabled: true, results: { first: prfOutput.slice().buffer } } }; }
    }
    Object.defineProperty(window, "AuthenticatorAttestationResponse", { configurable: true, value: FakeAttestationResponse });
    Object.defineProperty(window, "AuthenticatorAssertionResponse", { configurable: true, value: FakeAssertionResponse });
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: FakePublicKeyCredential });
    Object.defineProperty(navigator, "credentials", { configurable: true, value: {
      create: async () => new FakePublicKeyCredential(new FakeAttestationResponse()),
      get: async () => new FakePublicKeyCredential(new FakeAssertionResponse())
    } });
  }, { credentialBytes });
}

function observeSensitiveSurfaces(page: Page): { requests: string[]; responses: string[]; logs: string[] } {
  const result = { requests: [] as string[], responses: [] as string[], logs: [] as string[] };
  page.on("request", (request) => {
    if (request.url().includes("/api/")) result.requests.push(`${request.method()} ${request.url()} ${request.postData() ?? ""}`);
  });
  page.on("response", async (response: Response) => {
    if (!response.url().includes("/api/")) return;
    try { result.responses.push(`${response.status()} ${response.url()} ${await response.text()}`); } catch { /* Navigation may dispose a response body. */ }
  });
  page.on("console", (message) => result.logs.push(message.text()));
  page.on("pageerror", (error) => result.logs.push(error.message));
  return result;
}

async function assertNoSensitiveLeak(page: Page, observed: { requests: string[]; responses: string[]; logs: string[] }, sensitive: string[]): Promise<void> {
  const surfaces = [observed.requests.join("\n"), observed.responses.join("\n"), observed.logs.join("\n"), await persistentBrowserText(page), await queryStateText(page)];
  for (const value of sensitive) {
    expect(value.length).toBeGreaterThan(0);
    for (const surface of surfaces) expect(surface).not.toContain(value);
  }
}

async function persistentBrowserText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const values: unknown[] = [
      ...Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
      ...Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)])
    ];
    if ("databases" in indexedDB) {
      for (const database of await indexedDB.databases()) {
        if (!database.name) continue;
        values.push(await readIndexedDatabase(database.name));
      }
    }
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) values.push([request.url, await (await cache.match(request))?.text()]);
    }
    return JSON.stringify(values);

    function readIndexedDatabase(name: string): Promise<unknown> {
      return new Promise((resolveDatabase, rejectDatabase) => {
        const request = indexedDB.open(name);
        request.onerror = () => rejectDatabase(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const stores = [...database.objectStoreNames];
          if (!stores.length) { database.close(); resolveDatabase([name, []]); return; }
          const transaction = database.transaction(stores, "readonly");
          const result: unknown[] = [];
          for (const storeName of stores) {
            const all = transaction.objectStore(storeName).getAll();
            all.onsuccess = () => result.push([storeName, all.result]);
          }
          transaction.oncomplete = () => { database.close(); resolveDatabase([name, result]); };
          transaction.onerror = () => { database.close(); rejectDatabase(transaction.error); };
        };
      });
    }
  });
}

async function persistedApplicationRecordCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    if (!("databases" in indexedDB)) return 0;
    let count = 0;
    for (const databaseInfo of await indexedDB.databases()) {
      if (databaseInfo.name !== "rhasia-scret-offline-vault") continue;
      count += await new Promise<number>((resolveCount, rejectCount) => {
        const request = indexedDB.open(databaseInfo.name as string);
        request.onerror = () => rejectCount(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const stores = [...database.objectStoreNames];
          if (!stores.length) { database.close(); resolveCount(0); return; }
          const transaction = database.transaction(stores, "readonly");
          let records = 0;
          for (const store of stores) {
            const counter = transaction.objectStore(store).count();
            counter.onsuccess = () => { records += counter.result; };
          }
          transaction.oncomplete = () => { database.close(); resolveCount(records); };
          transaction.onerror = () => { database.close(); rejectCount(transaction.error); };
        };
      });
    }
    return count;
  });
}

async function queryStateText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const inspect = (window as typeof window & { __RHSIA_E2E_QUERY_STATE__?: () => unknown }).__RHSIA_E2E_QUERY_STATE__;
    return inspect ? JSON.stringify(inspect()) : "";
  });
}

async function expectWorkspaceInspection(page: Page, expected: { workspacePresent: boolean; lastClearedAllZero: boolean | null }): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const inspect = (window as typeof window & { __RHSIA_E2E_WORKSPACE_STATE__?: () => unknown }).__RHSIA_E2E_WORKSPACE_STATE__;
    return inspect?.();
  })).toMatchObject(expected);
}

async function activeWorkspaceKeyMaterial(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const inspect = (window as typeof window & { __RHSIA_E2E_WORKSPACE_STATE__?: () => unknown }).__RHSIA_E2E_WORKSPACE_STATE__;
    const state = inspect?.() as { activeKeyMaterial?: unknown } | undefined;
    return Array.isArray(state?.activeKeyMaterial) ? state.activeKeyMaterial.filter((value): value is string => typeof value === "string") : [];
  });
}
