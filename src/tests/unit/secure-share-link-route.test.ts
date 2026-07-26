import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "recipient-1", email: "recipient@example.test", canAccessApplication: () => true } as { id: string; email: string; canAccessApplication: () => boolean },
  findForRecipient: vi.fn(),
  redeem: vi.fn()
}));
vi.mock("@/modules/identity/application/load-application-user", () => ({ loadApplicationUser: async () => mocks.user }));
vi.mock("@/modules/identity/infrastructure/prisma-application-user-repository", () => ({ PrismaApplicationUserRepository: class {} }));
vi.mock("@/modules/identity/infrastructure/supabase-session-verifier", () => ({ SupabaseSessionVerifier: class {} }));
vi.mock("@/modules/vault-membership/infrastructure/prisma-secure-share-link-repository", () => ({ PrismaSecureShareLinkRepository: class { findForRecipient = mocks.findForRecipient; redeem = mocks.redeem; } }));

import { GET, POST } from "@/app/api/secure-share-links/route";
import { SecureShareLinkUnavailableError } from "@/modules/vault-membership/application/secure-share-link-repository";

const verifier = Buffer.alloc(32, 1).toString("base64");

describe("Secure Share Link route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: "recipient-1", email: "recipient@example.test", canAccessApplication: () => true };
  });

  it("looks up and redeems a link using the authenticated user id and verified email", async () => {
    mocks.findForRecipient.mockResolvedValue({ id: "invitation-1", vaultId: "vault-1", encryptedPackage: new Uint8Array(13).fill(2) });
    const getResponse = await GET(new NextRequest(`http://localhost/api/secure-share-links?verifier=${encodeURIComponent(verifier)}`));
    expect(getResponse.status).toBe(200);
    expect(mocks.findForRecipient).toHaveBeenCalledWith({ userId: "recipient-1", email: "recipient@example.test" }, expect.any(Uint8Array));

    mocks.redeem.mockResolvedValue(undefined);
    const postResponse = await POST(validRedemptionRequest());
    expect(postResponse.status).toBe(204);
    expect(mocks.redeem).toHaveBeenCalledWith({ userId: "recipient-1", email: "recipient@example.test" }, "invitation-1", expect.any(Uint8Array), 1);
  });

  it("rejects inactive users and malformed redemption JSON", async () => {
    mocks.user = { id: "recipient-1", email: "recipient@example.test", canAccessApplication: () => false };
    await expect(GET(new NextRequest(`http://localhost/api/secure-share-links?verifier=${encodeURIComponent(verifier)}`))).resolves.toMatchObject({ status: 403 });
    expect(mocks.findForRecipient).not.toHaveBeenCalled();

    mocks.user = { id: "recipient-1", email: "recipient@example.test", canAccessApplication: () => true };
    await expect(POST(new NextRequest("http://localhost/api/secure-share-links", { method: "POST", body: "{" }))).resolves.toMatchObject({ status: 400 });
    expect(mocks.redeem).not.toHaveBeenCalled();
  });

  it("maps an unavailable one-time link without hiding infrastructure failures", async () => {
    mocks.redeem.mockRejectedValueOnce(new SecureShareLinkUnavailableError("unavailable"));
    await expect(POST(validRedemptionRequest())).resolves.toMatchObject({ status: 404 });

    mocks.redeem.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(POST(validRedemptionRequest())).rejects.toThrow("database unavailable");
  });
});

function validRedemptionRequest() {
  return new NextRequest("http://localhost/api/secure-share-links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invitationId: "invitation-1", encryptedVaultKey: Buffer.alloc(13, 2).toString("base64"), keyVersion: 1 })
  });
}
