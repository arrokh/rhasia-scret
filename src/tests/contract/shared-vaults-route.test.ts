import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSharedVaultHandler } from "@/app/api/shared-vaults/route";
import { ApplicationUser } from "@/modules/identity/domain/application-user";
import { FakeSessionVerifier } from "@/modules/identity/infrastructure/fake-session-verifier";
import { Vault } from "@/modules/vault-management";

const payload = { encryptedName: Buffer.from("encrypted-shared-vault-name").toString("base64"), encryptedOwnerVaultKey: Buffer.from("encrypted-owner-vault-key").toString("base64"), encryptionVersion: 1 };

describe("POST /api/shared-vaults contract", () => {
  it("creates a Shared Vault from opaque owner material", async () => {
    const create = vi.fn().mockResolvedValue(new Vault("vault-1", "SHARED", "user-1"));
    const handler = createSharedVaultHandler({
      sessionVerifier: new FakeSessionVerifier({ subject: "supabase-1", email: "person@example.test" }),
      applicationUsers: { provision: async () => new ApplicationUser("user-1", "supabase-1", "person@example.test", "ACTIVE") },
      sharedVaults: { create }
    });
    const response = await handler(new NextRequest("http://localhost/api/shared-vaults", { method: "POST", body: JSON.stringify(payload) }));
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith("user-1", expect.objectContaining({ encryptionVersion: 1 }));
  });
});
