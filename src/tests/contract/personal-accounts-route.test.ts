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
      applicationUsers: { provision: async () => new ApplicationUser("user-1", "supabase-1", "person@example.test", "ACTIVE") },
      accounts: { create, list: async () => [] }
    });
    const response = await handlers.POST(new NextRequest("http://localhost/api/vaults/vault-1/accounts", { method: "POST", body: JSON.stringify(payload) }), { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith("user-1", "vault-1", expect.objectContaining({ encryptionVersion: 1 }));
  });

  it("does not list accounts for an unauthenticated caller", async () => {
    const handlers = createPersonalAccountsHandlers({
      sessionVerifier: new FakeSessionVerifier(null),
      applicationUsers: { provision: async () => { throw new Error("must not provision"); } },
      accounts: { create: async () => { throw new Error("must not create"); }, list: async () => { throw new Error("must not list"); } }
    });
    const response = await handlers.GET(new NextRequest("http://localhost/api/vaults/vault-1/accounts"), { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(response.status).toBe(401);
  });
});
