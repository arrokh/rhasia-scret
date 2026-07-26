import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createForEmail: vi.fn() }));
vi.mock("@/modules/identity/application/load-application-user", () => ({ loadApplicationUser: async () => ({ id: "owner-1", canAccessApplication: () => true }) }));
vi.mock("@/modules/identity/infrastructure/prisma-application-user-repository", () => ({ PrismaApplicationUserRepository: class {} }));
vi.mock("@/modules/identity/infrastructure/supabase-session-verifier", () => ({ SupabaseSessionVerifier: class {} }));
vi.mock("@/modules/vault-membership/infrastructure/prisma-secure-share-link-repository", () => ({ PrismaSecureShareLinkRepository: class { createForEmail = mocks.createForEmail; } }));

import { POST } from "@/app/api/shared-vaults/[vaultId]/share-links/route";
import { InvitationConflictError } from "@/modules/vault-membership/application/secure-share-link-repository";

describe("POST Shared Vault invitation", () => {
  afterEach(() => vi.clearAllMocks());

  it("binds encrypted one-time link material to an invited email", async () => {
    mocks.createForEmail.mockResolvedValue({ id: "invitation-1" });
    const response = await POST(validRequest(), { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: "invitation-1" });
    expect(mocks.createForEmail).toHaveBeenCalledWith("owner-1", "vault-1", "viewer@example.test", expect.objectContaining({ linkVerifier: expect.any(Uint8Array), encryptedPackage: expect.any(Uint8Array) }));
  });

  it("maps malformed JSON and invitation conflicts without hiding infrastructure failures", async () => {
    const malformed = await POST(new Request("http://localhost/api", { method: "POST", body: "{" }) as never, { params: Promise.resolve({ vaultId: "vault-1" }) });
    expect(malformed.status).toBe(400);
    expect(mocks.createForEmail).not.toHaveBeenCalled();

    mocks.createForEmail.mockRejectedValueOnce(new InvitationConflictError("duplicate"));
    await expect(POST(validRequest(), { params: Promise.resolve({ vaultId: "vault-1" }) })).resolves.toMatchObject({ status: 409 });

    mocks.createForEmail.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(POST(validRequest(), { params: Promise.resolve({ vaultId: "vault-1" }) })).rejects.toThrow("database unavailable");
  });
});

function validRequest() {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipientEmail: "viewer@example.test", linkVerifier: Buffer.alloc(32).toString("base64"), encryptedPackage: Buffer.alloc(13).toString("base64") })
  }) as never;
}
