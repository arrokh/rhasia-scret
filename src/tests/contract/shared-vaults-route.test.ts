import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createRenameSharedVaultHandler } from "@/app/api/shared-vaults/[vaultId]/route";
import { createListSharedVaultsHandler, createSharedVaultHandler } from "@/app/api/shared-vaults/route";
import { ApplicationUser } from "@/modules/identity/domain/application-user";
import { FakeSessionVerifier } from "@/modules/identity/infrastructure/fake-session-verifier";
import { Vault } from "@/modules/vault-management";

const payload = { encryptedName: Buffer.from("encrypted-shared-vault-name").toString("base64"), encryptedOwnerVaultKey: Buffer.from("encrypted-owner-vault-key").toString("base64"), encryptionVersion: 1 };

describe("GET /api/shared-vaults contract", () => {
  it("returns only encrypted Shared Vault access material", async () => {
    const listForMember = vi.fn().mockResolvedValue([{
      vaultId: "vault-1",
      role: "OWNER",
      encryptedName: Uint8Array.from([1, 2, 3]),
      encryptionVersion: 1,
      encryptedVaultKey: Uint8Array.from([4, 5, 6]),
      keyVersion: 1,
      accounts: [{ id: "account-1", encryptedPayload: Uint8Array.from([7, 8, 9]), encryptionVersion: 1, revision: 2 }]
    }]);
    const handler = createListSharedVaultsHandler({
      sessionVerifier: new FakeSessionVerifier({ subject: "supabase-1", email: "person@example.test" }),
      applicationUsers: { provision: async () => new ApplicationUser("user-1", "supabase-1", "person@example.test", "ACTIVE") },
      sharedVaultAccess: { getForMember: vi.fn(), listForMember }
    });

    const response = await handler();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{
      vaultId: "vault-1",
      role: "OWNER",
      encryptedName: "AQID",
      encryptionVersion: 1,
      encryptedVaultKey: "BAUG",
      keyVersion: 1,
      accounts: [{ id: "account-1", encryptedPayload: "BwgJ", encryptionVersion: 1, revision: 2 }]
    }]);
    expect(listForMember).toHaveBeenCalledWith("user-1");
  });
});

describe("PATCH /api/shared-vaults/:vaultId contract", () => {
  it("lets an owner replace only the encrypted Vault Name", async () => {
    const rename = vi.fn().mockResolvedValue(true);
    const handler = createRenameSharedVaultHandler({
      sessionVerifier: new FakeSessionVerifier({ subject: "supabase-1", email: "person@example.test" }),
      applicationUsers: { provision: async () => new ApplicationUser("user-1", "supabase-1", "person@example.test", "ACTIVE") },
      sharedVaults: { create: vi.fn(), rename }
    });
    const encryptedName = Buffer.from("encrypted-renamed-vault").toString("base64");

    const response = await handler(
      new NextRequest("http://localhost/api/shared-vaults/vault-1", { method: "PATCH", body: JSON.stringify({ encryptedName, encryptionVersion: 1 }) }),
      { params: Promise.resolve({ vaultId: "vault-1" }) }
    );

    expect(response.status).toBe(204);
    expect(rename).toHaveBeenCalledWith("user-1", "vault-1", Buffer.from(encryptedName, "base64"), 1);
  });
});

describe("POST /api/shared-vaults contract", () => {
  it("creates a Shared Vault from opaque owner material", async () => {
    const create = vi.fn().mockResolvedValue(new Vault("vault-1", "SHARED", "user-1"));
    const handler = createSharedVaultHandler({
      sessionVerifier: new FakeSessionVerifier({ subject: "supabase-1", email: "person@example.test" }),
      applicationUsers: { provision: async () => new ApplicationUser("user-1", "supabase-1", "person@example.test", "ACTIVE") },
      sharedVaults: { create, rename: vi.fn() }
    });
    const response = await handler(new NextRequest("http://localhost/api/shared-vaults", { method: "POST", body: JSON.stringify(payload) }));
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith("user-1", expect.objectContaining({ encryptionVersion: 1 }));
  });
});
