import { describe, expect, it, vi } from "vitest";
import { ApiRequest, ApiResponse } from "@api/http/api-request";
import { createRenameSharedVaultHandler } from "@api/route-handlers/shared-vaults/[vaultId]/route";
import { createListSharedVaultsHandler, createSharedVaultHandler } from "@api/route-handlers/shared-vaults/route";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";
import { Vault } from "@api/modules/vault-management/domain/vault";

const payload = {
  encryptedName: btoa("encrypted-shared-vault-name"),
  encryptedOwnerVaultKey: btoa("encrypted-owner-vault-key"),
  encryptionVersion: 1,
};
const user = new ApplicationUser("user-1", "rhasia:passwordless", "local-1", "person@example.test", "ACTIVE");

const request = (url: string, init?: RequestInit) => new ApiRequest(`https://api.example.test${url}`, init);

describe("Shared Vault route contracts", () => {
  it("returns only encrypted Shared Vault access material", async () => {
    const listForMember = vi.fn().mockResolvedValue([
      {
        vaultId: "vault-1",
        role: "OWNER",
        effectiveAccountPermissions: {
          permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true },
          sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" },
        },
        encryptedName: Uint8Array.from([1, 2, 3]),
        encryptionVersion: 1,
        encryptedVaultKey: Uint8Array.from([4, 5, 6]),
        keyVersion: 1,
        accounts: [
          { id: "account-1", encryptedPayload: Uint8Array.from([7, 8, 9]), encryptionVersion: 1, revision: 2 },
        ],
      },
    ]);
    const handler = createListSharedVaultsHandler({
      authenticate: async () => user,
      sharedVaultAccess: { getForMember: vi.fn(), listForMember },
    });

    const response = await handler(request("/v1/shared-vaults"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        vaultId: "vault-1",
        role: "OWNER",
        effectiveAccountPermissions: {
          permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true },
          sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" },
        },
        encryptedName: "AQID",
        encryptionVersion: 1,
        encryptedVaultKey: "BAUG",
        keyVersion: 1,
        accounts: [{ id: "account-1", encryptedPayload: "BwgJ", encryptionVersion: 1, revision: 2 }],
      },
    ]);
    expect(listForMember).toHaveBeenCalledWith("user-1");
  });

  it("lets an owner replace only the encrypted Vault Name", async () => {
    const rename = vi.fn().mockResolvedValue(true);
    const handler = createRenameSharedVaultHandler({
      authenticate: async () => user,
      sharedVaults: { create: vi.fn(), rename },
    });
    const encryptedName = btoa("encrypted-renamed-vault");

    const response = await handler(
      request("/v1/shared-vaults/vault-1", {
        method: "PATCH",
        body: JSON.stringify({ encryptedName, encryptionVersion: 1 }),
      }),
      { params: Promise.resolve({ vaultId: "vault-1" }) },
    );

    expect(response.status).toBe(204);
    expect(rename).toHaveBeenCalledWith("user-1", "vault-1", expect.any(Uint8Array), 1);
    expect(Buffer.from(rename.mock.calls[0][2]).toString("utf8")).toBe("encrypted-renamed-vault");
  });

  it("authenticates before validation and preserves rate-limit errors", async () => {
    const create = vi.fn();
    const unauthenticated = createSharedVaultHandler({
      authenticate: async () => ApiResponse.json({ error: "unauthenticated" }, { status: 401 }),
      sharedVaults: { create, rename: vi.fn() },
    });
    const limited = createSharedVaultHandler({
      authenticate: async () =>
        ApiResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "20" } }),
      sharedVaults: { create, rename: vi.fn() },
    });

    const rejected = await unauthenticated(request("/v1/shared-vaults", { method: "POST", body: "invalid" }));
    const throttled = await limited(request("/v1/shared-vaults", { method: "POST", body: "invalid" }));

    expect(rejected.status).toBe(401);
    expect(throttled.status).toBe(429);
    await expect(throttled.json()).resolves.toEqual({ error: "rate_limited" });
    expect(throttled.headers.get("retry-after")).toBe("20");
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a Shared Vault from opaque owner material", async () => {
    const create = vi.fn().mockResolvedValue(new Vault("vault-1", "SHARED", "user-1"));
    const handler = createSharedVaultHandler({
      authenticate: async () => user,
      sharedVaults: { create, rename: vi.fn() },
    });

    const response = await handler(request("/v1/shared-vaults", { method: "POST", body: JSON.stringify(payload) }));

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        encryptionVersion: 1,
        encryptedName: expect.any(Uint8Array),
        encryptedOwnerVaultKey: expect.any(Uint8Array),
      }),
    );
  });
});
