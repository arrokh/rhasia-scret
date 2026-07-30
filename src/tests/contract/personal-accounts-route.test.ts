import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createPersonalAccountsHandlers } from "@/app/api/vaults/[vaultId]/accounts/route";
import { ApplicationUser } from "@/modules/identity/domain/application-user";
import { FakeSessionVerifier } from "@/modules/identity/infrastructure/fake-session-verifier";
import { EncryptedAuthenticatorAccount } from "@/modules/authenticator-account";

const payload = { encryptedPayload: Buffer.from("encrypted-account-payload").toString("base64"), encryptionVersion: 1 };

describe("Personal Vault accounts API", () => {
  it("creates only opaque encrypted content for an active owner", async () => {
    const create = vi.fn().mockResolvedValue(new EncryptedAuthenticatorAccount("account-1", "vault-1", new Uint8Array([1, 2, 3]), 1, 1));
    const handlers = createPersonalAccountsHandlers({
      sessionVerifier: new FakeSessionVerifier({ subject: "supabase-1", email: "person@example.test" }),
      applicationUsers: { provision: async () => new ApplicationUser("user-1", "supabase", "supabase-1", "person@example.test", "ACTIVE") },
      accounts: { create, list: async () => [], update: vi.fn(), delete: vi.fn(), restore: vi.fn() }
    });
    const response = await handlers.POST(new NextRequest("http://localhost/api/vaults/vault-1/accounts", { method: "POST", body: JSON.stringify(payload) }), { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith("user-1", "vault-1", expect.objectContaining({ encryptionVersion: 1, source: undefined }));
  });

  it("accepts only the redacted Local Vault copy source marker", async () => {
    const create = vi.fn().mockResolvedValue(new EncryptedAuthenticatorAccount("account-1", "vault-1", new Uint8Array([1, 2, 3]), 1, 1));
    const handlers = createPersonalAccountsHandlers({
      sessionVerifier: new FakeSessionVerifier({ subject: "supabase-1", email: "person@example.test" }),
      applicationUsers: { provision: async () => new ApplicationUser("user-1", "supabase", "supabase-1", "person@example.test", "ACTIVE") },
      accounts: { create, list: async () => [], update: vi.fn(), delete: vi.fn(), restore: vi.fn() }
    });
    const context = { params: Promise.resolve({ vaultId: "vault-1" }) };
    const accepted = await handlers.POST(new NextRequest("http://localhost/api", { method: "POST", body: JSON.stringify({ ...payload, source: "LOCAL_VAULT_COPY" }) }), context);
    const rejected = await handlers.POST(new NextRequest("http://localhost/api", { method: "POST", body: JSON.stringify({ ...payload, source: "local-profile-secret" }) }), context);

    expect(accepted.status).toBe(201);
    expect(create).toHaveBeenCalledWith("user-1", "vault-1", expect.objectContaining({ source: "LOCAL_VAULT_COPY" }));
    expect(rejected.status).toBe(400);
  });

  it("updates, deletes, and restores opaque content with Account Revision protection", async () => {
    const update = vi.fn().mockResolvedValue(new EncryptedAuthenticatorAccount("account-1", "vault-1", new Uint8Array([1, 2, 3]), 1, 3));
    const remove = vi.fn().mockResolvedValue(true);
    const restore = vi.fn().mockResolvedValue(true);
    const handlers = createPersonalAccountsHandlers({
      sessionVerifier: new FakeSessionVerifier({ subject: "supabase-1", email: "person@example.test" }),
      applicationUsers: { provision: async () => new ApplicationUser("user-1", "supabase", "supabase-1", "person@example.test", "ACTIVE") },
      accounts: { create: vi.fn(), list: vi.fn(), update, delete: remove, restore }
    });
    const context = { params: Promise.resolve({ vaultId: "vault-1" }) };
    const updated = await handlers.PATCH(new NextRequest("http://localhost/api/vaults/vault-1/accounts", {
      method: "PATCH",
      body: JSON.stringify({ ...payload, accountId: "account-1", expectedRevision: 2 })
    }), context);
    const deleted = await handlers.DELETE(new NextRequest("http://localhost/api/vaults/vault-1/accounts", {
      method: "DELETE",
      body: JSON.stringify({ accountId: "account-1", expectedRevision: 3 })
    }), context);
    const restored = await handlers.PUT(new NextRequest("http://localhost/api/vaults/vault-1/accounts", {
      method: "PUT",
      body: JSON.stringify({ accountId: "account-1" })
    }), context);

    expect(updated.status).toBe(200);
    expect(update).toHaveBeenCalledWith("user-1", "vault-1", "account-1", 2, expect.objectContaining({ encryptionVersion: 1 }));
    expect(deleted.status).toBe(204);
    expect(remove).toHaveBeenCalledWith("user-1", "vault-1", "account-1", 3);
    expect(restored.status).toBe(204);
    expect(restore).toHaveBeenCalledWith("user-1", "vault-1", "account-1");
  });

  it("does not list accounts for an unauthenticated caller", async () => {
    const handlers = createPersonalAccountsHandlers({
      sessionVerifier: new FakeSessionVerifier(null),
      applicationUsers: { provision: async () => { throw new Error("must not provision"); } },
      accounts: { create: async () => { throw new Error("must not create"); }, list: async () => { throw new Error("must not list"); }, update: vi.fn(), delete: vi.fn(), restore: vi.fn() }
    });
    const response = await handlers.GET(new NextRequest("http://localhost/api/vaults/vault-1/accounts"), { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(response.status).toBe(401);
  });
});
