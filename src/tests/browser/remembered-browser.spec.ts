import { expect, test, type Page } from "@playwright/test";
import { argon2id } from "hash-wasm";
import { encryptPayloadWithContext, serializeEncryptedEnvelope, type CryptoEnvelopeContext } from "@/modules/crypto/infrastructure/browser-crypto-envelope";

const profileId = "remembered-preview-profile";
const personalVaultId = "remembered-preview-vault";
const vaultUnlockSecret = "remembered browser fallback words";
const userRootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 11);
const personalVaultKey = Uint8Array.from({ length: 32 }, (_, index) => index + 51);
const prfOutput = Uint8Array.from({ length: 32 }, (_, index) => index + 91);

test.describe("production Remembered Browser UI", () => {
  test.beforeEach(async ({ page }) => {
    await installMockLocalVerification(page);
    await page.route("**/api/passkey-recovery/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enrolled: false }) }));
  });

  test("enrolls explicitly with required user verification, stores ciphertext only, and removes local material", async ({ page }) => {
    const emitted: string[] = [];
    page.on("request", (request) => emitted.push(`${request.url()} ${request.postData() ?? ""}`));
    page.on("console", (message) => emitted.push(message.text()));
    await page.goto("/ui-preview/remembered-browser");
    const enrollment = page.locator("div.border-t").filter({ has: page.getByRole("heading", { name: "Browser yang Diingat", exact: true }) });
    await expect(enrollment).toHaveClass(/justify-items-center/);
    await page.getByRole("button", { name: "Ingat browser ini" }).click();
    await expect(page.getByText("Browser ini dapat memakai Verifikasi Lokal")).toBeVisible();
    await expect(enrollment).not.toHaveClass(/justify-items-center/);

    const state = await rememberedState(page);
    expect(state.packageText).toContain(profileId);
    for (const sensitive of [base64(userRootKey), base64(personalVaultKey), vaultUnlockSecret]) {
      expect(state.allPersistentText).not.toContain(sensitive);
      expect(emitted.join("\n")).not.toContain(sensitive);
    }
    const calls = await page.evaluate(() => (window as unknown as { __webauthnCalls: Array<{ operation: string; options: PublicKeyCredentialCreationOptions | PublicKeyCredentialRequestOptions }> }).__webauthnCalls);
    expect((calls.find(({ operation }) => operation === "create")?.options as PublicKeyCredentialCreationOptions).authenticatorSelection?.userVerification).toBe("required");
    expect((calls.find(({ operation }) => operation === "get")?.options as PublicKeyCredentialRequestOptions).userVerification).toBe("required");

    await page.getByRole("button", { name: "Lupakan browser ini" }).click();
    await expect(page.getByText("Paket Browser yang Diingat telah dihapus")).toBeVisible();
    expect((await rememberedState(page)).packageText).toBe("[]");
  });

  test("does not enroll after cancellation and keeps the Vault Unlock Secret fallback", async ({ page }) => {
    await page.goto("/ui-preview/remembered-browser");
    await page.evaluate(() => { (window as unknown as { __webauthnMode: string }).__webauthnMode = "cancel-create"; });
    await page.getByRole("button", { name: "Ingat browser ini" }).click();
    await expect(page.getByText("Enrollment Browser yang Diingat dibatalkan")).toBeVisible();
    expect((await rememberedState(page)).packageText).toBe("[]");
    await expect(page.getByRole("textbox", { name: "Passphrase Brankas" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Buka Brankas" })).toBeVisible();
  });

  test("a copied browser record or credential identifier cannot unlock until PRF verification succeeds", async ({ page }) => {
    const bundle = await encryptedBundle();
    await page.route("**/api/sync/offline-bundle", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bundle) }));
    await page.goto("/ui-preview/remembered-browser");
    await page.getByRole("button", { name: "Ingat browser ini" }).click();
    await seedSnapshot(page, bundle);
    const persisted = await rememberedState(page);
    for (const sensitive of [base64(userRootKey), base64(personalVaultKey), vaultUnlockSecret]) expect(persisted.allPersistentText).not.toContain(sensitive);
    await page.reload();
    await expect(page.getByRole("button", { name: "Buka dengan Verifikasi Lokal" })).toBeVisible();

    await page.evaluate(() => { (window as unknown as { __webauthnMode: string }).__webauthnMode = "missing-prf"; });
    await page.getByRole("button", { name: "Buka dengan Verifikasi Lokal" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "tidak ada kunci yang dilepas tanpa verifikasi" })).toBeVisible();
    await expect(page.getByText("Unlocked Vault Session berhasil dibuat.")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Passphrase Brankas" })).toBeVisible();

    await page.evaluate(() => { (window as unknown as { __webauthnMode: string }).__webauthnMode = "valid"; });
    await page.getByRole("button", { name: "Buka dengan Verifikasi Lokal" }).click();
    await expect(page.getByText("Unlocked Vault Session berhasil dibuat.")).toBeVisible();
  });

  test("falls back to the Vault Unlock Secret when Local Verification is unsupported", async ({ page }) => {
    const bundle = await encryptedBundle();
    await page.route("**/api/sync/offline-bundle", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bundle) }));
    await page.goto("/ui-preview/remembered-browser");
    await page.evaluate(() => {
      Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: undefined });
    });
    await page.getByRole("button", { name: "Ingat browser ini" }).click();
    await expect(page.getByText("tidak mendukung perlindungan PRF")).toBeVisible();
    await page.getByRole("textbox", { name: "Passphrase Brankas" }).fill(vaultUnlockSecret);
    await page.getByRole("button", { name: "Buka Brankas" }).click();
    await expect(page.getByText("Unlocked Vault Session berhasil dibuat.")).toBeVisible({ timeout: 30_000 });
  });
});

