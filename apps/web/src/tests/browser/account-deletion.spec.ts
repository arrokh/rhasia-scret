import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { cleanBrowserE2eUsers } from "./support/e2e-database";
import { e2eUserAlias, e2eUserEmail } from "./support/e2e-users";

const baseUrl = `http://127.0.0.1:${process.env.BROWSER_TEST_PORT ?? "3100"}`;

test("web Account Deletion completes the guarded flow and preserves Local Profile data", async ({
  page,
  context,
  browserName,
}) => {
  const alias = e2eUserAlias(browserName, "delete");
  await cleanBrowserE2eUsers([e2eUserEmail(alias)]);
  await authenticate(context, alias);
  await page.goto("/account/delete");
  await expect(page.getByRole("heading", { name: "Hapus akun hosted" })).toBeVisible();
  await seedBrowserData(page);

  await test.step("requires an explicit skipped-backup acknowledgement", async () => {
    const continueWithoutBackup = page.getByRole("button", { name: "Lanjut tanpa cadangan" });
    await expect(continueWithoutBackup).toBeDisabled();
    await page.locator("#account-deletion-skip-backup-ack").check();
    await expect(continueWithoutBackup).toBeEnabled();
    await continueWithoutBackup.click();
    await expect(page.getByRole("heading", { name: "Pilih tindakan untuk Shared Vault yang dimiliki" })).toBeVisible();
  });

  await test.step("requires fresh reauthentication before the final confirmation", async () => {
    await page.getByRole("button", { name: "Lanjut", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Verifikasi bahwa ini benar-benar Anda" })).toBeVisible();

    await page.route("**/api/v1/me/deletion/otp/request", async (route) => {
      await route.fulfill({ status: 204 });
    });
    await page.route("**/api/v1/me/deletion/otp/verify", async (route) => {
      await route.fulfill({ status: 204 });
    });
    await page.getByRole("button", { name: "Kirim kode penghapusan" }).click();
    await page.getByLabel("Kode penghapusan enam digit").fill("123456");
    await page.getByRole("button", { name: "Verifikasi kode" }).click();
    await expect(page.getByRole("heading", { name: "Konfirmasi penghapusan permanen" })).toBeVisible();
  });

  let deletionBody: Record<string, unknown> | null = null;
  await page.route("**/api/v1/me", async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    deletionBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        receiptId: "e2e-account-deletion-receipt",
        email: e2eUserEmail(alias),
        authBackend: "passwordless",
        personalVaultCount: 0,
        sharedVaultDeletedCount: 0,
        sharedVaultTransferredCount: 0,
        authenticatorAccountCount: 0,
        emailDelivery: "SENT",
      }),
    });
  });

  await test.step("requires the exact destructive confirmation and clears hosted browser state", async () => {
    await page.getByLabel("Ketik HAPUS AKUN").fill("HAPUS AKUN");
    await page.locator("#account-deletion-final-ack").check();
    await page.getByRole("button", { name: "Hapus akun permanen", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/delete\/complete\?receipt=e2e-account-deletion-receipt$/);
    await expect(page.getByText(/e2e-account-deletion-receipt/)).toBeVisible();
  });

  expect(deletionBody).toMatchObject({
    confirmation: "HAPUS AKUN",
    acknowledged: true,
    vaultDecisions: [],
  });
  expect(await readBrowserData(page)).toEqual({
    hostedSnapshotCount: 0,
    rememberedBrowserCount: 0,
    localProfileId: "e2e-local-profile-id",
    localStorageMarker: "preserve-local-data",
    hostedDirectoryPreferences: null,
  });
});

async function authenticate(context: BrowserContext, alias: string): Promise<void> {
  await context.addCookies([
    {
      name: "rhsia-e2e-session",
      value: alias,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function seedBrowserData(page: Page): Promise<void> {
  await page.evaluate(async () => {
    localStorage.setItem("e2e-local-data-marker", "preserve-local-data");
    localStorage.setItem("rhasia-scret:account-directory:v1:hosted-profile", '{"order":["hosted-vault:account"]}');
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("rhasia-scret-offline-vault", 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("encrypted-snapshots"))
          database.createObjectStore("encrypted-snapshots", { keyPath: "profileId" });
        if (!database.objectStoreNames.contains("remembered-browsers"))
          database.createObjectStore("remembered-browsers", { keyPath: "profileId" });
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(["encrypted-snapshots", "remembered-browsers"], "readwrite");
        transaction.objectStore("encrypted-snapshots").put({ profileId: "hosted-profile" });
        transaction.objectStore("remembered-browsers").put({ profileId: "hosted-profile" });
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error);
        };
      };
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("rhasia-scret-local-vault", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("local-vault")) request.result.createObjectStore("local-vault");
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("local-vault", "readwrite");
        transaction.objectStore("local-vault").put(
          {
            version: 1,
            profileId: "e2e-local-profile-id",
            createdAt: "2026-01-01T00:00:00.000Z",
            kdf: { algorithm: "ARGON2ID", memoryKiB: 1, iterations: 1, parallelism: 1, salt: "c2FsdA==" },
            wrappedLocalRootKey: "cm9vdA==",
            encryptedLocalVaultKey: "dmF1bHQ=",
            encryptedVaultName: "bmFtZQ==",
            accounts: [],
          },
          "singleton",
        );
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error);
        };
      };
      request.onerror = () => reject(request.error);
    });
  });
}

async function readBrowserData(page: Page): Promise<{
  hostedSnapshotCount: number;
  rememberedBrowserCount: number;
  localProfileId: string | null;
  localStorageMarker: string | null;
  hostedDirectoryPreferences: string | null;
}> {
  return page.evaluate(async () => {
    const readCount = (databaseName: string, storeName: string): Promise<number> =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const countRequest = database.transaction(storeName, "readonly").objectStore(storeName).count();
          countRequest.onsuccess = () => {
            database.close();
            resolve(countRequest.result);
          };
          countRequest.onerror = () => {
            database.close();
            reject(countRequest.error);
          };
        };
      });
    const localProfile = await new Promise<{ profileId?: string } | null>((resolve, reject) => {
      const request = indexedDB.open("rhasia-scret-local-vault");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const readRequest = database.transaction("local-vault", "readonly").objectStore("local-vault").get("singleton");
        readRequest.onsuccess = () => {
          database.close();
          resolve((readRequest.result as { profileId?: string } | undefined) ?? null);
        };
        readRequest.onerror = () => {
          database.close();
          reject(readRequest.error);
        };
      };
    });
    return {
      hostedSnapshotCount: await readCount("rhasia-scret-offline-vault", "encrypted-snapshots"),
      rememberedBrowserCount: await readCount("rhasia-scret-offline-vault", "remembered-browsers"),
      localProfileId: localProfile?.profileId ?? null,
      localStorageMarker: localStorage.getItem("e2e-local-data-marker"),
      hostedDirectoryPreferences: localStorage.getItem("rhasia-scret:account-directory:v1:hosted-profile"),
    };
  });
}
