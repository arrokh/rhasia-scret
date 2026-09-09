import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("@/modules/identity/application/load-application-user", () => ({
  loadApplicationUser: async () => ({ id: "actor-1", canAccessApplication: () => true }),
}));
vi.mock("@/modules/identity/infrastructure/prisma-application-user-repository", () => ({
  PrismaApplicationUserRepository: class {},
}));
vi.mock("@/modules/identity/infrastructure/supabase-session-verifier", () => ({ SupabaseSessionVerifier: class {} }));
vi.mock("@/modules/authenticator-account/infrastructure/prisma-shared-account-repository", () => ({
  PrismaSharedAccountRepository: class {
    create = mocks.create;
    update = mocks.update;
    delete = mocks.delete;
    restore = mocks.restore;
  },
}));

import { DELETE, PATCH, POST, PUT } from "@/app/api/shared-vaults/[vaultId]/accounts/route";

const encryptedPayload = Buffer.from([1, ...Array<number>(31).fill(7)]).toString("base64");
const context = { params: Promise.resolve({ vaultId: "vault-1" }) };

describe("Shared Vault account mutation routes", () => {
  afterEach(() => vi.clearAllMocks());

  it("creates an account for any server-authorized actor", async () => {
    mocks.create.mockResolvedValue({ status: "SUCCESS", value: { id: "account-1", revision: 1 } });
    const response = await POST(request("POST", { encryptedPayload, encryptionVersion: 1 }), context);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: "account-1", revision: 1 });
    expect(mocks.create).toHaveBeenCalledWith("actor-1", "vault-1", Buffer.from(encryptedPayload, "base64"), 1);
  });

  it("distinguishes missing capability from unavailable Vault access", async () => {
    mocks.create
      .mockResolvedValueOnce({ status: "PERMISSION_DENIED" })
      .mockResolvedValueOnce({ status: "VAULT_UNAVAILABLE" });
    const denied = await POST(request("POST", { encryptedPayload, encryptionVersion: 1 }), context);
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toEqual({ error: "account_permission_required" });
    const unavailable = await POST(request("POST", { encryptedPayload, encryptionVersion: 1 }), context);
    expect(unavailable.status).toBe(404);
    await expect(unavailable.json()).resolves.toEqual({ error: "shared_vault_unavailable" });
  });

  it("preserves Account Revision conflicts for edits and deletions", async () => {
    mocks.update.mockResolvedValue({ status: "STALE_REVISION" });
    const update = await PATCH(
      request("PATCH", { accountId: "account-1", expectedRevision: 2, encryptedPayload, encryptionVersion: 1 }),
      context,
    );
    expect(update.status).toBe(409);
    await expect(update.json()).resolves.toEqual({ error: "stale_revision" });

    mocks.delete.mockResolvedValue({ status: "STALE_REVISION" });
    const remove = await DELETE(request("DELETE", { accountId: "account-1", expectedRevision: 2 }), context);
    expect(remove.status).toBe(409);
    expect(mocks.delete).toHaveBeenCalledWith("actor-1", "vault-1", "account-1", 2);
  });

  it("keeps restoration owner-authorized and distinguishes an unavailable account", async () => {
    mocks.restore
      .mockResolvedValueOnce({ status: "PERMISSION_DENIED" })
      .mockResolvedValueOnce({ status: "ACCOUNT_UNAVAILABLE" });
    const denied = await PUT(request("PUT", { accountId: "account-1" }), context);
    expect(denied.status).toBe(403);
    const unavailable = await PUT(request("PUT", { accountId: "account-1" }), context);
    expect(unavailable.status).toBe(404);
    await expect(unavailable.json()).resolves.toEqual({ error: "account_unavailable" });
  });

  it("strictly validates ciphertext-only request bodies", async () => {
    const response = await POST(
      request("POST", { encryptedPayload, encryptionVersion: 1, plaintextSecret: "forbidden" }),
      context,
    );
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

function request(method: string, body: unknown) {
  return new Request("http://localhost/api/shared-vaults/vault-1/accounts", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}
