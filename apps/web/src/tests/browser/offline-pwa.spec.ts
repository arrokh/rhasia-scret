import { expect, test } from "@playwright/test";
import { argon2id } from "hash-wasm";
import {
  encryptPayloadWithContext,
  serializeEncryptedEnvelope,
} from "@/modules/crypto/infrastructure/browser-crypto-envelope";

test.describe("encrypted read-only offline PWA", () => {
  test("uses the configured manifest and boots only the public offline shell from a static cache", async ({
    page,
    context,
    browserName,
  }) => {
    await page.goto("/offline");
    await expect(page.getByRole("heading", { name: "Akses brankas luring" })).toBeVisible();

    const manifest = await page.evaluate(async () =>
      fetch("/manifest.webmanifest").then((response) => response.json()),
    );
    expect(manifest).toMatchObject({
      name: "rhasia-scret",
      short_name: "rhasia-scret",
      display: "standalone",
      orientation: "portrait",
    });
    expect(manifest.icons.length).toBeGreaterThan(0);

    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("pwa-activation-preservation", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("marker");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction("marker", "readwrite");
          transaction.objectStore("marker").put("preserved", "state");
          transaction.oncomplete = () => {
            request.result.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    });
    if (browserName !== "firefox") {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.evaluate(() => navigator.serviceWorker.ready);
    }

    if (browserName !== "firefox") {
      const cachedUrls = await page.evaluate(async () => {
        const names = await caches.keys();
        const owned = names.filter((name) => name.startsWith("rhasia-scret-static-"));
        return (await Promise.all(owned.map(async (name) => (await caches.open(name)).keys())))
          .flat()
          .map((request) => new URL(request.url).pathname);
      });
      expect(cachedUrls).toContain("/offline");
      expect(cachedUrls.some((url) => url.startsWith("/_next/static/"))).toBe(true);
      expect(cachedUrls.some((url) => url.startsWith("/api/") || url.startsWith("/auth/"))).toBe(false);
    }

    await context.setOffline(true);
    if (browserName === "chromium") await page.goto("/vaults", { waitUntil: "domcontentloaded" });
    else if (browserName === "firefox") await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    else await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.getByRole("heading", { name: "Akses brankas luring" })).toBeVisible();
    await expect(page.getByText("Mode baca-saja")).toBeVisible();

    const marker = await page.evaluate(
      async () =>
        new Promise<string | undefined>((resolve, reject) => {
          const request = indexedDB.open("pwa-activation-preservation", 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const transaction = request.result.transaction("marker", "readonly");
            const get = transaction.objectStore("marker").get("state");
            get.onsuccess = () => {
              request.result.close();
              resolve(get.result as string | undefined);
            };
            get.onerror = () => reject(get.error);
          };
        }),
    );
    expect(marker).toBe("preserved");

    test.info().annotations.push({
      type: "capability",
      description: `${browserName}: Vault Unlock Secret is the baseline; WebAuthn PRF Remembered Browser requires platform capability and real-device Safari verification.`,
    });
  });

  test("refreshes and boots the public offline shell in the selected English locale", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "The locale-specific cache refresh is covered once in Chromium.");
    await page.goto("/offline");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.getByRole("button", { name: "Pilih bahasa" }).click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await page.getByRole("button", { name: "Ganti bahasa" }).click();
    await expect(page.getByRole("button", { name: "Choose language" })).toContainText("Language");
    await expect(page.getByRole("button", { name: "Choose language" })).toHaveAttribute(
      "title",
      "Current language: English",
    );
    await expect(page.getByRole("heading", { name: "Offline vault access" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect
      .poll(() => page.evaluate(async () => (await caches.match("/offline"))?.text()))
      .toContain("Offline vault access");

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Offline vault access" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("unlocks ciphertext offline, generates OTPs, retains stale data on failures, and reconciles revocation only after complete success", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "Full encrypted flow is covered in Chromium; Firefox/WebKit run the PWA and fallback smoke above.",
    );
    test.setTimeout(60_000);
    const initial = await encryptedFixture({ includeViewer: true, synchronizedAt: "2026-01-01T00:00:00.000Z" });
    const reconciled = await encryptedFixture({ includeViewer: false, synchronizedAt: "2026-01-02T00:00:00.000Z" });

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/offline");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await seedBundle(page, initial.bundle);
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Profil lokal anonim" })).toContainText("Snapshot 1");

    await context.setOffline(true);
    await page.reload();
    await page.getByRole("textbox", { name: "Passphrase Brankas" }).fill(initial.secret);
    await page.getByRole("button", { name: "Buka dengan Passphrase Brankas" }).click();
    await expect(page.getByRole("heading", { name: "Akun autentikator luring" })).toBeVisible({ timeout: 20_000 });
    const copiedCodes: string[] = [];
    for (const account of initial.accounts) {
      await expect(page.getByText(account.accountName)).toBeVisible();
      const copy = page.getByRole("button", { name: `Salin OTP untuk ${account.accountName}, ${account.issuer}` });
      await copy.click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^\d{6}$/);
      copiedCodes.push(await page.evaluate(() => navigator.clipboard.readText()));
    }
    await expect(page.getByText(/pemeriksaan drift dan audit akses tidak tersedia/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Tambah akun/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Kelola/ })).toHaveCount(0);

    const persisted = await storedBundleText(page);
    for (const plaintext of [
      ...initial.accounts.flatMap((account) => [account.issuer, account.accountName, account.secretBase64]),
      ...initial.vaultNames,
      ...initial.sensitiveValues,
      ...copiedCodes,
    ]) {
      expect(persisted).not.toContain(plaintext);
    }

    await page.route("**/api/sync/offline-bundle", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "unauthenticated" }),
      }),
    );
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("status").filter({ hasText: "Autentikasi diperlukan" })).toBeVisible();
    await expect(page.getByText("Viewer User", { exact: true })).toBeVisible();

    await context.setOffline(true);
    await page.unroute("**/api/sync/offline-bundle");
    await page.route("**/api/sync/offline-bundle", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 999 }) }),
    );
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("status").filter({ hasText: "Sinkronisasi gagal atau usang" })).toBeVisible();
    await expect(page.getByText("Viewer User", { exact: true })).toBeVisible();

    await context.setOffline(true);
    await page.unroute("**/api/sync/offline-bundle");
    await page.route("**/api/sync/offline-bundle", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reconciled.bundle) }),
    );
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("status").filter({ hasText: "Daring dan terkini" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Viewer User", { exact: true })).toHaveCount(0);
    expect(await storedBundleText(page)).toContain("2026-01-02T00:00:00.000Z");

    await page.getByRole("button", { name: "Kunci" }).click();
    await expect(page.getByRole("heading", { name: "Akses brankas luring" })).toBeVisible();
    await expect(page.getByText("Personal User", { exact: true })).toHaveCount(0);
  });
});

