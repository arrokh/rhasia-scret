import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createInitializePersonalVaultHandler } from "@/app/api/personal-vault/initialize/route";
import { ApplicationUser } from "@/modules/identity/domain/application-user";
import { FakeSessionVerifier } from "@/modules/identity/infrastructure/fake-session-verifier";

const payload = {
  vaultUnlockSalt: Buffer.from("0123456789abcdef").toString("base64"),
  wrappedUserRootKey: Buffer.from("wrapped-user-root-key-material").toString("base64"),
  encryptedPersonalVaultKey: Buffer.from("encrypted-personal-vault-key-material").toString("base64"),
  encryptedVaultName: Buffer.from("encrypted-personal-vault-name-material").toString("base64"),
  encryptionVersion: 1
};

describe("POST /api/personal-vault/initialize contract", () => {
  it("stores only opaque initialization material for an active user", async () => {
    const initialize = vi.fn().mockResolvedValue(undefined);
    const handler = createInitializePersonalVaultHandler({
      sessionVerifier: new FakeSessionVerifier({ subject: "supabase-1", email: "person@example.test" }),
      applicationUsers: { provision: async () => new ApplicationUser("user-1", "supabase-1", "person@example.test", "ACTIVE") },
      personalVaults: { initialize }
    });
    const response = await handler(new NextRequest("http://localhost/api/personal-vault/initialize", {
      method: "POST",
      body: JSON.stringify(payload)
    }));
    expect(response.status).toBe(204);
    expect(initialize).toHaveBeenCalledWith("user-1", expect.objectContaining({ encryptionVersion: 1 }));
  });

  it("rejects malformed opaque material", async () => {
    const handler = createInitializePersonalVaultHandler({
      sessionVerifier: new FakeSessionVerifier({ subject: "supabase-1", email: "person@example.test" }),
      applicationUsers: { provision: async () => new ApplicationUser("user-1", "supabase-1", "person@example.test", "ACTIVE") },
      personalVaults: { initialize: vi.fn() }
    });
    const response = await handler(new NextRequest("http://localhost/api/personal-vault/initialize", {
      method: "POST",
      body: JSON.stringify({ ...payload, encryptedVaultName: "not base64!!!" })
    }));
    expect(response.status).toBe(400);
  });
});
