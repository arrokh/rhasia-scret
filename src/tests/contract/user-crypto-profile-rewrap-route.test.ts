import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createRewrapUserRootKeyHandler } from "@/app/api/user-crypto-profile/rewrap/route";
import { ApplicationUser } from "@/modules/identity/domain/application-user";
import { FakeSessionVerifier } from "@/modules/identity/infrastructure/fake-session-verifier";

const payload = {
  vaultUnlockSalt: Buffer.from("0123456789abcdef").toString("base64"),
  wrappedUserRootKey: Buffer.from("new-wrapped-user-root-key-material").toString("base64"),
  encryptionVersion: 1
};

describe("POST /api/user-crypto-profile/rewrap contract", () => {
  it("updates only opaque rewrapped User Root Key material for an active user", async () => {
    const rewrapUserRootKey = vi.fn().mockResolvedValue(undefined);
    const handler = createRewrapUserRootKeyHandler({
      sessionVerifier: new FakeSessionVerifier({ subject: "supabase-1", email: "person@example.test" }),
      applicationUsers: { provision: async () => new ApplicationUser("user-1", "supabase", "supabase-1", "person@example.test", "ACTIVE") },
      cryptoProfiles: { get: async () => null, registerUserEncryptionIdentity: async () => undefined, rewrapUserRootKey }
    });
    const response = await handler(new NextRequest("http://localhost/api/user-crypto-profile/rewrap", { method: "POST", body: JSON.stringify(payload) }));
    expect(response.status).toBe(204);
    expect(rewrapUserRootKey).toHaveBeenCalledWith("user-1", expect.objectContaining({ encryptionVersion: 1 }));
  });

  it("accepts the migrated Personal Vault Encryption Key with the rewrapped root key", async () => {
    const rewrapUserRootKey = vi.fn().mockResolvedValue(undefined);
    const handler = createRewrapUserRootKeyHandler({
      sessionVerifier: new FakeSessionVerifier({ subject: "supabase-1", email: "person@example.test" }),
      applicationUsers: { provision: async () => new ApplicationUser("user-1", "supabase", "supabase-1", "person@example.test", "ACTIVE") },
      cryptoProfiles: { get: async () => null, registerUserEncryptionIdentity: async () => undefined, rewrapUserRootKey }
    });
    const response = await handler(new NextRequest("http://localhost/api/user-crypto-profile/rewrap", {
      method: "POST",
      body: JSON.stringify({ ...payload, encryptedPersonalVaultKey: Buffer.from("new-personal-vault-key-material").toString("base64") })
    }));
    expect(response.status).toBe(204);
    expect(rewrapUserRootKey).toHaveBeenCalledWith("user-1", expect.objectContaining({ encryptedPersonalVaultKey: expect.any(Buffer), encryptionVersion: 1 }));
  });
});