type FixtureAccount = { issuer: string; accountName: string; secretBase64: string };
type FixtureBundle = {
  bundle: Record<string, unknown>;
  secret: string;
  accounts: FixtureAccount[];
  vaultNames: string[];
  sensitiveValues: string[];
};

async function encryptedFixture({
  includeViewer,
  synchronizedAt,
}: {
  includeViewer: boolean;
  synchronizedAt: string;
}): Promise<FixtureBundle> {
  const secret = "correct horse battery staple";
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
  const unlockKey = await argon2id({
    password: secret,
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 64 * 1024,
    hashLength: 32,
    outputType: "binary",
  });
  if (typeof unlockKey === "string") throw new Error("Expected binary Argon2id output.");
  const userRootKey = Uint8Array.from({ length: 32 }, (_, index) => 31 - index);
  const personalKey = Uint8Array.from({ length: 32 }, (_, index) => 90 + index);
  const ownerKey = Uint8Array.from({ length: 32 }, (_, index) => 130 + index);
  const viewerKey = Uint8Array.from({ length: 32 }, (_, index) => 170 + index);
  const encrypted = (
    key: Uint8Array,
    plaintext: Uint8Array,
    context: Parameters<typeof encryptPayloadWithContext>[2],
  ) => encryptEnvelope(key, plaintext, context);
  const account = async (vaultId: string, id: string, issuer: string, accountName: string, key: Uint8Array) => {
    const secretBytes = Uint8Array.from({ length: 20 }, (_, index) => index + id.length);
    const configuration = {
      issuer,
      accountName,
      secret: base64(secretBytes),
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
    };
    return {
      record: {
        id,
        encryptedPayload: base64(
          await encrypted(key, new TextEncoder().encode(JSON.stringify(configuration)), {
            purpose: "authenticator-account",
            payloadType: "totp-configuration",
            vaultId,
            keyVersion: 1,
          }),
        ),
        encryptionVersion: 1,
        revision: 1,
      },
      fixture: { issuer, accountName, secretBase64: configuration.secret },
    };
  };
  const personalAccount = await account(
    "personal_vault",
    "personal_account",
    "Personal Issuer",
    "Personal User",
    personalKey,
  );
  const ownerAccount = await account("owner_vault", "owner_account", "Owner Issuer", "Owner User", ownerKey);
  const viewerAccount = await account("viewer_vault", "viewer_account", "Viewer Issuer", "Viewer User", viewerKey);
  const sharedVault = async (
    vaultId: string,
    name: string,
    role: "OWNER" | "VIEWER",
    key: Uint8Array,
    record: Record<string, unknown>,
  ) => ({
    vaultId,
    lifecycle: "ACTIVE",
    role,
    encryptedName: base64(
      await encrypted(key, new TextEncoder().encode(name), {
        purpose: "vault-name",
        payloadType: "vault-name",
        vaultId,
        keyVersion: 1,
      }),
    ),
    encryptionVersion: 1,
    encryptedVaultKey: base64(
      await encrypted(userRootKey, key, {
        purpose: "vault-key-wrap",
        payloadType: "vault-encryption-key",
        vaultId,
        keyVersion: 1,
      }),
    ),
    keyVersion: 1,
    accounts: [record],
  });
  const sharedVaults = [await sharedVault("owner_vault", "Owner Vault", "OWNER", ownerKey, ownerAccount.record)];
  if (includeViewer)
    sharedVaults.push(await sharedVault("viewer_vault", "Viewer Vault", "VIEWER", viewerKey, viewerAccount.record));
  const bundle = {
    schemaVersion: 1,
    profileId: "profile_fixture",
    synchronizedAt,
    synchronizationToken: synchronizedAt,
    cryptoProfile: {
      vaultUnlockSalt: base64(salt),
      wrappedUserRootKey: base64(
        await encrypted(unlockKey, userRootKey, {
          purpose: "user-root-key-wrap",
          payloadType: "user-root-key",
          keyVersion: 1,
        }),
      ),
      encryptedPersonalVaultKey: base64(
        await encrypted(userRootKey, personalKey, {
          purpose: "vault-key-wrap",
          payloadType: "vault-encryption-key",
          keyVersion: 1,
        }),
      ),
      encryptionVersion: 1,
    },
    personalVault: {
      vaultId: "personal_vault",
      lifecycle: "ACTIVE",
      encryptedName: base64(
        await encrypted(personalKey, new TextEncoder().encode("Personal Vault"), {
          purpose: "vault-name",
          payloadType: "vault-name",
          keyVersion: 1,
        }),
      ),
      encryptionVersion: 1,
      accounts: [personalAccount.record],
    },
    sharedVaults,
  };
  unlockKey.fill(0);
  return {
    bundle,
    secret,
    accounts: includeViewer
      ? [personalAccount.fixture, ownerAccount.fixture, viewerAccount.fixture]
      : [personalAccount.fixture, ownerAccount.fixture],
    vaultNames: includeViewer ? ["Personal Vault", "Owner Vault", "Viewer Vault"] : ["Personal Vault", "Owner Vault"],
    sensitiveValues: [secret, base64(userRootKey), base64(personalKey), base64(ownerKey), base64(viewerKey)],
  };
}

