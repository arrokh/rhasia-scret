import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { ApiRequest, ApiResponse } from "@api/http/api-request";
import { createOfflineSyncBundleHandler } from "@api/route-handlers/sync/offline-bundle/route";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";
import type { EncryptedOfflineVaultBundle } from "@rhasia-scret/client-vault-core/modules/sync/domain/offline-vault-bundle";

const ciphertext = Buffer.alloc(32, 7).toString("base64");
const bundle: EncryptedOfflineVaultBundle = {
  schemaVersion: 2,
  profileId: "user_1",
  synchronizedAt: "2026-01-01T00:00:00.000Z",
  synchronizationToken: "sync_1",
  cryptoProfile: {
    vaultUnlockSalt: Buffer.alloc(16, 1).toString("base64"),
    wrappedUserRootKey: ciphertext,
    encryptedPersonalVaultKey: ciphertext,
    encryptionVersion: 1,
  },
  personalVault: {
    vaultId: "personal_1",
    lifecycle: "ACTIVE",
    encryptedName: ciphertext,
    encryptionVersion: 1,
    accounts: [{ id: "account_1", encryptedPayload: ciphertext, encryptionVersion: 1, revision: 1 }],
  },
  sharedVaults: [
    {
      vaultId: "owner_vault",
      lifecycle: "ACTIVE",
      role: "OWNER",
      effectiveAccountPermissions: {
        permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true },
        sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" },
      },
      encryptedName: ciphertext,
      encryptionVersion: 1,
      encryptedVaultKey: ciphertext,
      keyVersion: 1,
      accounts: [],
    },
    {
      vaultId: "viewer_vault",
      lifecycle: "ACTIVE",
      role: "VIEWER",
      effectiveAccountPermissions: {
        permissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false },
        sources: { canAddAccounts: "VAULT", canEditAccounts: "VAULT", canDeleteAccounts: "VAULT" },
      },
      encryptedName: ciphertext,
      encryptionVersion: 1,
      encryptedVaultKey: ciphertext,
      keyVersion: 2,
      accounts: [],
    },
  ],
};
const user = new ApplicationUser("user_1", "rhasia:passwordless", "local-1", "person@example.test", "ACTIVE");
const request = (headers?: Record<string, string>) =>
  new ApiRequest("https://api.example.test/v1/sync/offline-bundle", { headers });

describe("GET /v1/sync/offline-bundle contract", () => {
  it("returns one no-store ciphertext-only bundle with synchronization metadata", async () => {
    const readAuthorizedBundle = vi.fn().mockResolvedValue(bundle);
    const handler = createOfflineSyncBundleHandler({
      authenticate: async () => user,
      bundles: { readAuthorizedBundle },
    });

    const response = await handler(request());
    const body = (await response.json()) as EncryptedOfflineVaultBundle;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("etag")).toBe('"sync_1"');
    expect(response.headers.get("x-synchronized-at")).toBe(bundle.synchronizedAt);
    expect(readAuthorizedBundle).toHaveBeenCalledWith("user_1");
    expect(body.sharedVaults.map((vault: { role: string }) => vault.role)).toEqual(["OWNER", "VIEWER"]);
    expect(JSON.stringify(body)).not.toContain("person@example.test");
    expect(body).not.toHaveProperty("encryptedUserPrivateKey");
  });

  it("revalidates authorization and returns no ciphertext when the snapshot is unchanged", async () => {
    const readAuthorizedBundle = vi.fn().mockResolvedValue(bundle);
    const handler = createOfflineSyncBundleHandler({
      authenticate: async () => user,
      bundles: { readAuthorizedBundle },
    });

    const response = await handler(request({ "if-none-match": '"sync_1"' }));

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("x-synchronized-at")).toBe(bundle.synchronizedAt);
    expect(readAuthorizedBundle).toHaveBeenCalledWith("user_1");
  });

  it("fails closed for missing authentication and never reads Vault data", async () => {
    const readAuthorizedBundle = vi.fn();
    const handler = createOfflineSyncBundleHandler({
      authenticate: async () => ApiResponse.json({ error: "unauthenticated" }, { status: 401 }),
      bundles: { readAuthorizedBundle },
    });

    expect((await handler(request())).status).toBe(401);
    expect(readAuthorizedBundle).not.toHaveBeenCalled();
  });

  it("reports an initialized-profile miss without returning a partial response", async () => {
    const handler = createOfflineSyncBundleHandler({
      authenticate: async () => user,
      bundles: { readAuthorizedBundle: async () => null },
    });

    expect((await handler(request())).status).toBe(404);
  });
});