async function installMockLocalVerification(page: Page) {
  await page.addInitScript(({ output }) => {
    const prf = Uint8Array.from(output);
    class FakeCredential {
      rawId = Uint8Array.of(1, 2, 3, 4).buffer;
      getClientExtensionResults() {
        const mode = (window as unknown as { __webauthnMode: string }).__webauthnMode;
        return mode === "missing-prf" ? {} : { prf: { results: { first: prf.slice().buffer } } };
      }
    }
    const calls: Array<{ operation: string; options: unknown }> = [];
    Object.assign(window, { __webauthnMode: "valid", __webauthnCalls: calls });
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: FakeCredential });
    Object.defineProperty(navigator, "credentials", { configurable: true, value: {
      create: async ({ publicKey }: { publicKey: unknown }) => {
        calls.push({ operation: "create", options: publicKey });
        return (window as unknown as { __webauthnMode: string }).__webauthnMode === "cancel-create" ? null : new FakeCredential();
      },
      get: async ({ publicKey }: { publicKey: unknown }) => {
        calls.push({ operation: "get", options: publicKey });
        if ((window as unknown as { __webauthnMode: string }).__webauthnMode === "invalid-credential") throw new DOMException("Invalid credential", "NotAllowedError");
        return new FakeCredential();
      }
    } });
  }, { output: [...prfOutput] });
}

async function encryptedBundle(): Promise<Record<string, unknown>> {
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
  const derived = await argon2id({ password: vaultUnlockSecret, salt, parallelism: 1, iterations: 3, memorySize: 64 * 1024, hashLength: 32, outputType: "binary" });
  if (typeof derived === "string") throw new Error("Expected binary Argon2 output.");
  return {
    schemaVersion: 2,
    profileId,
    synchronizedAt: "2026-01-01T00:00:00.000Z",
    synchronizationToken: "remembered-browser-sync",
    cryptoProfile: {
      vaultUnlockSalt: base64(salt),
      wrappedUserRootKey: base64(await envelope(derived, userRootKey, { purpose: "user-root-key-wrap", payloadType: "user-root-key", keyVersion: 1 })),
      encryptedPersonalVaultKey: base64(await envelope(userRootKey, personalVaultKey, { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", keyVersion: 1 })),
      encryptionVersion: 1
    },
    personalVault: {
      vaultId: personalVaultId,
      lifecycle: "ACTIVE",
      encryptedName: base64(await envelope(personalVaultKey, new TextEncoder().encode("Remembered Preview Vault"), { purpose: "vault-name", payloadType: "vault-name", keyVersion: 1 })),
      encryptionVersion: 1,
      accounts: []
    },
    sharedVaults: []
  };
}

async function envelope(keyBytes: Uint8Array, plaintext: Uint8Array, context: CryptoEnvelopeContext): Promise<Uint8Array> {
  return serializeEncryptedEnvelope(await encryptPayloadWithContext(keyBytes, plaintext, context));
}

async function seedSnapshot(page: Page, bundle: Record<string, unknown>) {
  await page.evaluate(async (value) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("rhasia-scret-offline-vault", 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains("encrypted-snapshots")) open.result.createObjectStore("encrypted-snapshots", { keyPath: "profileId" });
      if (!open.result.objectStoreNames.contains("remembered-browsers")) open.result.createObjectStore("remembered-browsers", { keyPath: "profileId" });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const transaction = open.result.transaction("encrypted-snapshots", "readwrite");
      transaction.objectStore("encrypted-snapshots").put(value);
      transaction.oncomplete = () => { open.result.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }), bundle);
}

async function rememberedState(page: Page): Promise<{ packageText: string; allPersistentText: string }> {
  return page.evaluate(async () => {
    const stored = await new Promise<{ remembered: unknown[]; snapshots: unknown[] }>((resolve, reject) => {
      const open = indexedDB.open("rhasia-scret-offline-vault", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const transaction = open.result.transaction(["remembered-browsers", "encrypted-snapshots"], "readonly");
        const remembered = transaction.objectStore("remembered-browsers").getAll();
        const snapshots = transaction.objectStore("encrypted-snapshots").getAll();
        transaction.oncomplete = () => { open.result.close(); resolve({ remembered: remembered.result as unknown[], snapshots: snapshots.result as unknown[] }); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const packageText = JSON.stringify(stored.remembered);
    return { packageText, allPersistentText: JSON.stringify({ ...stored, local: Object.entries(localStorage), session: Object.entries(sessionStorage) }) };
  });
}

function base64(bytes: Uint8Array): string { return Buffer.from(bytes).toString("base64"); }
