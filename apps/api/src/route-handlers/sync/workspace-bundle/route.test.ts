import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { ApiRequest, ApiResponse } from "@api/http/api-request";
import { createAuthorizedWorkspaceHandler } from "@api/route-handlers/sync/workspace-bundle/route";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";
import type { AuthorizedWorkspaceResponse } from "@rhasia-scret/client-vault-core/modules/sync/domain/offline-vault-bundle";

const ciphertext = Buffer.from([2, ...Array<number>(28).fill(7)]).toString("base64");
const responseBody: AuthorizedWorkspaceResponse = {
  responseVersion: 1,
  workspaceSynchronizationToken: "workspace-sync-1",
  synchronizedAt: "2026-01-01T00:00:00.000Z",
  personalSnapshot: {
    schemaVersion: 3,
    profileId: "user_1",
    synchronizedAt: "2026-01-01T00:00:00.000Z",
    synchronizationToken: "personal-sync-1",
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
  },
  userEncryptionIdentity: {
    publicKey: { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "A".repeat(43), ext: true, key_ops: [] },
    encryptedPrivateKey: ciphertext,
    encryptionVersion: 1,
  },
  sharedVaults: [
    {
      vaultId: "shared_1",
      lifecycle: "ACTIVE",
      role: "VIEWER",
      effectiveAccountPermissions: {
        permissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false },
        sources: { canAddAccounts: "VAULT", canEditAccounts: "VAULT", canDeleteAccounts: "VAULT" },
      },
      encryptedName: ciphertext,
      encryptionVersion: 1,
      encryptedVaultKey: ciphertext,
      keyVersion: 1,
      accounts: [],
    },
  ],
};
const user = new ApplicationUser("user_1", "rhasia:passwordless", "local-1", "person@example.test", "ACTIVE");
const request = (headers?: Record<string, string>) =>
  new ApiRequest("https://api.example.test/v1/sync/workspace-bundle", { headers });

describe("GET /v1/sync/workspace-bundle contract", () => {
  it("returns transient Shared Vault data and a Personal-only snapshot projection", async () => {
    const readAuthorizedWorkspaceResponse = vi.fn().mockResolvedValue(responseBody);
    const handler = createAuthorizedWorkspaceHandler({
      authenticate: async () => user,
      workspace: { readAuthorizedWorkspaceResponse },
    });

    const response = await handler(request());
    const body = (await response.json()) as AuthorizedWorkspaceResponse;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("etag")).toBeNull();
    expect(body.sharedVaults).toHaveLength(1);
    expect(body.userEncryptionIdentity).toEqual(responseBody.userEncryptionIdentity);
    expect(body.personalSnapshot).not.toHaveProperty("sharedVaults");
    expect(body.personalSnapshot).not.toHaveProperty("userEncryptionIdentity");
    expect(readAuthorizedWorkspaceResponse).toHaveBeenCalledWith("user_1");
  });

  it("always returns the full no-store response instead of an unsupported conditional response", async () => {
    const readAuthorizedWorkspaceResponse = vi.fn().mockResolvedValue(responseBody);
    const handler = createAuthorizedWorkspaceHandler({
      authenticate: async () => user,
      workspace: { readAuthorizedWorkspaceResponse },
    });

    const response = await handler(request({ "if-none-match": '"workspace-sync-1"' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(responseBody);
    expect(readAuthorizedWorkspaceResponse).toHaveBeenCalledWith("user_1");
  });

  it("does not read workspace data without authentication", async () => {
    const readAuthorizedWorkspaceResponse = vi.fn();
    const handler = createAuthorizedWorkspaceHandler({
      authenticate: async () => ApiResponse.json({ error: "unauthenticated" }, { status: 401 }),
      workspace: { readAuthorizedWorkspaceResponse },
    });

    expect((await handler(request())).status).toBe(401);
    expect(readAuthorizedWorkspaceResponse).not.toHaveBeenCalled();
  });
});