async function encryptEnvelope(
  keyBytes: Uint8Array,
  plaintext: Uint8Array,
  context: Parameters<typeof encryptPayloadWithContext>[2],
): Promise<Uint8Array> {
  return serializeEncryptedEnvelope(await encryptPayloadWithContext(keyBytes, plaintext, context));
}

async function seedBundle(page: import("@playwright/test").Page, bundle: Record<string, unknown>) {
  await page.evaluate(
    async (value) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("rhasia-scret-offline-vault", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("encrypted-snapshots"))
            request.result.createObjectStore("encrypted-snapshots", { keyPath: "profileId" });
          if (!request.result.objectStoreNames.contains("remembered-browsers"))
            request.result.createObjectStore("remembered-browsers", { keyPath: "profileId" });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction("encrypted-snapshots", "readwrite");
          transaction.objectStore("encrypted-snapshots").put(value);
          transaction.oncomplete = () => {
            request.result.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    bundle,
  );
}

async function storedBundleText(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(
    async () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open("rhasia-scret-offline-vault", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction("encrypted-snapshots", "readonly");
          const all = transaction.objectStore("encrypted-snapshots").getAll();
          all.onsuccess = () => {
            request.result.close();
            resolve(JSON.stringify(all.result));
          };
          all.onerror = () => reject(all.error);
        };
      }),
  );
}

function base64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}
