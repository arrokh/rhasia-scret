import { describe, expect, it, vi } from "vitest";
import { ApiRequest, ApiResponse } from "@api/http/api-request";
import { createPersonalAccountsHandlers } from "@api/route-handlers/vaults/[vaultId]/accounts/route";
import { ApplicationUser } from "@api/modules/identity/domain/application-user";
import { EncryptedAuthenticatorAccount } from "@api/modules/authenticator-account/domain/encrypted-account";

const payload = { encryptedPayload: btoa("encrypted-account-payload"), encryptionVersion: 1 as const };
const user = new ApplicationUser("user-1", "rhasia:passwordless", "local-1", "person@example.test", "ACTIVE");
const request = (url: string, init?: RequestInit) => new ApiRequest(`https://api.example.test${url}`, init);

function authenticationDependencies() {
  return {
    authenticateReader: async () => user,
    authenticateMutation: async () => user,
  };
}

describe("Personal Vault account route contracts", () => {
  it("creates only opaque encrypted content for an active owner", async () => {
    const create = vi
      .fn()
      .mockResolvedValue(new EncryptedAuthenticatorAccount("account-1", "vault-1", new Uint8Array([1, 2, 3]), 1, 1));
    const handlers = createPersonalAccountsHandlers({
      ...authenticationDependencies(),
      accounts: { create, list: async () => [], update: vi.fn(), delete: vi.fn(), restore: vi.fn() },
    });

    const response = await handlers.POST(
      request("/v1/vaults/vault-1/accounts", { method: "POST", body: JSON.stringify(payload) }),
      { params: Promise.resolve({ vaultId: "vault-1" }) },
    );

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      "user-1",
      "vault-1",
      expect.objectContaining({ encryptionVersion: 1, source: undefined }),
    );
  });

  it("accepts only the redacted Local Vault copy source marker", async () => {
    const create = vi
      .fn()
      .mockResolvedValue(new EncryptedAuthenticatorAccount("account-1", "vault-1", new Uint8Array([1, 2, 3]), 1, 1));
    const handlers = createPersonalAccountsHandlers({
      ...authenticationDependencies(),
      accounts: { create, list: async () => [], update: vi.fn(), delete: vi.fn(), restore: vi.fn() },
    });
    const context = { params: Promise.resolve({ vaultId: "vault-1" }) };

    const accepted = await handlers.POST(
      request("/v1/vaults/vault-1/accounts", {
        method: "POST",
        body: JSON.stringify({ ...payload, source: "LOCAL_VAULT_COPY" }),
      }),
      context,
    );
    const rejected = await handlers.POST(
      request("/v1/vaults/vault-1/accounts", {
        method: "POST",
        body: JSON.stringify({ ...payload, source: "local-profile-secret" }),
      }),
      context,
    );

    expect(accepted.status).toBe(201);
    expect(create).toHaveBeenCalledWith("user-1", "vault-1", expect.objectContaining({ source: "LOCAL_VAULT_COPY" }));
    expect(rejected.status).toBe(400);
  });

  it("updates, deletes, and restores opaque content with Account Revision protection", async () => {
    const update = vi
      .fn()
      .mockResolvedValue(new EncryptedAuthenticatorAccount("account-1", "vault-1", new Uint8Array([1, 2, 3]), 1, 3));
    const remove = vi.fn().mockResolvedValue(true);
    const restore = vi.fn().mockResolvedValue(true);
    const handlers = createPersonalAccountsHandlers({
      ...authenticationDependencies(),
      accounts: { create: vi.fn(), list: vi.fn(), update, delete: remove, restore },
    });
    const context = { params: Promise.resolve({ vaultId: "vault-1" }) };

    const updated = await handlers.PATCH(
      request("/v1/vaults/vault-1/accounts", {
        method: "PATCH",
        body: JSON.stringify({ ...payload, accountId: "account-1", expectedRevision: 2 }),
      }),
      context,
    );
    const deleted = await handlers.DELETE(
      request("/v1/vaults/vault-1/accounts", {
        method: "DELETE",
        body: JSON.stringify({ accountId: "account-1", expectedRevision: 3 }),
      }),
      context,
    );
    const restored = await handlers.PUT(
      request("/v1/vaults/vault-1/accounts", {
        method: "PUT",
        body: JSON.stringify({ accountId: "account-1" }),
      }),
      context,
    );

    expect(updated.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      "user-1",
      "vault-1",
      "account-1",
      2,
      expect.objectContaining({ encryptionVersion: 1 }),
    );
    expect(deleted.status).toBe(204);
    expect(remove).toHaveBeenCalledWith("user-1", "vault-1", "account-1", 3);
    expect(restored.status).toBe(204);
    expect(restore).toHaveBeenCalledWith("user-1", "vault-1", "account-1");
  });

  it("does not list accounts for an unauthenticated caller", async () => {
    const handlers = createPersonalAccountsHandlers({
      authenticateReader: async () => ApiResponse.json({ error: "unauthenticated" }, { status: 401 }),
      authenticateMutation: async () => ApiResponse.json({ error: "unauthenticated" }, { status: 401 }),
      accounts: {
        create: async () => {
          throw new Error("must not create");
        },
        list: async () => {
          throw new Error("must not list");
        },
        update: vi.fn(),
        delete: vi.fn(),
        restore: vi.fn(),
      },
    });

    const response = await handlers.GET(request("/v1/vaults/vault-1/accounts"), {
      params: Promise.resolve({ vaultId: "vault-1" }),
    });
    expect(response.status).toBe(401);
  });
});
